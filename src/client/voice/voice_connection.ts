import { StreamConnection } from './stream_connection'
import { BaseMediaConnection } from './base_media_connection'

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
