import { BaseMediaConnection } from '#src/client/voice/base_media_connection'
import { VoiceOpCodes } from '#src/client/voice/voice_op_codes'

export class StreamConnection extends BaseMediaConnection {
  private _streamKey: string | null = null
  private _serverId: string | null = null

  public override setSpeaking(speaking: boolean): void {
    if (!this.webRtcParams) throw new Error('WebRTC connection not ready')
    this.sendOpcode(VoiceOpCodes.SPEAKING, {
      delay: 0,
      speaking: speaking ? 2 : 0,
      ssrc: this.webRtcParams.audioSsrc,
    })
  }

  public override get serverId(): string | null {
    return this._serverId
  }

  public set serverId(id: string) {
    this._serverId = id
  }

  public get streamKey(): string | null {
    return this._streamKey
  }

  public set streamKey(value: string) {
    this._streamKey = value
  }
}
