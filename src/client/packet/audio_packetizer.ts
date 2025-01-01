import { BaseMediaPacketizer } from '#src/client/packet/base_media_packetizer'
import { MediaUdp } from '#src/client/voice/media_udp'
import { CodecPayloadType } from '../voice/index.js'

export class AudioPacketizer extends BaseMediaPacketizer {
  constructor(connection: MediaUdp) {
    super(connection, CodecPayloadType.opus.payload_type)
    this.srInterval = (5 * 1000) / 20 // ~5 seconds for 20ms frame time
  }

  public override async sendFrame(frame: Buffer, frameTime: number): Promise<void> {
    super.sendFrame(frame, frameTime)
    const packet = await this.createPacket(frame)
    this.mediaUdp.sendPacket(packet)
    this.onFrameSent(packet.length, frameTime)
  }

  public async createPacket(chunk: Buffer): Promise<Buffer> {
    const header = this.makeRtpHeader()

    const [ciphertext, nonceBuffer] = await this.encryptData(chunk, header)
    return Buffer.concat([header, ciphertext, nonceBuffer.subarray(0, 4)])
  }

  public override async onFrameSent(bytesSent: number, frametime: number): Promise<void> {
    await super.onFrameSent(1, bytesSent, frametime)
    this.incrementTimestamp(frametime * (48000 / 1000))
  }
}
