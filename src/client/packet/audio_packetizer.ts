import { MediaUdp } from '#src/client/voice/media_udp'
import { BaseMediaPacketizer } from '#src/client/packet/base_media_packetizer'

const FRAME_SIZE = (48000 / 100) * 2

export class AudioPacketizer extends BaseMediaPacketizer {
  constructor(connection: MediaUdp) {
    super(connection, 0x78)
    this.srInterval = (5 * 48000) / FRAME_SIZE // ~5 seconds
  }

  override sendFrame(frame: any): void {
    super.sendFrame(frame)
    const packet = this.createPacket(frame)
    this.mediaUdp.sendPacket(packet)
    this.onFrameSent(packet.length)
  }

  createPacket(chunk: any): Buffer {
    const header = this.makeRtpHeader()

    const nonceBuffer = this.mediaUdp.getNewNonceBuffer()
    return Buffer.concat([header, this.encryptData(chunk, nonceBuffer), nonceBuffer.subarray(0, 4)])
  }

  override onFrameSent(bytesSent: number): void {
    super.onFrameSent(1, bytesSent)
    this.incrementTimestamp(FRAME_SIZE)
  }
}
