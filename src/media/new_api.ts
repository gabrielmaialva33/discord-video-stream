import ffmpeg from 'fluent-ffmpeg'
import { PassThrough, type Readable } from 'node:stream'

import type { SupportedVideoCodec } from '../utils.js'
import type { MediaUdp, Streamer } from '../client/index.js'
import { isFiniteNonZero } from '../utils.js'
import { demux } from './libav_demuxer.js'
import { AVCodecID } from './libav_codec_id.js'
import { VideoStream } from './video_stream.js'
import { AudioStream } from './audio_stream.js'

export type EncoderOptions = {
  /**
   * Video width
   */
  width: number

  /**
   * Video height
   */
  height: number

  /**
   * Video frame rate
   */
  frameRate?: number

  /**
   * Video codec
   */
  videoCodec: SupportedVideoCodec

  /**
   * Video average bitrate in kbps
   */
  bitrateVideo: number

  /**
   * Video max bitrate in kbps
   */
  bitrateVideoMax: number

  /**
   * Audio bitrate in kbps
   */
  bitrateAudio: number

  /**
   * Enable audio output
   */
  includeAudio: boolean

  /**
   * Enable hardware accelerated decoding
   */
  hardwareAcceleratedDecoding: boolean

  /**
   * Add some options to minimize latency
   */
  minimizeLatency: boolean

  /**
   * Preset for x264 and x265
   */
  h26xPreset:
    | 'ultrafast'
    | 'superfast'
    | 'veryfast'
    | 'faster'
    | 'fast'
    | 'medium'
    | 'slow'
    | 'slower'
    | 'veryslow'
    | 'placebo'

  /**
   * Custom headers for HTTP requests
   */
  customHeaders: Record<string, string>
}

export function prepareStream(input: string | Readable, options: Partial<EncoderOptions> = {}) {
  const defaultOptions = {
    // negative values = resize by aspect ratio, see https://trac.ffmpeg.org/wiki/Scaling
    width: -2,
    height: -2,
    frameRate: undefined,
    videoCodec: 'H264',
    bitrateVideo: 5000,
    bitrateVideoMax: 7000,
    bitrateAudio: 128,
    includeAudio: true,
    hardwareAcceleratedDecoding: false,
    minimizeLatency: false,
    h26xPreset: 'ultrafast',
    customHeaders: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/107.0.0.0 Safari/537.3',
      'Connection': 'keep-alive',
    },
  } satisfies EncoderOptions

  function mergeOptions(opts: Partial<EncoderOptions>) {
    return {
      width: isFiniteNonZero(opts.width) ? Math.round(opts.width) : defaultOptions.width,

      height: isFiniteNonZero(opts.height) ? Math.round(opts.height) : defaultOptions.height,

      frameRate:
        isFiniteNonZero(opts.frameRate) && opts.frameRate > 0
          ? opts.frameRate
          : defaultOptions.frameRate,

      videoCodec: opts.videoCodec ?? defaultOptions.videoCodec,

      bitrateVideo:
        isFiniteNonZero(opts.bitrateVideo) && opts.bitrateVideo > 0
          ? Math.round(opts.bitrateVideo)
          : defaultOptions.bitrateVideo,

      bitrateVideoMax:
        isFiniteNonZero(opts.bitrateVideoMax) && opts.bitrateVideoMax > 0
          ? Math.round(opts.bitrateVideoMax)
          : defaultOptions.bitrateVideoMax,

      bitrateAudio:
        isFiniteNonZero(opts.bitrateAudio) && opts.bitrateAudio > 0
          ? Math.round(opts.bitrateAudio)
          : defaultOptions.bitrateAudio,

      includeAudio: opts.includeAudio ?? defaultOptions.includeAudio,

      hardwareAcceleratedDecoding:
        opts.hardwareAcceleratedDecoding ?? defaultOptions.hardwareAcceleratedDecoding,

      minimizeLatency: opts.minimizeLatency ?? defaultOptions.minimizeLatency,

      h26xPreset: opts.h26xPreset ?? defaultOptions.h26xPreset,

      customHeaders: {
        ...defaultOptions.customHeaders,
        ...opts.customHeaders,
      },
    } satisfies EncoderOptions
  }

  const mergedOptions = mergeOptions(options)

  let isHttpUrl = false
  let isHls = false

  if (typeof input === 'string') {
    isHttpUrl = input.startsWith('http') || input.startsWith('https')
    isHls = input.includes('m3u')
  }

  const output = new PassThrough()

  // command creation
  const command = ffmpeg(input).addOption('-loglevel', '0')

  // input options
  let { hardwareAcceleratedDecoding, minimizeLatency, customHeaders } = mergedOptions
  if (hardwareAcceleratedDecoding) command.inputOption('-hwaccel', 'auto')

  if (minimizeLatency) {
    command.addOptions(['-fflags nobuffer', '-analyzeduration 0'])
  }

  if (isHttpUrl) {
    command.inputOption(
      '-headers',
      Object.entries(customHeaders)
        .map(([k, v]) => `${k}: ${v}`)
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

  // general output options
  command.output(output).outputFormat('matroska')

  // video setup
  let { width, height, frameRate, bitrateVideo, bitrateVideoMax, videoCodec, h26xPreset } =
    mergedOptions
  command.addOutputOption('-map 0:v')
  command.videoFilter(`scale=${width}:${height}`)

  if (frameRate) command.fpsOutput(frameRate)

  command.addOutputOption([
    '-b:v',
    `${bitrateVideo}k`,
    '-maxrate:v',
    `${bitrateVideoMax}k`,
    '-bf',
    '0',
    '-pix_fmt',
    'yuv420p',
    '-force_key_frames',
    'expr:gte(t,n_forced*1)',
  ])

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
        .outputOptions(['-tune zerolatency', `-preset ${h26xPreset}`, '-profile:v baseline'])
      break
    case 'H265':
      command
        .videoCodec('libx265')
        .outputOptions(['-tune zerolatency', `-preset ${h26xPreset}`, '-profile:v main'])
      break
  }

  // audio setup
  let { includeAudio, bitrateAudio } = mergedOptions
  if (includeAudio)
    command
      .addOutputOption('-map 0:a?')
      .audioChannels(2)
      /*
       * I don't have much surround sound material to test this with,
       * if you do and you have better settings for this, feel free to
       * contribute!
       */
      .addOutputOption('-lfe_mix_level 1')
      .audioFrequency(48000)
      .audioCodec('libopus')
      .audioBitrate(`${bitrateAudio}k`)

  command.run()
  return { command, output }
}

export type PlayStreamOptions = {
  /**
   * Set stream type as "Go Live" or camera stream
   */
  type: 'go-live' | 'camera'

  /**
   * Override video width sent to Discord.
   * DO NOT SPECIFY UNLESS YOU KNOW WHAT YOU'RE DOING!
   */
  width: number

  /**
   * Override video height sent to Discord.
   * DO NOT SPECIFY UNLESS YOU KNOW WHAT YOU'RE DOING!
   */
  height: number

  /**
   * Override video frame rate sent to Discord.
   * DO NOT SPECIFY UNLESS YOU KNOW WHAT YOU'RE DOING!
   */
  frameRate: number

  /**
   * Enable RTCP Sender Report for synchronization
   */
  rtcpSenderReportEnabled: boolean

  /**
   * Force the use of ChaCha20 encryption. Faster on CPUs without AES-NI
   */
  forceChacha20Encryption: boolean
}

export async function playStream(
  input: Readable,
  streamer: Streamer,
  options: Partial<PlayStreamOptions> = {}
) {
  if (!streamer.voiceConnection) throw new Error('Bot is not connected to a voice channel')

  const { video, audio } = await demux(input)
  if (!video) throw new Error('No video stream in media')

  const videoCodecMap: Record<number, SupportedVideoCodec> = {
    [AVCodecID.AV_CODEC_ID_H264]: 'H264',
    [AVCodecID.AV_CODEC_ID_H265]: 'H265',
    [AVCodecID.AV_CODEC_ID_VP8]: 'VP8',
    [AVCodecID.AV_CODEC_ID_VP9]: 'VP9',
    [AVCodecID.AV_CODEC_ID_AV1]: 'AV1',
  }
  const defaultOptions = {
    type: 'go-live',
    width: video.width,
    height: video.height,
    frameRate: video.framerate_num / video.framerate_den,
    rtcpSenderReportEnabled: true,
    forceChacha20Encryption: false,
  } satisfies PlayStreamOptions

  function mergeOptions(opts: Partial<PlayStreamOptions>) {
    return {
      type: opts.type ?? defaultOptions.type,

      width:
        isFiniteNonZero(opts.width) && opts.width > 0
          ? Math.round(opts.width)
          : defaultOptions.width,

      height:
        isFiniteNonZero(opts.height) && opts.height > 0
          ? Math.round(opts.height)
          : defaultOptions.height,

      frameRate: Math.round(
        isFiniteNonZero(opts.frameRate) && opts.frameRate > 0
          ? Math.round(opts.frameRate)
          : defaultOptions.frameRate
      ),

      rtcpSenderReportEnabled:
        opts.rtcpSenderReportEnabled ?? defaultOptions.rtcpSenderReportEnabled,

      forceChacha20Encryption:
        opts.forceChacha20Encryption ?? defaultOptions.forceChacha20Encryption,
    } satisfies PlayStreamOptions
  }

  const mergedOptions = mergeOptions(options)

  let udp: MediaUdp
  let stopStream
  if (mergedOptions.type == 'go-live') {
    udp = await streamer.createStream()
    stopStream = () => streamer.stopStream()
  } else {
    udp = streamer.voiceConnection.udp
    streamer.signalVideo(true)
    stopStream = () => streamer.signalVideo(false)
  }
  udp.mediaConnection.streamOptions = {
    width: mergedOptions.width,
    height: mergedOptions.height,
    videoCodec: videoCodecMap[video.codec],
    fps: mergedOptions.frameRate,
    rtcpSenderReportEnabled: mergedOptions.rtcpSenderReportEnabled,
    forceChacha20Encryption: mergedOptions.forceChacha20Encryption,
  }
  await udp.mediaConnection.setProtocols()
  udp.updatePacketizer() // TODO: put all packetizers here when we remove the old API
  udp.mediaConnection.setSpeaking(true)
  udp.mediaConnection.setVideoStatus(true)

  const vStream = new VideoStream(udp)
  video.stream.pipe(vStream)
  if (audio) {
    const aStream = new AudioStream(udp)
    audio.stream.pipe(aStream)
    vStream.syncStream = aStream
    aStream.syncStream = vStream
  }
  return new Promise<void>((resolve) => {
    vStream.once('finish', () => {
      stopStream()
      udp.mediaConnection.setSpeaking(false)
      udp.mediaConnection.setVideoStatus(false)
      resolve()
    })
  })
}
