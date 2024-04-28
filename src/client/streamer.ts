import { Client } from 'discord.js-selfbot-v13'

import { MediaUdp, StreamConnection, StreamOptions, VoiceConnection } from '#src/client/voice/index'
import { GatewayOpCodes } from '#src/client/gateway_op_codes'

export class Streamer {
  private _voiceConnection?: VoiceConnection
  private readonly _client: Client

  constructor(client: Client) {
    this._client = client

    //listen for messages
    this.client.on('raw', (packet: any) => {
      this.handleGatewayEvent(packet.t, packet.d)
    })
  }

  get client(): Client {
    return this._client
  }

  get voiceConnection(): VoiceConnection | undefined {
    return this._voiceConnection
  }

  sendOpcode(code: number, data: any): void {
    // @ts-ignore
    this.client.ws.broadcast({
      op: code,
      d: data,
    })
  }

  joinVoice(
    guild_id: string,
    channel_id: string,
    options?: Partial<StreamOptions>
  ): Promise<MediaUdp> {
    return new Promise<MediaUdp>((resolve, reject) => {
      if (!this.client.user) {
        reject('Client not logged in')
        return
      }
      this._voiceConnection = new VoiceConnection(
        guild_id,
        this.client.user.id,
        channel_id,
        options ?? {},
        (voiceUdp) => {
          resolve(voiceUdp)
        }
      )
      this.signalVideo(guild_id, channel_id, false)
    })
  }

  createStream(options?: Partial<StreamOptions>): Promise<MediaUdp> {
    return new Promise<MediaUdp>((resolve, reject) => {
      if (!this.client.user) {
        reject('Client not logged in')
        return
      }
      if (!this.voiceConnection) {
        reject('cannot start stream without first joining voice channel')
        return
      }

      this.signalStream(this.voiceConnection.guildId, this.voiceConnection.channelId)

      this.voiceConnection.streamConnection = new StreamConnection(
        this.voiceConnection.guildId,
        this.client.user.id,
        this.voiceConnection.channelId,
        options ?? {},
        (voiceUdp) => {
          resolve(voiceUdp)
        }
      )
    })
  }

  stopStream(): void {
    const stream = this.voiceConnection?.streamConnection

    if (!stream) return

    stream.stop()

    this.signalStopStream(stream.guildId, stream.channelId)

    this.voiceConnection.streamConnection = undefined
  }

  leaveVoice(): void {
    this.voiceConnection?.stop()

    this.signalLeaveVoice()

    this._voiceConnection = undefined
  }

  signalVideo(guild_id: string, channel_id: string, video_enabled: boolean): void {
    this.sendOpcode(GatewayOpCodes.VOICE_STATE_UPDATE, {
      guild_id,
      channel_id,
      self_mute: false,
      self_deaf: true,
      self_video: video_enabled,
    })
  }

  signalStream(guild_id: string, channel_id: string): void {
    this.sendOpcode(GatewayOpCodes.STREAM_CREATE, {
      type: 'guild',
      guild_id,
      channel_id,
      preferred_region: null,
    })

    this.sendOpcode(GatewayOpCodes.STREAM_SET_PAUSED, {
      stream_key: `guild:${guild_id}:${channel_id}:${this.client.user!.id}`,
      paused: false,
    })
  }

  signalStopStream(guild_id: string, channel_id: string): void {
    this.sendOpcode(GatewayOpCodes.STREAM_DELETE, {
      stream_key: `guild:${guild_id}:${channel_id}:${this.client.user!.id}`,
    })
  }

  signalLeaveVoice(): void {
    this.sendOpcode(GatewayOpCodes.VOICE_STATE_UPDATE, {
      guild_id: null,
      channel_id: null,
      self_mute: true,
      self_deaf: false,
      self_video: false,
    })
  }

  private handleGatewayEvent(event: string, data: any): void {
    switch (event) {
      case 'VOICE_STATE_UPDATE': {
        if (data.user_id === this.client.user!.id) {
          // transfer session data to voice connection
          this.voiceConnection?.setSession(data.session_id)
        }
        break
      }
      case 'VOICE_SERVER_UPDATE': {
        // transfer voice server update to voice connection
        if (data.guild_id !== this.voiceConnection?.guildId) return

        this.voiceConnection?.setTokens(data.endpoint, data.token)
        break
      }
      case 'STREAM_CREATE': {
        const [type, guildId, channelId, userId] = data.stream_key.split(':')
        console.log({ type, guildId, channelId, userId })

        if (this.voiceConnection?.guildId !== guildId) return

        if (userId === this.client.user!.id) {
          this.voiceConnection!.streamConnection!.serverId = data.rtc_server_id

          this.voiceConnection!.streamConnection!.streamKey = data.stream_key
          this.voiceConnection!.streamConnection!.setSession(this.voiceConnection!.session_id!)
        }
        break
      }
      case 'STREAM_SERVER_UPDATE': {
        const [type, guildId, channelId, userId] = data.stream_key.split(':')
        console.log({ type, guildId, channelId, userId })

        if (this.voiceConnection?.guildId !== guildId) return

        if (userId === this.client.user!.id) {
          this.voiceConnection!.streamConnection!.setTokens(data.endpoint, data.token)
        }
        break
      }
    }
  }
}
