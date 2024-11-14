import { AVCodecID } from './libav_codec_id.js'
import { PassThrough, Readable, Transform } from 'node:stream'
import LibAV from '@libav.js/variant-webcodecs'
import {
  H264Helpers,
  H264NalUnitTypes,
  H265Helpers,
  H265NalUnitTypes,
  mergeNalu,
  splitNalu,
} from '../client/processing/annex_bhelper.js'
import { uid } from 'uid'

type MediaStreamInfoCommon = {
  index: number
  codec: AVCodecID
  stream: Transform
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

let libavPromise: Promise<LibAV.LibAV> | null = null

const allowedVideoCodecs = new Set([
  AVCodecID.AV_CODEC_ID_H264,
  AVCodecID.AV_CODEC_ID_H265,
  AVCodecID.AV_CODEC_ID_VP8,
  AVCodecID.AV_CODEC_ID_VP9,
  AVCodecID.AV_CODEC_ID_AV1,
])

const allowedAudioCodecs = new Set([AVCodecID.AV_CODEC_ID_OPUS])

// Parse the avcC atom to extract SPS and PPS
function parseavcC(input: Buffer): H264ParamSets {
  if (input[0] !== 1) throw new Error('Only configurationVersion 1 is supported')

  input = input.slice(5) // Skip to SPS count

  const sps: Buffer[] = []
  const pps: Buffer[] = []

  const spsCount = input[0] & 0b11111
  input = input.slice(1)
  for (let i = 0; i < spsCount; i++) {
    const spsLength = input.readUInt16BE(0)
    input = input.slice(2)
    sps.push(input.slice(0, spsLength))
    input = input.slice(spsLength)
  }

  const ppsCount = input[0]
  input = input.slice(1)
  for (let i = 0; i < ppsCount; i++) {
    const ppsLength = input.readUInt16BE(0)
    input = input.slice(2)
    pps.push(input.slice(0, ppsLength))
    input = input.slice(ppsLength)
  }

  return { sps, pps }
}

// Parse the hvcC atom to extract VPS, SPS, PPS
function parsehvcC(input: Buffer): H265ParamSets {
  if (input[0] !== 1) throw new Error('Only configurationVersion 1 is supported')

  input = input.slice(22) // Skip to arrays

  const vps: Buffer[] = []
  const sps: Buffer[] = []
  const pps: Buffer[] = []

  const numOfArrays = input[0]
  input = input.slice(1)

  for (let i = 0; i < numOfArrays; i++) {
    const naluType = input[0] & 0b111111
    input = input.slice(1)

    const naluCount = input.readUInt16BE(0)
    input = input.slice(2)

    for (let j = 0; j < naluCount; j++) {
      const naluLength = input.readUInt16BE(0)
      input = input.slice(2)

      const nalu = input.slice(0, naluLength)
      input = input.slice(naluLength)

      switch (naluType) {
        case H265NalUnitTypes.VPS_NUT:
          vps.push(nalu)
          break
        case H265NalUnitTypes.SPS_NUT:
          sps.push(nalu)
          break
        case H265NalUnitTypes.PPS_NUT:
          pps.push(nalu)
          break
      }
    }
  }

  return { vps, sps, pps }
}

// Add SPS and PPS to H.264 frames
function h264AddParamSets(frame: Buffer, paramSets: H264ParamSets): Buffer {
  const { sps, pps } = paramSets
  const nalus = splitNalu(frame)

  let isIDR = false
  let hasSPS = false
  let hasPPS = false

  for (const nalu of nalus) {
    const naluType = H264Helpers.getUnitType(nalu)
    if (naluType === H264NalUnitTypes.CodedSliceIdr) isIDR = true
    else if (naluType === H264NalUnitTypes.SPS) hasSPS = true
    else if (naluType === H264NalUnitTypes.PPS) hasPPS = true
  }

  if (!isIDR) return frame

  const newNalus = []
  if (!hasSPS) newNalus.push(...sps)
  if (!hasPPS) newNalus.push(...pps)

  return mergeNalu([...newNalus, ...nalus])
}

// Add VPS, SPS, PPS to H.265 frames
function h265AddParamSets(frame: Buffer, paramSets: H265ParamSets): Buffer {
  const { vps, sps, pps } = paramSets
  const nalus = splitNalu(frame)

  let isIDR = false
  let hasVPS = false
  let hasSPS = false
  let hasPPS = false

  for (const nalu of nalus) {
    const naluType = H265Helpers.getUnitType(nalu)
    if (naluType === H265NalUnitTypes.IDR_N_LP || naluType === H265NalUnitTypes.IDR_W_RADL)
      isIDR = true
    else if (naluType === H265NalUnitTypes.VPS_NUT) hasVPS = true
    else if (naluType === H265NalUnitTypes.SPS_NUT) hasSPS = true
    else if (naluType === H265NalUnitTypes.PPS_NUT) hasPPS = true
  }

  if (!isIDR) return frame

  const newNalus = []
  if (!hasVPS) newNalus.push(...vps)
  if (!hasSPS) newNalus.push(...sps)
  if (!hasPPS) newNalus.push(...pps)

  return mergeNalu([...newNalus, ...nalus])
}

export async function demux(input: Readable) {
  if (!libavPromise) libavPromise = LibAV.LibAV({ yesthreads: true })
  const libav = await libavPromise
  const filename = uid()
  await libav.mkreaderdev(filename)

  // Stream input data to LibAV
  input.on('data', (chunk: Buffer) => libav.ff_reader_dev_send(filename, chunk))
  input.on('end', () => libav.ff_reader_dev_send(filename, null))

  // Initialize demuxer
  // eslint-disable-next-line @typescript-eslint/naming-convention
  const [fmt_ctx, streams] = await libav.ff_init_demuxer_file(filename, 'matroska')
  const pkt = await libav.av_packet_alloc()

  const cleanup = () => {
    input.removeAllListeners()
    libav.avformat_close_input_js(fmt_ctx)
    libav.av_packet_free(pkt)
    libav.unlink(filename)
  }

  const vStream = streams.find((stream) => stream.codec_type === libav.AVMEDIA_TYPE_VIDEO)
  const aStream = streams.find((stream) => stream.codec_type === libav.AVMEDIA_TYPE_AUDIO)
  let vInfo: VideoStreamInfo | undefined
  let aInfo: AudioStreamInfo | undefined

  // Video stream setup
  if (vStream) {
    if (!allowedVideoCodecs.has(vStream.codec_id)) {
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
      stream: new PassThrough({ objectMode: true }),
    }
    const { extradata } = await libav.ff_copyout_codecpar(vStream.codecpar)
    if (extradata) {
      const extraBuffer = Buffer.from(extradata)
      if (vStream.codec_id === AVCodecID.AV_CODEC_ID_H264) {
        vInfo.extradata = parseavcC(extraBuffer)
      } else if (vStream.codec_id === AVCodecID.AV_CODEC_ID_H265) {
        vInfo.extradata = parsehvcC(extraBuffer)
      }
    }
  }

  // Audio stream setup
  if (aStream) {
    if (!allowedAudioCodecs.has(aStream.codec_id)) {
      const codecName = await libav.avcodec_get_name(aStream.codec_id)
      cleanup()
      throw new Error(`Audio codec ${codecName} is not allowed`)
    }
    aInfo = {
      index: aStream.index,
      codec: aStream.codec_id,
      sample_rate: await libav.AVCodecParameters_sample_rate(aStream.codecpar),
      stream: new PassThrough({ objectMode: true }),
    }
  }

  // Packet reading loop
  ;(async () => {
    try {
      while (true) {
        const [status, packets] = await libav.ff_read_multi(fmt_ctx, pkt, 1)
        if (status < 0 && status !== -libav.EAGAIN) {
          // End of file or error
          break
        }

        for (const packet of packets) {
          const streamIndex = packet.stream_index
          const packetData = Buffer.from(packet.data)

          if (vInfo && streamIndex === vInfo.index) {
            let frameData = packetData
            if (vInfo.extradata) {
              if (vInfo.codec === AVCodecID.AV_CODEC_ID_H264) {
                frameData = h264AddParamSets(frameData, vInfo.extradata as H264ParamSets)
              } else if (vInfo.codec === AVCodecID.AV_CODEC_ID_H265) {
                frameData = h265AddParamSets(frameData, vInfo.extradata as H265ParamSets)
              }
            }
            vInfo.stream.push({ ...packet, data: frameData })
          } else if (aInfo && streamIndex === aInfo.index) {
            aInfo.stream.push(packet)
          }
        }
      }
    } catch (error) {
      console.error('Error during demuxing:', error)
    } finally {
      // Clean up resources
      vInfo?.stream.end()
      aInfo?.stream.end()
      cleanup()
    }
  })()

  return { video: vInfo, audio: aInfo }
}
