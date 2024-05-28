import { MediaUdp } from '#src/client/voice/media_udp'
import { BaseMediaPacketizer } from '#src/client/packet/base_media_packetizer'
import { Buffer } from 'node:buffer'

const FRAME_SIZE = (48000 / 100) * 2
const NONCE_SIZE = 4

export class AudioPacketizer extends BaseMediaPacketizer {
  private readonly frameSize: number
  private readonly nonceSize: number

  constructor(connection: MediaUdp) {
    super(connection, 0x78)
    this.srInterval = (5 * 48000) / FRAME_SIZE // ~5 seconds
    this.frameSize = FRAME_SIZE
    this.nonceSize = NONCE_SIZE
  }

  override sendFrame(frame: Buffer): void {
    super.sendFrame(frame)
    const packet = this.createPacket(frame)
    this.mediaUdp.sendPacket(packet)
    this.onFrameSent(packet.length)
  }

  createPacket(chunk: Buffer): Buffer {
    const header = this.makeRtpHeader()
    const nonceBuffer = this.mediaUdp.getNewNonceBuffer()
    const encryptedData = this.encryptData(chunk, nonceBuffer)

    return Buffer.concat([header, encryptedData, nonceBuffer.subarray(0, this.nonceSize)])
  }

  override onFrameSent(bytesSent: number): void {
    super.onFrameSent(1, bytesSent)
    this.incrementTimestamp(this.frameSize)
  }
}
