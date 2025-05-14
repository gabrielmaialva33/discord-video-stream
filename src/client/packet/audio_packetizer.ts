import { BaseMediaPacketizer } from '#src/client/packet/base_media_packetizer'
import { MediaUdp } from '#src/client/voice/media_udp'
import { CodecPayloadType } from '../voice/index.js'

export class AudioPacketizer extends BaseMediaPacketizer {
  constructor(connection: MediaUdp, ssrc: number) {
    super(connection, ssrc, CodecPayloadType.opus.payload_type)
  }

  public override async sendFrame(frame: Buffer, frametime: number): Promise<void> {
    super.sendFrame(frame, frametime)
    const packet = await this.createPacket(frame)
    this.mediaUdp.sendPacket(packet)
    this.onFrameSent(packet.length, frametime)
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
