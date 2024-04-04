export function normalizeVideoCodec(codec: string): 'H264' | 'H265' | 'VP8' | 'VP9' | 'AV1' {
  if (/H\.?264|AVC/i.test(codec)) return 'H264'
  if (/H\.?265|HEVC/i.test(codec)) return 'H265'
  if (/VP([89])/i.test(codec)) return codec.toUpperCase() as 'VP8' | 'VP9'
  if (/AV1/i.test(codec)) return 'AV1'
  throw new Error(`Unknown codec: ${codec}`)
}
