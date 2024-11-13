export function normalizeVideoCodec(codec: string): 'H264' | 'H265' | 'VP8' | 'VP9' | 'AV1' {
  if (/H\.?264|AVC/i.test(codec)) return 'H264'
  if (/H\.?265|HEVC/i.test(codec)) return 'H265'
  if (/VP([89])/i.test(codec)) return codec.toUpperCase() as 'VP8' | 'VP9'
  if (/AV1/i.test(codec)) return 'AV1'
  throw new Error(`Unknown codec: ${codec}`)
}

// The available video streams are sent by client on connection to voice gateway using OpCode Identify (0)
// The server then replies with the ssrc and rtxssrc for each available stream using OpCode Ready (2)
// RID is used specifically to distinguish between different simulcast streams of the same video source,
// but we don't really care about sending multiple quality streams, so we hardcode a single one
export const STREAMS_SIMULCAST = [{ type: 'screen', rid: '100', quality: 100 }]

export enum SupportedEncryptionModes {
  AES256 = 'aead_aes256_gcm_rtpsize',
  XCHACHA20 = 'aead_xchacha20_poly1305_rtpsize',
}

export type SupportedVideoCodec = 'H264' | 'H265' | 'VP8' | 'VP9' | 'AV1'

// RTP extensions
export const extensions = [{ id: 5, len: 2, val: 0 }]

export const MAX_INT16BIT = 2 ** 16
export const MAX_INT32BIT = 2 ** 32
