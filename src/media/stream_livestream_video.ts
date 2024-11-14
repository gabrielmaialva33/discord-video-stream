import { PassThrough, Readable } from 'node:stream'
import ffmpeg from 'fluent-ffmpeg'
import PCancelable from 'p-cancelable'

import { MediaUdp } from '../client/index.js'
import { VideoStream } from './video_stream.js'
import { AudioStream } from './audio_stream.js'

import { normalizeVideoCodec } from '../utils.js'
import { demux } from './libav_demuxer.js'

export function streamLivestreamVideo(
  input: string | Readable,
  mediaUdp: MediaUdp,
  includeAudio = true,
  customHeaders?: Record<string, string>
) {
  return new PCancelable<string>(async (resolve, reject, onCancel) => {
    const streamOpts = mediaUdp.mediaConnection.streamOptions
    const videoCodec = normalizeVideoCodec(streamOpts.videoCodec)

    // Set default headers and merge with custom headers if provided
    const defaultHeaders: Record<string, string> = {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
        'AppleWebKit/537.36 (KHTML, like Gecko) ' +
        'Chrome/107.0.0.0 Safari/537.3',
      'Connection': 'keep-alive',
    }
    const headers = { ...defaultHeaders, ...(customHeaders ?? {}) }

    // Determine if the input is an HTTP URL and if it's an HLS stream
    let isHttpUrl = false
    let isHls = false

    if (typeof input === 'string') {
      isHttpUrl = input.startsWith('http://') || input.startsWith('https://')
      isHls = input.includes('.m3u8') || input.includes('.m3u')
    }

    const ffmpegOutput = new PassThrough()

    try {
      // Create ffmpeg command
      const command = ffmpeg(input)
        .output(ffmpegOutput)
        .addOption('-loglevel', 'error') // Show only errors
        .on('end', () => {
          resolve('video ended')
        })
        .on('error', (err) => {
          console.error('ffmpeg error:', err.message)
          reject('Cannot play video: ' + err.message)
        })

      // General output options
      command
        .size(`${streamOpts.width}x${streamOpts.height}`)
        .fpsOutput(streamOpts.fps)
        .videoBitrate(`${streamOpts.bitrateKbps}k`)
        .outputFormat('matroska')

      // Video codec setup
      command.outputOption('-bf', '0') // Disable B-frames for lower latency
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
              '-tune',
              'zerolatency',
              '-pix_fmt',
              'yuv420p',
              '-preset',
              streamOpts.h26xPreset,
              '-profile:v',
              'baseline',
              '-g',
              streamOpts.fps.toString(),
              '-x264-params',
              `keyint=${streamOpts.fps}:min-keyint=${streamOpts.fps}`,
            ])
          break
        case 'H265':
          command
            .videoCodec('libx265')
            .outputOptions([
              '-tune',
              'zerolatency',
              '-pix_fmt',
              'yuv420p',
              '-preset',
              streamOpts.h26xPreset,
              '-profile:v',
              'main',
              '-g',
              streamOpts.fps.toString(),
              '-x265-params',
              `keyint=${streamOpts.fps}:min-keyint=${streamOpts.fps}`,
            ])
          break
        default:
          throw new Error(`Unsupported video codec: ${videoCodec}`)
      }

      // Audio setup
      if (includeAudio) {
        command.audioChannels(2).audioFrequency(48000).audioCodec('libopus')
        // .audioBitrate('128k'); // Uncomment if needed
      } else {
        command.noAudio() // Disable audio processing if not needed
      }

      // Enable hardware acceleration if available
      if (streamOpts.hardwareAcceleratedDecoding) {
        command.inputOption('-hwaccel', 'auto')
      }

      // Input options
      command.inputOption('-re') // Read input at native frame rate

      // Minimize latency options
      if (streamOpts.minimizeLatency) {
        command.addOptions(['-fflags', 'nobuffer', '-flags', 'low_delay', '-analyzeduration', '0'])
      }

      // HTTP-specific options
      if (isHttpUrl) {
        // Set custom headers
        const headersOption = Object.entries(headers)
          .map(([key, value]) => `${key}: ${value}`)
          .join('\r\n')
        command.inputOption('-headers', headersOption)

        // Reconnection options for non-HLS streams
        if (!isHls) {
          command.inputOptions([
            '-reconnect',
            '1',
            '-reconnect_at_eof',
            '1',
            '-reconnect_streamed',
            '1',
            '-reconnect_delay_max',
            '2', // Reduced delay for faster reconnection
          ])
        }
      }

      command.run()

      // Handle cancellation
      onCancel(() => command.kill('SIGINT'))

      // Demux the ffmpeg output into separate audio and video streams
      const { video, audio } = await demux(ffmpegOutput).catch((e) => {
        command.kill('SIGINT')
        throw e
      })

      // Pipe video stream
      if (video) {
        const videoStream = new VideoStream(mediaUdp)
        video.stream.pipe(videoStream)

        // Pipe audio stream if included
        if (includeAudio && audio) {
          const audioStream = new AudioStream(mediaUdp)
          audio.stream.pipe(audioStream)

          // Synchronize video and audio streams
          videoStream.syncStream = audioStream
          audioStream.syncStream = videoStream
        }
      } else {
        throw new Error('No video stream found')
      }
    } catch (e) {
      // Clean up resources on error
      ffmpegOutput.destroy()
      reject('Cannot play video: ' + (e as Error).message)
    }
  })
}

export function getInputMetadata(input: string | Readable): Promise<ffmpeg.FfprobeData> {
  return new Promise((resolve, reject) => {
    const instance = ffmpeg(input).on('error', (err) => reject(err))

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

export function inputHasAudio(metadata: ffmpeg.FfprobeData) {
  return metadata.streams.some((stream) => stream.codec_type === 'audio')
}

export function inputHasVideo(metadata: ffmpeg.FfprobeData) {
  return metadata.streams.some((stream) => stream.codec_type === 'video')
}
