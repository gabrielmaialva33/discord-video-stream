import { isIPv4 } from 'node:net'
import udpCon from 'node:dgram'

import { BaseMediaConnection } from '#src/client/voice/base_media_connection'
import { MAX_INT32BIT, normalizeVideoCodec, SupportedEncryptionModes } from '#src/utils'

import {
  AudioPacketizer,
  BaseMediaPacketizer,
  VideoPacketizerH264,
  VideoPacketizerH265,
  VideoPacketizerVP8,
} from '../packet/index.js'

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
  private _nonce: number
  private _socket: udpCon.Socket | null = null

  constructor(voiceConnection: BaseMediaConnection) {
    this._nonce = 0

    this._mediaConnection = voiceConnection
    this._audioPacketizer = new AudioPacketizer(this)

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
  }

  private _mediaConnection: BaseMediaConnection

  get mediaConnection(): BaseMediaConnection {
    return this._mediaConnection
  }

  private _ready: boolean = false

  get ready(): boolean {
    return this._ready
  }

  set ready(val: boolean) {
    this._ready = val
  }

  private _audioPacketizer: BaseMediaPacketizer

  get audioPacketizer(): BaseMediaPacketizer {
    return this._audioPacketizer
  }

  private _videoPacketizer: BaseMediaPacketizer

  get videoPacketizer(): BaseMediaPacketizer {
    return this._videoPacketizer
  }

  private _encryptionMode: SupportedEncryptionModes | undefined

  get encryptionMode(): SupportedEncryptionModes | undefined {
    return this._encryptionMode
  }

  set encryptionMode(mode: SupportedEncryptionModes) {
    this._encryptionMode = mode
  }

  getNewNonceBuffer(): Buffer {
    const nonceBuffer =
      this._encryptionMode === SupportedEncryptionModes.AES256 ? Buffer.alloc(12) : Buffer.alloc(24)
    this._nonce = (this._nonce + 1) % MAX_INT32BIT

    nonceBuffer.writeUInt32BE(this._nonce, 0)
    return nonceBuffer
  }

  async sendAudioFrame(frame: Buffer): Promise<void> {
    if (!this.ready) return
    await this.audioPacketizer.sendFrame(frame)
  }

  async sendVideoFrame(frame: Buffer): Promise<void> {
    if (!this.ready) return
    await this.videoPacketizer.sendFrame(frame)
  }

  sendPacket(packet: Buffer): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      try {
        this._socket?.send(
          packet,
          0,
          packet.length,
          this._mediaConnection.port!,
          this._mediaConnection.address!,
          (error: any, _bytes: any) => {
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

  stop(): void {
    try {
      this.ready = false
      this._socket?.disconnect()
    } catch (e) {}
  }

  createUdp(): Promise<void> {
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
          this._mediaConnection.setProtocols(packet.ip, packet.port)
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
        (error: any, _bytes: any) => {
          if (error) {
            reject(error)
          }
        }
      )
    })
  }
}
