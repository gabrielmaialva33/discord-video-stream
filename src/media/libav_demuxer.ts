import pDebounce from 'p-debounce'
import { Log } from 'debug-level'
import { uid } from 'uid'
import { PassThrough } from 'node:stream'
import type { Readable } from 'node:stream'

import LibAV from '@libav.js/variant-webcodecs'
import { AVCodecID } from './libav_codec_id.js'
import {
  H264Helpers,
  H264NalUnitTypes,
  H265Helpers,
  H265NalUnitTypes,
  mergeNalu,
  splitNalu,
} from '../client/processing/annex_bhelper.js'

type MediaStreamInfoCommon = {
  index: number
  codec: AVCodecID
}
type VideoStreamInfo = MediaStreamInfoCommon & {
  width: number
  height: number
  framerate_num: number
  framerate_den: number
  extradata?: unknown
}
type AudioStreamInfo = MediaStreamInfoCommon & {
  sample_rate: number
}

type H264ParamSets = Record<'sps' | 'pps', Buffer[]>
type H265ParamSets = Record<'vps' | 'sps' | 'pps', Buffer[]>

const allowedVideoCodec = new Set([
  AVCodecID.AV_CODEC_ID_H264,
  AVCodecID.AV_CODEC_ID_H265,
  AVCodecID.AV_CODEC_ID_VP8,
  AVCodecID.AV_CODEC_ID_VP9,
  AVCodecID.AV_CODEC_ID_AV1,
])

const allowedAudioCodec = new Set([AVCodecID.AV_CODEC_ID_OPUS])

// Parse the avcC atom, which contains SPS and PPS
function parseavcC(input: Buffer) {
  if (input[0] != 1) throw new Error('Only configurationVersion 1 is supported')
  // Skip a bunch of stuff we don't care about
  input = input.subarray(5)

  const sps: Buffer[] = []
  const pps: Buffer[] = []

  // Read the SPS
  const spsCount = input[0] & 0b11111
  input = input.subarray(1)
  for (let i = 0; i < spsCount; ++i) {
    const spsLength = input.readUInt16BE()
    input = input.subarray(2)
    sps.push(input.subarray(0, spsLength))
    input = input.subarray(spsLength)
  }

  // Read the PPS
  const ppsCount = input[0]
  input = input.subarray(1)
  for (let i = 0; i < ppsCount; ++i) {
    const ppsLength = input.readUInt16BE()
    input = input.subarray(2)
    pps.push(input.subarray(0, ppsLength))
    input = input.subarray(ppsLength)
  }
  return { sps, pps }
}

// Parse the hvcC atom, which contains VPS, SPS, PPS
function parsehvcC(input: Buffer) {
  if (input[0] != 1) throw new Error('Only configurationVersion 1 is supported')
  // Skip a bunch of stuff we don't care about
  input = input.subarray(22)

  const vps: Buffer[] = []
  const sps: Buffer[] = []
  const pps: Buffer[] = []

  const numOfArrays = input[0]
  input = input.subarray(1)

  for (let i = 0; i < numOfArrays; ++i) {
    const naluType = input[0] & 0b111111
    input = input.subarray(1)

    const naluCount = input.readUInt16BE()
    input = input.subarray(2)

    for (let j = 0; j < naluCount; ++j) {
      const naluLength = input.readUInt16BE()
      input = input.subarray(2)

      const nalu = input.subarray(0, naluLength)
      input = input.subarray(naluLength)

      if (naluType == H265NalUnitTypes.VPS_NUT) vps.push(nalu)
      else if (naluType == H265NalUnitTypes.SPS_NUT) sps.push(nalu)
      else if (naluType == H265NalUnitTypes.PPS_NUT) pps.push(nalu)
    }
  }
  return { vps, sps, pps }
}

function h264AddParamSets(frame: Buffer, paramSets: H264ParamSets) {
  const { sps, pps } = paramSets
  const nalus = splitNalu(frame)
  // Technically non-IDR I frames exist ("open GOP"), but they're exceedingly
  // rare in the wild, and no encoder produces it by default
  let isIDR = false
  let hasSPS = false
  let hasPPS = false
  for (const nalu of nalus) {
    const naluType = H264Helpers.getUnitType(nalu)
    if (naluType == H264NalUnitTypes.CodedSliceIdr) isIDR = true
    else if (naluType == H264NalUnitTypes.SPS) hasSPS = true
    else if (naluType == H264NalUnitTypes.PPS) hasPPS = true
  }
  if (!isIDR) {
    // Not an IDR, return as is
    return frame
  }
  const chunks = []
  if (!hasPPS) chunks.push(...sps)
  if (!hasSPS) chunks.push(...pps)
  return mergeNalu([...chunks, ...nalus])
}

function h265AddParamSets(frame: Buffer, paramSets: H265ParamSets) {
  const { vps, sps, pps } = paramSets
  const nalus = splitNalu(frame)
  // Technically non-IDR I frames exist ("open GOP"), but they're exceedingly
  // rare in the wild, and no encoder produces it by default
  let isIDR = false
  let hasVPS = false
  let hasSPS = false
  let hasPPS = false
  for (const nalu of nalus) {
    const naluType = H265Helpers.getUnitType(nalu)
    if (naluType == H265NalUnitTypes.IDR_N_LP || naluType == H265NalUnitTypes.IDR_W_RADL)
      isIDR = true
    else if (naluType == H265NalUnitTypes.VPS_NUT) hasVPS = true
    else if (naluType == H265NalUnitTypes.SPS_NUT) hasSPS = true
    else if (naluType == H265NalUnitTypes.PPS_NUT) hasPPS = true
  }
  if (!isIDR) {
    // Not an IDR, return as is
    return frame
  }
  const chunks = []
  if (!hasVPS) chunks.push(...vps)
  if (!hasPPS) chunks.push(...sps)
  if (!hasSPS) chunks.push(...pps)
  return mergeNalu([...chunks, ...nalus])
}

const idToStream = new Map<string, Readable>()
const libavPromise = LibAV.LibAV({ yesthreads: true })
libavPromise.then((libav) => {
  libav.onread = (id) => {
    idToStream.get(id)?.resume()
  }
})

export async function demux(input: Readable) {
  const loggerInput = new Log('demux:input')
  const loggerFormat = new Log('demux:format')
  const loggerFrameCommon = new Log('demux:frame:common')
  const loggerFrameVideo = new Log('demux:frame:video')
  const loggerFrameAudio = new Log('demux:frame:audio')

  const libav = await libavPromise
  const filename = uid()
  await libav.mkreaderdev(filename)
  idToStream.set(filename, input)

  const ondata = (chunk: Buffer) => {
    loggerInput.trace(`Received ${chunk.length} bytes of data for input ${filename}`)
    libav.ff_reader_dev_send(filename, chunk)
  }
  const onend = () => {
    loggerInput.trace(`Reached the end of input ${filename}`)
    libav.ff_reader_dev_send(filename, null)
  }
  input.on('data', ondata)
  input.on('end', onend)

  const [fmt_ctx, streams] = await libav.ff_init_demuxer_file(filename, 'matroska')
  const pkt = await libav.av_packet_alloc()

  const cleanup = () => {
    vPipe.off('drain', readFrame)
    aPipe.off('drain', readFrame)
    input.off('data', ondata)
    input.off('end', onend)
    idToStream.delete(filename)
    libav.avformat_close_input_js(fmt_ctx)
    libav.av_packet_free(pkt)
    libav.unlink(filename)
  }

  const vStream = streams.find((stream) => stream.codec_type == libav.AVMEDIA_TYPE_VIDEO)
  const aStream = streams.find((stream) => stream.codec_type == libav.AVMEDIA_TYPE_AUDIO)
  let vInfo: VideoStreamInfo | undefined
  let aInfo: AudioStreamInfo | undefined
  const vPipe = new PassThrough({ objectMode: true, highWaterMark: 128 })
  const aPipe = new PassThrough({ objectMode: true, highWaterMark: 128 })

  if (vStream) {
    if (!allowedVideoCodec.has(vStream.codec_id)) {
      const codecName = await libav.avcodec_get_name(vStream.codec_id)
      cleanup()
      throw new Error(`Video codec ${codecName} is not allowed`)
    }
    vInfo = {
      index: vStream.index,
      codec: vStream.codec_id,
      width: await libav.AVCodecParameters_width(vStream.codecpar),
      height: await libav.AVCodecParameters_height(vStream.codecpar),
      framerate_num: await libav.AVCodecParameters_framerate_num(vStream.codecpar),
      framerate_den: await libav.AVCodecParameters_framerate_den(vStream.codecpar),
    }
    if (vStream.codec_id == AVCodecID.AV_CODEC_ID_H264) {
      const { extradata } = await libav.ff_copyout_codecpar(vStream.codecpar)
      vInfo = {
        ...vInfo,
        extradata: parseavcC(Buffer.from(extradata!)),
      }
    } else if (vStream.codec_id == AVCodecID.AV_CODEC_ID_H265) {
      const { extradata } = await libav.ff_copyout_codecpar(vStream.codecpar)
      vInfo = {
        ...vInfo,
        extradata: parsehvcC(Buffer.from(extradata!)),
      }
    }
    loggerFormat.info(
      {
        info: vInfo,
      },
      `Found video stream in input ${filename}`
    )
  }
  if (aStream) {
    if (!allowedAudioCodec.has(aStream.codec_id)) {
      const codecName = await libav.avcodec_get_name(aStream.codec_id)
      cleanup()
      throw new Error(`Audio codec ${codecName} is not allowed`)
    }
    aInfo = {
      index: aStream.index,
      codec: aStream.codec_id,
      sample_rate: await libav.AVCodecParameters_sample_rate(aStream.codecpar),
    }
    loggerFormat.info(
      {
        info: aInfo,
      },
      `Found audio stream in input ${filename}`
    )
  }

  const readFrame = pDebounce.promise(async () => {
    let resume = true
    while (resume) {
      const [status, streams] = await libav.ff_read_frame_multi(fmt_ctx, pkt, {
        limit: 1,
        unify: true,
      })
      for (const packet of streams[0] ?? []) {
        if (vInfo && vInfo.index === packet.stream_index) {
          if (vInfo.codec === AVCodecID.AV_CODEC_ID_H264) {
            packet.data = h264AddParamSets(
              Buffer.from(packet.data),
              vInfo.extradata! as H264ParamSets
            )
          } else if (vInfo.codec === AVCodecID.AV_CODEC_ID_H265) {
            packet.data = h265AddParamSets(
              Buffer.from(packet.data),
              vInfo.extradata! as H265ParamSets
            )
          }
          resume &&= vPipe.write(packet)
          loggerFrameVideo.trace('Pushed a frame into the video pipe')
        } else if (aInfo && aInfo.index === packet.stream_index) {
          resume &&= aPipe.write(packet)
          loggerFrameAudio.trace('Pushed a frame into the audio pipe')
        }
      }
      if (status < 0 && status != -libav.EAGAIN) {
        // End of file, or some error happened
        cleanup()
        vPipe.end()
        aPipe.end()
        if (status == LibAV.AVERROR_EOF) loggerFrameCommon.info('Reached end of stream. Stopping')
        else
          loggerFrameCommon.info({ status }, 'Received an error during frame extraction. Stopping')
        return
      }
      if (!resume) {
        input.pause()
        loggerInput.trace('Input stream paused')
      }
    }
  })
  vPipe.on('drain', () => {
    loggerFrameVideo.trace('Video pipe drained')
    readFrame()
  })
  aPipe.on('drain', () => {
    loggerFrameAudio.trace('Audio pipe drained')
    readFrame()
  })
  readFrame()
  return {
    video: vInfo ? { ...vInfo, stream: vPipe as Readable } : undefined,
    audio: aInfo ? { ...aInfo, stream: aPipe as Readable } : undefined,
  }
}
