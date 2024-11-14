import { BaseMediaStream } from './base_media_stream.js'
import { MediaUdp } from '../client/index.js'
import { Packet } from '@libav.js/variant-webcodecs'
import { combineLoHi } from './utils.js'

export class VideoStream extends BaseMediaStream {
  private udp: MediaUdp

  constructor(udp: MediaUdp) {
    super({ objectMode: true })
    this.udp = udp
  }

  async _write(frame: Packet, _encoding: BufferEncoding, callback: (error?: Error | null) => void) {
    try {
      await this._waitForOtherStream()

      // eslint-disable-next-line @typescript-eslint/naming-convention
      const { data, ptshi, pts, time_base_num, time_base_den } = frame

      // Send the video frame via UDP
      await this.udp.sendVideoFrame(Buffer.from(data))

      // Update presentation timestamp (PTS)
      if (
        ptshi !== undefined &&
        pts !== undefined &&
        time_base_num !== undefined &&
        time_base_den !== undefined
      ) {
        this.pts = (combineLoHi(ptshi, pts) * time_base_num) / time_base_den
      }

      callback()
    } catch (error) {
      callback(error)
    }
  }
}
