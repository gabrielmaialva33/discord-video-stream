import { MAX_INT16BIT, MediaUdp } from '#src/client/index'
import { BaseMediaPacketizer } from './base_media_packetizer.js'

/**
 * VP8 payload format
 */
export class VideoPacketizerVP8 extends BaseMediaPacketizer {
  private _pictureId: number

  constructor(connection: MediaUdp) {
    super(connection, 0x65, true)
    this._pictureId = 0
    this.srInterval = 5 * (connection.mediaConnection.streamOptions.fps || 30) * 3 // ~5 seconds, assuming ~3 packets per frame
  }

  override sendFrame(frame: Buffer): void {
    super.sendFrame(frame)
    const dataChunks = this.partitionDataMTUSizedChunks(frame)

    let bytesSent = 0
    dataChunks.forEach((chunk, index) => {
      const isLastPacket = index === dataChunks.length - 1
      const isFirstPacket = index === 0
      const packet = this.createPacket(chunk, isLastPacket, isFirstPacket)

      this.mediaUdp.sendPacket(packet)
      bytesSent += packet.length
    })

    this.onFrameSent(dataChunks.length, bytesSent)
  }

  createPacket(chunk: Buffer, isLastPacket = true, isFirstPacket = true): Buffer {
    if (chunk.length > this.mtu) {
      throw new Error('error packetizing video frame: frame is larger than mtu')
    }

    const packetHeader = this.makeRtpHeader(isLastPacket)
    const packetData = this.makeChunk(chunk, isFirstPacket)

    const nonceBuffer = this.mediaUdp.getNewNonceBuffer()
    return Buffer.concat([
      packetHeader,
      this.encryptData(packetData, nonceBuffer),
      nonceBuffer.subarray(0, 4),
    ])
  }

  override onFrameSent(packetsSent: number, bytesSent: number): void {
    super.onFrameSent(packetsSent, bytesSent)
    this.incrementTimestamp(90000 / (this.mediaUdp.mediaConnection.streamOptions.fps || 30))
    this.incrementPictureId()
  }

  private incrementPictureId(): void {
    this._pictureId = (this._pictureId + 1) % MAX_INT16BIT
  }

  private makeChunk(frameData: Buffer, isFirstPacket: boolean): Buffer {
    const headerExtensionBuf = this.createHeaderExtension()

    const payloadDescriptorBuf = Buffer.alloc(2)
    payloadDescriptorBuf[0] = 0x80
    payloadDescriptorBuf[1] = 0x80

    if (isFirstPacket) {
      payloadDescriptorBuf[0] |= 0b00010000 // mark S bit, indicates start of frame
    }

    const pictureIdBuf = Buffer.alloc(2)
    pictureIdBuf.writeUIntBE(this._pictureId, 0, 2)
    pictureIdBuf[0] |= 0b10000000

    return Buffer.concat([headerExtensionBuf, payloadDescriptorBuf, pictureIdBuf, frameData])
  }
}
