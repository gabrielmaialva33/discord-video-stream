import { BaseMediaConnection } from '#src/client/index'
import { StreamConnection } from '#src/client/voice/stream_connection'

export class VoiceConnection extends BaseMediaConnection {
  streamConnection?: StreamConnection

  override get serverId(): string {
    return this.guildId
  }

  override stop(): void {
    super.stop()
    this.streamConnection?.stop()
  }
}
