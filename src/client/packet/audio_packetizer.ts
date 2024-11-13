import { BaseMediaPacketizer } from '#src/client/packet/base_media_packetizer'
import { MediaUdp } from '#src/client/voice/media_udp'

const FRAME_SIZE = (48000 / 100) * 2

export class AudioPacketizer extends BaseMediaPacketizer {
  constructor(connection: MediaUdp) {
    super(connection, 0x78)
    this.srInterval = (5 * 48000) / FRAME_SIZE // ~5 seconds
  }

  override async sendFrame(frame: Buffer): Promise<void> {
    super.sendFrame(frame)
    const packet = await this.createPacket(frame)
    this.mediaUdp.sendPacket(packet)
    this.onFrameSent(packet.length)
  }

  async createPacket(chunk: Buffer): Promise<Buffer> {
    const header = this.makeRtpHeader()

    const nonceBuffer = this.mediaUdp.getNewNonceBuffer()
    return Buffer.concat([
      header,
      await this.encryptData(chunk, nonceBuffer, header),
      nonceBuffer.subarray(0, 4),
    ])
  }

  override async onFrameSent(bytesSent: number): Promise<void> {
    await super.onFrameSent(1, bytesSent)
    this.incrementTimestamp(FRAME_SIZE)
  }
}
