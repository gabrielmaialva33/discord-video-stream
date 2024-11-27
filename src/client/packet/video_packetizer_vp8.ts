import { BaseMediaPacketizer } from '#src/client/packet/base_media_packetizer'
import { MediaUdp } from '#src/client/voice/media_udp'
import { extensions, MAX_INT16BIT } from '#src/utils'

/**
 * VP8 payload format
 *
 */
export class VideoPacketizerVP8 extends BaseMediaPacketizer {
  private _pictureId: number

  constructor(connection: MediaUdp) {
    super(connection, 0x65, true)
    this._pictureId = 0
    this.srInterval = 5 * connection.mediaConnection.streamOptions.fps * 3 // ~5 seconds, assuming ~3 packets per frame
  }

  public override async sendFrame(frame: Buffer, frametime: number): Promise<void> {
    super.sendFrame(frame, frametime)
    const data = this.partitionDataMTUSizedChunks(frame)

    let bytesSent = 0
    const encryptedPackets = data.map((chunk, i) =>
      this.createPacket(chunk, i === data.length - 1, i === 0)
    )
    for (const packet of await Promise.all(encryptedPackets)) {
      this.mediaUdp.sendPacket(packet)
      bytesSent += packet.length
    }

    await this.onFrameSent(data.length, bytesSent, frametime)
  }

  public async createPacket(
    chunk: any,
    isLastPacket = true,
    isFirstPacket = true
  ): Promise<Buffer> {
    if (chunk.length > this.mtu)
      throw Error('error packetizing video frame: frame is larger than mtu')

    const packetHeader = Buffer.concat([
      this.makeRtpHeader(isLastPacket),
      this.createExtensionHeader(extensions),
    ])

    const packetData = Buffer.concat([
      this.createExtensionPayload(extensions),
      this.makeChunk(chunk, isFirstPacket),
    ])

    // nonce buffer used for encryption. 4 bytes are appended to end of packet
    const nonceBuffer = this.mediaUdp.getNewNonceBuffer()
    return Buffer.concat([
      packetHeader,
      await this.encryptData(packetData, nonceBuffer, packetHeader),
      nonceBuffer.subarray(0, 4),
    ])
  }

  public override async onFrameSent(
    packetsSent: number,
    bytesSent: number,
    frametime: number
  ): Promise<void> {
    await super.onFrameSent(packetsSent, bytesSent, frametime)
    // video RTP packet timestamp incremental value = 90,000Hz / fps
    this.incrementTimestamp((90000 / 1000) * frametime)
    this.incrementPictureId()
  }

  private incrementPictureId(): void {
    this._pictureId = (this._pictureId + 1) % MAX_INT16BIT
  }

  private makeChunk(frameData: any, isFirstPacket: boolean): Buffer {
    // vp8 payload descriptor
    const payloadDescriptorBuf = Buffer.alloc(2)

    payloadDescriptorBuf[0] = 0x80
    payloadDescriptorBuf[1] = 0x80
    if (isFirstPacket) {
      payloadDescriptorBuf[0] |= 0b00010000 // mark S bit, indicates start of frame
    }

    // vp8 pictureid payload extension
    const pictureIdBuf = Buffer.alloc(2)

    pictureIdBuf.writeUIntBE(this._pictureId, 0, 2)
    pictureIdBuf[0] |= 0b10000000

    return Buffer.concat([payloadDescriptorBuf, pictureIdBuf, frameData])
  }
}
