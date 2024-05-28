import ffmpeg from 'fluent-ffmpeg'
import PCancelable from 'p-cancelable'
import prism from 'prism-media'
import { Readable, Transform } from 'node:stream'

import { MediaUdp } from '#src/client/index'
import {
  AudioStream,
  IvfTransformer,
  H265NalSplitter,
  H264NalSplitter,
  VideoStream,
} from '#src/media/index'

import { StreamOutput } from '@dank074/fluent-ffmpeg-multistream-ts'
import { normalizeVideoCodec } from '#src/utils'

export let command: ffmpeg.FfmpegCommand

export function streamLivestreamVideo(
  input: string | Readable,
  mediaUdp: MediaUdp,
  includeAudio = true,
  customHeaders?: Map
) {
  return new PCancelable<string>(
    (
      resolve: (arg0: string) => void,
      reject: (arg0: string) => void,
      onCancel: (arg0: () => ffmpeg.FfmpegCommand) => void
    ) => {
      const streamOpts = mediaUdp.mediaConnection.streamOptions
      const videoStream: VideoStream = new VideoStream(
        mediaUdp,
        streamOpts.fps,
        streamOpts.readAtNativeFps
      )
      const videoCodec = normalizeVideoCodec(streamOpts.videoCodec)
      let videoOutput: Transform

      switch (videoCodec) {
        case 'H264':
          videoOutput = new H264NalSplitter()
          break
        case 'H265':
          videoOutput = new H265NalSplitter()
          break
        case 'VP8':
          videoOutput = new IvfTransformer()
          break
        default:
          throw new Error('Codec not supported')
      }

      let headers: Map = {
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

      try {
        command = ffmpeg(input)
          .addOption('-loglevel', '0')
          .addOption('-fflags', 'nobuffer')
          .addOption('-analyzeduration', '0')
          .on('end', () => {
            resolve('video ended')
          })
          .on('error', (err, _stdout, _stderr) => {
            reject('cannot play video ' + err.message)
          })
          .on('stderr', console.error)

        if (videoCodec === 'VP8') {
          command
            .output(StreamOutput(videoOutput).url, { end: false })
            .noAudio()
            .size(`${streamOpts.width}x${streamOpts.height}`)
            .fpsOutput(streamOpts.fps)
            .videoBitrate(`${streamOpts.bitrateKbps}k`)
            .format('ivf')
            .outputOption('-deadline', 'realtime')
        } else if (videoCodec === 'H265') {
          command
            .output(StreamOutput(videoOutput).url, { end: false })
            .noAudio()
            .size(`${streamOpts.width}x${streamOpts.height}`)
            .fpsOutput(streamOpts.fps)
            .videoBitrate(`${streamOpts.bitrateKbps}k`)
            .format('hevc')
            .outputOptions([
              '-tune zerolatency',
              '-pix_fmt yuv420p',
              `-preset ${streamOpts.h26xPreset}`,
              '-profile:v main',
              `-g ${streamOpts.fps}`,
              `-bf 0`,
              `-x265-params keyint=${streamOpts.fps}:min-keyint=${streamOpts.fps}`,
              '-bsf:v hevc_metadata=aud=insert',
            ])
        } else {
          command
            .output(StreamOutput(videoOutput).url, { end: false })
            .noAudio()
            .size(`${streamOpts.width}x${streamOpts.height}`)
            .fpsOutput(streamOpts.fps)
            .videoBitrate(`${streamOpts.bitrateKbps}k`)
            .format('h264')
            .outputOptions([
              '-tune zerolatency',
              '-pix_fmt yuv420p',
              `-preset ${streamOpts.h26xPreset}`,
              '-profile:v baseline',
              `-g ${streamOpts.fps}`,
              `-bf 0`,
              `-x264-params keyint=${streamOpts.fps}:min-keyint=${streamOpts.fps}`,
              '-bsf:v h264_metadata=aud=insert',
            ])
        }

        videoOutput.pipe(videoStream, { end: false })

        if (includeAudio) {
          const audioStream: AudioStream = new AudioStream(mediaUdp)

          // make opus stream
          const opus = new prism.opus.Encoder({ channels: 2, rate: 48000, frameSize: 960 })

          command
            .output(StreamOutput(opus).url, { end: false })
            .noVideo()
            .audioChannels(2)
            .audioFrequency(48000)
            //.audioBitrate('128k')
            .format('s16le')

          opus.pipe(audioStream, { end: false })
        }

        if (streamOpts.hardwareAcceleratedDecoding) command.inputOption('-hwaccel', 'auto')

        if (streamOpts.readAtNativeFps) command.inputOption('-re')

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
      } catch (e) {
        //audioStream.end();
        //videoStream.end();
        reject('cannot play video ' + (e as Error).message)
      }
    }
  )
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

type Map = {
  [key: string]: string
}
