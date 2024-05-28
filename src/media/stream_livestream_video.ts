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

type CustomHeaders = { [key: string]: string }

export function streamLivestreamVideo(
  input: string | Readable,
  mediaUdp: MediaUdp,
  includeAudio = true,
  customHeaders?: CustomHeaders
): PCancelable<string> {
  return new PCancelable<string>((resolve, reject, onCancel) => {
    const streamOpts = mediaUdp.mediaConnection.streamOptions
    const videoStream = new VideoStream(mediaUdp, streamOpts.fps, streamOpts.readAtNativeFps)
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

    const defaultHeaders: CustomHeaders = {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/107.0.0.0 Safari/537.3',
      'Connection': 'keep-alive',
    }

    const headers = { ...defaultHeaders, ...(customHeaders ?? {}) }

    const isHttpUrl =
      typeof input === 'string' && (input.startsWith('http') || input.startsWith('https'))
    const isHls = typeof input === 'string' && input.includes('m3u')

    try {
      command = ffmpeg(input)
        .addOption('-loglevel', '0')
        .addOption('-fflags', 'nobuffer')
        .addOption('-analyzeduration', '0')
        .on('end', () => resolve('video ended'))
        .on('error', (err) => reject('cannot play video ' + err.message))
        .on('stderr', console.error)

      const streamOutputUrl = StreamOutput(videoOutput).url
      const commonOutputOptions = [
        '-tune zerolatency',
        '-pix_fmt yuv420p',
        `-preset ${streamOpts.h26xPreset}`,
        `-g ${streamOpts.fps}`,
        `-bf 0`,
      ]

      if (videoCodec === 'VP8') {
        command
          .output(streamOutputUrl, { end: false })
          .noAudio()
          .size(`${streamOpts.width}x${streamOpts.height}`)
          .fpsOutput(streamOpts.fps)
          .videoBitrate(`${streamOpts.bitrateKbps}k`)
          .format('ivf')
          .outputOption('-deadline', 'realtime')
      } else if (videoCodec === 'H265') {
        command
          .output(streamOutputUrl, { end: false })
          .noAudio()
          .size(`${streamOpts.width}x${streamOpts.height}`)
          .fpsOutput(streamOpts.fps)
          .videoBitrate(`${streamOpts.bitrateKbps}k`)
          .format('hevc')
          .outputOptions([
            ...commonOutputOptions,
            '-profile:v main',
            '-bsf:v hevc_metadata=aud=insert',
          ])
      } else {
        command
          .output(streamOutputUrl, { end: false })
          .noAudio()
          .size(`${streamOpts.width}x${streamOpts.height}`)
          .fpsOutput(streamOpts.fps)
          .videoBitrate(`${streamOpts.bitrateKbps}k`)
          .format('h264')
          .outputOptions([
            ...commonOutputOptions,
            '-profile:v baseline',
            '-bsf:v h264_metadata=aud=insert',
          ])
      }

      videoOutput.pipe(videoStream, { end: false })

      if (includeAudio) {
        const audioStream = new AudioStream(mediaUdp)
        const opus = new prism.opus.Encoder({ channels: 2, rate: 48000, frameSize: 960 })

        command
          .output(StreamOutput(opus).url, { end: false })
          .noVideo()
          .audioChannels(2)
          .audioFrequency(48000)
          .format('s16le')

        opus.pipe(audioStream, { end: false })
      }

      if (streamOpts.hardwareAcceleratedDecoding) command.inputOption('-hwaccel', 'auto')
      if (streamOpts.readAtNativeFps) command.inputOption('-re')

      if (isHttpUrl) {
        command.inputOption(
          '-headers',
          Object.keys(headers)
            .map((key) => `${key}: ${headers[key]}`)
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
      reject('cannot play video ' + (e as Error).message)
    }
  })
}

export function getInputMetadata(input: string | Readable): Promise<ffmpeg.FfprobeData> {
  return new Promise((resolve, reject) => {
    const instance = ffmpeg(input).on('error', reject)

    instance.ffprobe((err, metadata) => {
      if (err) {
        reject(err)
      } else {
        resolve(metadata)
      }
      instance.removeAllListeners()
      instance.kill('SIGINT')
    })
  })
}

export function inputHasAudio(metadata: ffmpeg.FfprobeData): boolean {
  return metadata.streams.some((value) => value.codec_type === 'audio')
}

export function inputHasVideo(metadata: ffmpeg.FfprobeData): boolean {
  return metadata.streams.some((value) => value.codec_type === 'video')
}
