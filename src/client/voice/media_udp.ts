import udpCon from 'node:dgram'
import { isIPv4 } from 'node:net'
import { BaseMediaConnection } from './base_media_connection.js'
import {
  AudioPacketizer,
  BaseMediaPacketizer,
  VideoPacketizerH264,
  VideoPacketizerH265,
  VideoPacketizerVP8,
} from '../packet/index.js'
import { normalizeVideoCodec } from '../../utils.js'

// credit to discord.js
function parseLocalPacket(message: Buffer) {
  const packet = Buffer.from(message)

  const ip = packet.subarray(8, packet.indexOf(0, 8)).toString('utf8')

  if (!isIPv4(ip)) {
    throw new Error('Malformed IP address')
  }

  const port = packet.readUInt16BE(packet.length - 2)

  return { ip, port }
}

export class MediaUdp {
  private readonly _mediaConnection: BaseMediaConnection
  private _socket: udpCon.Socket | null = null
  private _ready: boolean = false
  private _audioPacketizer?: BaseMediaPacketizer
  private _videoPacketizer?: BaseMediaPacketizer
  private _ip?: string
  private _port?: number

  constructor(voiceConnection: BaseMediaConnection) {
    this._mediaConnection = voiceConnection
  }

  public get audioPacketizer(): BaseMediaPacketizer {
    return this._audioPacketizer!
  }

  public get videoPacketizer(): BaseMediaPacketizer {
    // This will never be undefined anyway, so it's safe
    return this._videoPacketizer!
  }

  public get mediaConnection(): BaseMediaConnection {
    return this._mediaConnection
  }

  public get ip() {
    return this._ip
  }

  public get port() {
    return this._port
  }

  public async sendAudioFrame(frame: Buffer, frametime: number): Promise<void> {
    if (!this.ready) return
    await this.audioPacketizer.sendFrame(frame, frametime)
  }

  public async sendVideoFrame(frame: Buffer, frametime: number): Promise<void> {
    if (!this.ready) return
    await this.videoPacketizer.sendFrame(frame, frametime)
  }

  public updatePacketizer(): void {
    this._audioPacketizer = new AudioPacketizer(this)
    this._audioPacketizer.ssrc = this._mediaConnection.ssrc!
    const videoCodec = normalizeVideoCodec(this.mediaConnection.streamOptions.videoCodec)
    switch (videoCodec) {
      case 'H264':
        this._videoPacketizer = new VideoPacketizerH264(this)
        break
      case 'H265':
        this._videoPacketizer = new VideoPacketizerH265(this)
        break
      case 'VP8':
        this._videoPacketizer = new VideoPacketizerVP8(this)
        break
      default:
        throw new Error(`Packetizer not implemented for ${videoCodec}`)
    }
    this._videoPacketizer.ssrc = this._mediaConnection.videoSsrc!
  }

  public sendPacket(packet: Buffer): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      try {
        this._socket?.send(
          packet,
          0,
          packet.length,
          this._mediaConnection.port!,
          this._mediaConnection.address!,
          (error, _bytes) => {
            if (error) {
              console.log('ERROR', error)
              reject(error)
            }
            resolve()
          }
        )
      } catch (e) {
        reject(e)
      }
    })
  }

  handleIncoming(_buf: any): void {
    //console.log("RECEIVED PACKET", buf);
  }

  public get ready(): boolean {
    return this._ready
  }

  public set ready(val: boolean) {
    this._ready = val
  }

  public stop(): void {
    try {
      this.ready = false
      this._socket?.disconnect()
    } catch (e) {}
  }

  public createUdp(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this._socket = udpCon.createSocket('udp4')

      this._socket.on('error', (error: Error) => {
        console.error('Error connecting to media udp server', error)
        reject(error)
      })

      this._socket.once('message', (message) => {
        if (message.readUInt16BE(0) !== 2) {
          reject('wrong handshake packet for udp')
        }
        try {
          const packet = parseLocalPacket(message)
          this._ip = packet.ip
          this._port = packet.port
          this._ready = true
        } catch (e) {
          reject(e)
        }

        resolve()
        this._socket!.on('message', this.handleIncoming)
      })

      const blank = Buffer.alloc(74)

      blank.writeUInt16BE(1, 0)
      blank.writeUInt16BE(70, 2)
      blank.writeUInt32BE(this._mediaConnection.ssrc!, 4)

      this._socket.send(
        blank,
        0,
        blank.length,
        this._mediaConnection.port!,
        this._mediaConnection.address!,
        (error, _bytes) => {
          if (error) {
            reject(error)
          }
        }
      )
    })
  }
}
