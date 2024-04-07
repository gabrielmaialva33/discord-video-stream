export interface StreamOpts {
  width?: number
  height?: number
  fps?: number
  bitrateKbps?: number
  maxBitrateKbps?: number
  hardware_acceleration?: boolean
  video_codec?: string
}

export const streamOpts: StreamOpts = {
  width: 1280,
  height: 720,
  fps: 30,
  bitrateKbps: 1000,
  maxBitrateKbps: 2500,
  hardware_acceleration: false,
  video_codec: 'H264',
}

export const setStreamOpts = (opts: StreamOpts) => {
  streamOpts.width = opts.width ?? streamOpts.width
  streamOpts.height = opts.height ?? streamOpts.height
  streamOpts.fps = opts.fps ?? streamOpts.fps
  streamOpts.bitrateKbps = opts.bitrateKbps ?? streamOpts.bitrateKbps
  streamOpts.maxBitrateKbps = opts.maxBitrateKbps ?? streamOpts.maxBitrateKbps
  streamOpts.hardware_acceleration = opts.hardware_acceleration ?? streamOpts.hardware_acceleration
  streamOpts.video_codec = opts.video_codec ?? streamOpts.video_codec
}
