export enum H264NalUnitTypes {
  Unspecified,
  CodedSliceNonIDR,
  CodedSlicePartitionA,
  CodedSlicePartitionB,
  CodedSlicePartitionC,
  CodedSliceIdr,
  SEI,
  SPS,
  PPS,
  AccessUnitDelimiter,
  EndOfSequence,
  EndOfStream,
  FillerData,
  SEIExtenstion,
  PrefixNalUnit,
  SubsetSPS,
}

export enum H265NalUnitTypes {
  TRAIL_N = 0,
  TRAIL_R = 1,
  TSA_N = 2,
  TSA_R = 3,
  STSA_N = 4,
  STSA_R = 5,
  RADL_N = 6,
  RADL_R = 7,
  RASL_N = 8,
  RASL_R = 9,
  RSV_VCL_N10 = 10,
  RSV_VCL_R11 = 11,
  RSV_VCL_N12 = 12,
  RSV_VCL_R13 = 13,
  RSV_VCL_N14 = 14,
  RSV_VCL_R15 = 15,
  BLA_W_LP = 16,
  BLA_W_RADL = 17,
  BLA_N_LP = 18,
  IDR_W_RADL = 19,
  IDR_N_LP = 20,
  CRA_NUT = 21,
  RSV_IRAP_VCL22 = 22,
  RSV_IRAP_VCL23 = 23,
  RSV_VCL24 = 24,
  RSV_VCL25 = 25,
  RSV_VCL26 = 26,
  RSV_VCL27 = 27,
  RSV_VCL28 = 28,
  RSV_VCL29 = 29,
  RSV_VCL30 = 30,
  RSV_VCL31 = 31,
  VPS_NUT = 32,
  SPS_NUT = 33,
  PPS_NUT = 34,
  AUD_NUT = 35,
  EOS_NUT = 36,
  EOB_NUT = 37,
  FD_NUT = 38,
  PREFIX_SEI_NUT = 39,
  SUFFIX_SEI_NUT = 40,
  RSV_NVCL41 = 41,
  RSV_NVCL42 = 42,
  RSV_NVCL43 = 43,
  RSV_NVCL44 = 44,
  RSV_NVCL45 = 45,
  RSV_NVCL46 = 46,
  RSV_NVCL47 = 47,
  UNSPEC48 = 48,
  UNSPEC49 = 49,
  UNSPEC50 = 50,
  UNSPEC51 = 51,
  UNSPEC52 = 52,
  UNSPEC53 = 53,
  UNSPEC54 = 54,
  UNSPEC55 = 55,
  UNSPEC56 = 56,
  UNSPEC57 = 57,
  UNSPEC58 = 58,
  UNSPEC59 = 59,
  UNSPEC60 = 60,
  UNSPEC61 = 61,
  UNSPEC62 = 62,
  UNSPEC63 = 63,
}

export interface AnnexBHelpers {
  getUnitType(frame: Buffer): number

  splitHeader(frame: Buffer): [Buffer, Buffer]

  isAUD(unitType: number): boolean
}

export const H264Helpers: AnnexBHelpers = {
  getUnitType(frame) {
    return frame[0] & 0x1f
  },
  splitHeader(frame) {
    return [frame.subarray(0, 1), frame.subarray(1)]
  },
  isAUD(unitType) {
    return unitType === H264NalUnitTypes.AccessUnitDelimiter
  },
}

export const H265Helpers: AnnexBHelpers = {
  getUnitType(frame) {
    return (frame[0] >> 1) & 0x3f
  },
  splitHeader(frame) {
    return [frame.subarray(0, 2), frame.subarray(2)]
  },
  isAUD(unitType) {
    return unitType === H265NalUnitTypes.AUD_NUT
  },
}

// Get individual NAL units from an AVPacket frame
export function splitNalu(frame: Buffer) {
  const nalus = []
  let offset = 0
  while (offset < frame.length) {
    const naluSize = frame.readUInt32BE(offset)
    offset += 4
    const nalu = frame.subarray(offset, offset + naluSize)
    nalus.push(nalu)
    offset += nalu.length
  }
  return nalus
}

// Merge NAL units into an AVPacket frame
export function mergeNalu(nalus: Buffer[]) {
  const chunks = []
  for (const nalu of nalus) {
    const size = Buffer.allocUnsafe(4)
    size.writeUInt32BE(nalu.length)
    chunks.push(size, nalu)
  }
  return Buffer.concat(chunks)
}
