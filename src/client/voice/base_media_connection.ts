import WebSocket from 'ws'

import { MediaUdp } from '#src/client/voice/media_udp'
import { VoiceOpCodes } from '#src/client/voice/voice_op_codes'

import { streamOpts } from '#src/client/index'
import { normalizeVideoCodec } from '#src/utils'

type VoiceConnectionStatus = {
  hasSession: boolean
  hasToken: boolean
  started: boolean
  resuming: boolean
}

export abstract class BaseMediaConnection {
  udp: MediaUdp
  guildId: string
  channelId: string
  botId: string
  ws: WebSocket
  ready: (udp: MediaUdp) => void
  status: VoiceConnectionStatus
  server: string //websocket url
  token: string
  session_id: string
  self_ip: string
  self_port: number
  address: string
  port: number
  ssrc: number
  videoSsrc: number
  rtxSsrc: number
  modes: string[]
  secretkey: Uint8Array
  private interval: NodeJS.Timeout

  constructor(
    guildId: string,
    botId: string,
    channelId: string,
    callback: (udp: MediaUdp) => void
  ) {
    this.status = {
      hasSession: false,
      hasToken: false,
      started: false,
      resuming: false,
    }

    // make udp client
    this.udp = new MediaUdp(this)

    this.guildId = guildId
    this.channelId = channelId
    this.botId = botId
    this.ready = callback
  }

  abstract get serverId(): string

  stop(): void {
    clearInterval(this.interval)
    this.status.started = false
    this.ws?.close()
    this.udp?.stop()
  }

  setSession(session_id: string): void {
    this.session_id = session_id

    this.status.hasSession = true
    this.start()
  }

  setTokens(server: string, token: string): void {
    this.token = token
    this.server = server

    this.status.hasToken = true
    this.start()
  }

  start(): void {
    /*
     ** Connection can only start once both
     ** session description and tokens have been gathered
     */
    if (this.status.hasSession && this.status.hasToken) {
      if (this.status.started) return
      this.status.started = true

      this.ws = new WebSocket('wss://' + this.server + '/?v=7', {
        followRedirects: true,
      })
      this.ws.on('open', () => {
        if (this.status.resuming) {
          this.status.resuming = false
          this.resume()
        } else {
          this.identify()
        }
      })
      this.ws.on('error', (err) => {
        console.error(err)
      })
      this.ws.on('close', (code) => {
        const wasStarted = this.status.started

        this.status.started = false
        this.udp.ready = false

        const canResume = code === 4_015 || code < 4_000

        if (canResume && wasStarted) {
          this.status.resuming = true
          this.start()
        }
      })
      this.setupEvents()
    }
  }

  handleReady(d: any): void {
    this.ssrc = d.ssrc
    this.address = d.ip
    this.port = d.port
    this.modes = d.modes
    this.videoSsrc = this.ssrc + 1 // todo: set it from packet streams object
    this.rtxSsrc = this.ssrc + 2

    this.udp.audioPacketizer.ssrc = this.ssrc
    this.udp.videoPacketizer.ssrc = this.videoSsrc
  }

  handleSession(d: any): void {
    this.secretkey = new Uint8Array(d.secret_key)

    this.ready(this.udp)
    this.udp.ready = true
  }

  setupEvents(): void {
    this.ws.on('message', (data: any) => {
      const { op, d } = JSON.parse(data)

      if (op === VoiceOpCodes.READY) {
        // ready
        this.handleReady(d)
        this.sendVoice()
        this.setVideoStatus(false)
      } else if (op >= 4000) {
        console.error(`Error ${this.constructor.name} connection`, d)
      } else if (op === VoiceOpCodes.HELLO) {
        this.setupHeartbeat(d.heartbeat_interval)
      } else if (op === VoiceOpCodes.SELECT_PROTOCOL_ACK) {
        // session description
        this.handleSession(d)
      } else if (op === VoiceOpCodes.SPEAKING) {
        // ignore speaking updates
      } else if (op === VoiceOpCodes.HEARTBEAT_ACK) {
        // ignore heartbeat acknowledgements
      } else if (op === VoiceOpCodes.RESUMED) {
        this.status.started = true
        this.udp.ready = true
      } else {
        //console.log("unhandled voice event", {op, d});
      }
    })
  }

  setupHeartbeat(interval: number): void {
    if (this.interval) {
      clearInterval(this.interval)
    }
    this.interval = setInterval(() => {
      this.sendOpcode(VoiceOpCodes.HEARTBEAT, 42069)
    }, interval)
  }

  sendOpcode(code: number, data: any): void {
    this.ws.send(
      JSON.stringify({
        op: code,
        d: data,
      })
    )
  }

  /*
   ** identifies with media server with credentials
   */
  identify(): void {
    this.sendOpcode(VoiceOpCodes.IDENTIFY, {
      server_id: this.serverId,
      user_id: this.botId,
      session_id: this.session_id,
      token: this.token,
      video: true,
      streams: [{ type: 'screen', rid: '100', quality: 100 }],
    })
  }

  resume(): void {
    this.sendOpcode(VoiceOpCodes.RESUME, {
      server_id: this.serverId,
      session_id: this.session_id,
      token: this.token,
    })
  }

  /*
   ** Sets protocols and ip data used for video and audio.
   ** Uses vp8 for video
   ** Uses opus for audio
   */
  setProtocols(): void {
    this.sendOpcode(VoiceOpCodes.SELECT_PROTOCOL, {
      protocol: 'udp',
      codecs: [
        { name: 'opus', type: 'audio', priority: 1000, payload_type: 120 },
        {
          name: normalizeVideoCodec(streamOpts.video_codec || 'h264'),
          type: 'video',
          priority: 1000,
          payload_type: 101,
          rtx_payload_type: 102,
          encode: true,
          decode: true,
        },
        //{ name: "VP8", type: "video", priority: 3000, payload_type: 103, rtx_payload_type: 104, encode: true, decode: true }
        //{ name: "VP9", type: "video", priority: 3000, payload_type: 105, rtx_payload_type: 106 },
      ],
      data: {
        address: this.self_ip,
        port: this.self_port,
        mode: 'xsalsa20_poly1305_lite',
      },
    })
  }

  /*
   ** Sets video status.
   ** bool -> video on or off
   ** video and rtx sources are set to ssrc + 1 and ssrc + 2
   */
  setVideoStatus(bool: boolean): void {
    this.sendOpcode(VoiceOpCodes.VIDEO, {
      audio_ssrc: this.ssrc,
      video_ssrc: bool ? this.videoSsrc : 0,
      rtx_ssrc: bool ? this.rtxSsrc : 0,
      streams: [
        {
          type: 'video',
          rid: '100',
          ssrc: bool ? this.videoSsrc : 0,
          active: true,
          quality: 100,
          rtx_ssrc: bool ? this.rtxSsrc : 0,
          max_bitrate: (streamOpts.maxBitrateKbps || 4000) * 1000,
          max_framerate: streamOpts.fps,
          max_resolution: {
            type: 'fixed',
            width: streamOpts.width,
            height: streamOpts.height,
          },
        },
      ],
    })
  }

  /*
   ** Set speaking status
   ** speaking -> speaking status on or off
   */
  setSpeaking(speaking: boolean): void {
    this.sendOpcode(VoiceOpCodes.SPEAKING, {
      delay: 0,
      speaking: speaking ? 1 : 0,
      ssrc: this.ssrc,
    })
  }

  /*
   ** Start media connection
   */
  sendVoice(): Promise<void> {
    return new Promise<void>((resolve, _reject) => {
      this.udp.createUdp().then(() => {
        resolve()
      })
    })
  }
}
