import { BaseMediaConnection } from './base_media_connection.js'
import { VoiceOpCodes } from './voice_op_codes.js'

export class StreamConnection extends BaseMediaConnection {
  private _streamKey: string

  get streamKey(): string {
    return this._streamKey
  }

  set streamKey(value: string) {
    this._streamKey = value
  }

  private _serverId: string

  override get serverId(): string {
    return this._serverId
  }

  set serverId(id: string) {
    this._serverId = id
  }

  override setSpeaking(speaking: boolean): void {
    this.sendOpcode(VoiceOpCodes.SPEAKING, {
      delay: 0,
      speaking: speaking ? 2 : 0,
      ssrc: this.ssrc,
    })
  }
}
