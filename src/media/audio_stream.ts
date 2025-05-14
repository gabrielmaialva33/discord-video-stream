import { BaseMediaStream } from './base_media_stream.js'
import { MediaUdp } from '../client/index.js'

export class AudioStream extends BaseMediaStream {
  public udp: MediaUdp

  constructor(udp: MediaUdp, noSleep = false) {
    super('audio', noSleep)
    this.udp = udp
  }

  protected override async _sendFrame(frame: Buffer, frametime: number): Promise<void> {
    await this.udp.sendAudioFrame(frame, frametime)
  }
}
