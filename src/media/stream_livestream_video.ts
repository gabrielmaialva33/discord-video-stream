import { PassThrough, Readable } from 'node:stream'

import ffmpeg from 'fluent-ffmpeg'
import Ffmpeg from 'fluent-ffmpeg'
import PCancelable from 'p-cancelable'

import { MediaUdp } from '../client/index.js'
import { VideoStream } from './video_stream.js'
import { AudioStream } from './audio_stream.js'

import { normalizeVideoCodec } from '../utils.js'
import { demux } from './libav_demuxer.js'

export let command: Ffmpeg.FfmpegCommand = ffmpeg()

export function streamLivestreamVideo(
  input: string | Readable,
  mediaUdp: MediaUdp,
  includeAudio = true,
  customHeaders?: Record<string, string>
) {
  return new PCancelable<string>(async (resolve, reject, onCancel) => {
    const streamOpts = mediaUdp.mediaConnection.streamOptions
    const videoCodec = normalizeVideoCodec(streamOpts.videoCodec)

    // ffmpeg setup
    let headers: Record<string, string> = {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/107.0.0.0 Safari/537.3',
      'Connection': 'keep-alive',
    }

    headers = { ...headers, ...(customHeaders ?? {}) }

    let isHttpUrl = false
    let isHls = false

    if (typeof input === 'string') {
      isHttpUrl = input.startsWith('http') || input.startsWith('https')
      isHls = input.includes('m3u')
    }

    const ffmpegOutput = new PassThrough()
    try {
      // command creation
      const command = ffmpeg(input)
        .addOption('-loglevel', '0')
        .on('end', () => {
          resolve('video ended')
        })
        .on('error', (err, _stdout, _stderr) => {
          reject('cannot play video ' + err.message)
        })
        .on('stderr', console.error)

      // general output options
      command
        .output(ffmpegOutput)
        .size(`${streamOpts.width}x${streamOpts.height}`)
        .fpsOutput(streamOpts.fps)
        .videoBitrate(`${streamOpts.bitrateKbps}k`)
        .outputFormat('matroska')

      // video setup
      command.outputOption('-bf', '0')
      switch (videoCodec) {
        case 'AV1':
          command.videoCodec('libsvtav1')
          break
        case 'VP8':
          command.videoCodec('libvpx').outputOption('-deadline', 'realtime')
          break
        case 'VP9':
          command.videoCodec('libvpx-vp9').outputOption('-deadline', 'realtime')
          break
        case 'H264':
          command
            .videoCodec('libx264')
            .outputOptions([
              '-tune zerolatency',
              '-pix_fmt yuv420p',
              `-preset ${streamOpts.h26xPreset}`,
              '-profile:v baseline',
              `-g ${streamOpts.fps}`,
              `-x264-params keyint=${streamOpts.fps}:min-keyint=${streamOpts.fps}`,
            ])
          break
        case 'H265':
          command
            .videoCodec('libx265')
            .outputOptions([
              '-tune zerolatency',
              '-pix_fmt yuv420p',
              `-preset ${streamOpts.h26xPreset}`,
              '-profile:v main',
              `-g ${streamOpts.fps}`,
              `-x265-params keyint=${streamOpts.fps}:min-keyint=${streamOpts.fps}`,
            ])
          break
      }

      // audio setup
      command.audioChannels(2).audioFrequency(48000).audioCodec('libopus')
      //.audioBitrate('128k')

      if (streamOpts.hardwareAcceleratedDecoding) command.inputOption('-hwaccel', 'auto')

      if (streamOpts.minimizeLatency) {
        command.addOptions(['-fflags nobuffer', '-analyzeduration 0'])
      }

      if (isHttpUrl) {
        command.inputOption(
          '-headers',
          Object.keys(headers)
            .map((key) => key + ': ' + headers[key])
            .join('\r\n')
        )
        if (!isHls) {
          command.inputOptions([
            '-reconnect 1',
            '-reconnect_at_eof 1',
            '-reconnect_streamed 1',
            '-reconnect_delay_max 4294',
          ])
        }
      }

      command.run()
      onCancel(() => command.kill('SIGINT'))

      // demuxing
      const { video, audio } = await demux(ffmpegOutput).catch((e) => {
        command.kill('SIGINT')
        throw e
      })
      const videoStream = new VideoStream(mediaUdp)
      video!.stream.pipe(videoStream)
      if (audio && includeAudio) {
        const audioStream = new AudioStream(mediaUdp)
        audio.stream.pipe(audioStream)
        videoStream.syncStream = audioStream
        audioStream.syncStream = videoStream
      }
    } catch (e) {
      //audioStream.end();
      //videoStream.end();
      reject('cannot play video ' + (e as Error).message)
    }
  })
}

export function getInputMetadata(input: string | Readable): Promise<ffmpeg.FfprobeData> {
  return new Promise((resolve, reject) => {
    const instance = ffmpeg(input).on('error', (err, _stdout, _stderr) => reject(err))

    instance.ffprobe((err, metadata) => {
      if (err) reject(err)
      instance.removeAllListeners()
      resolve(metadata)
      instance.kill('SIGINT')
    })
  })
}

export function inputHasAudio(metadata: ffmpeg.FfprobeData) {
  return metadata.streams.some((value) => value.codec_type === 'audio')
}

export function inputHasVideo(metadata: ffmpeg.FfprobeData) {
  return metadata.streams.some((value) => value.codec_type === 'video')
}
