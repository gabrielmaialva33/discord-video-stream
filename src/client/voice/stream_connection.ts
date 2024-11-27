import { BaseMediaConnection } from '#src/client/voice/base_media_connection'
import { VoiceOpCodes } from '#src/client/voice/voice_op_codes'

export class StreamConnection extends BaseMediaConnection {
  private _streamKey: string | null = null

  public get streamKey(): string | null {
    return this._streamKey
  }

  public set streamKey(value: string) {
    this._streamKey = value
  }

  private _serverId: string | null = null

  public override get serverId(): string | null {
    return this._serverId
  }

  public set serverId(id: string) {
    this._serverId = id
  }

  public override setSpeaking(speaking: boolean): void {
    this.sendOpcode(VoiceOpCodes.SPEAKING, {
      delay: 0,
      speaking: speaking ? 2 : 0,
      ssrc: this.ssrc,
    })
  }
}
