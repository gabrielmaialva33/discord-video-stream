import { StreamConnection } from './stream_connection.js'
import { BaseMediaConnection } from './base_media_connection.js'

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
