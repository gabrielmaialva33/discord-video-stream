import udpCon from 'node:dgram'
import { isIPv4 } from 'node:net'

import {
  AudioPacketizer,
  BaseMediaConnection,
  BaseMediaPacketizer,
  MAX_INT32BIT,
  VideoPacketizerH264,
  VideoPacketizerH265,
  VideoPacketizerVP8,
} from '#src/client/index'
import { normalizeVideoCodec } from '#src/utils'

// credit to discord.js
function parseLocalPacket(message: Buffer) {
  const packet = Buffer.from(message)
  const ip = packet.subarray(8, packet.indexOf(0, 8)).toString('utf8')

  if (!isIPv4(ip)) throw new Error('Malformed IP address')

  const port = packet.readUInt16BE(packet.length - 2)
  return { ip, port }
}

export class MediaUdp {
  private _nonce: number
  private _socket: udpCon.Socket | null
  private readonly _mediaConnection: BaseMediaConnection
  private readonly _audioPacketizer: BaseMediaPacketizer
  private readonly _videoPacketizer: BaseMediaPacketizer
  private _ready: boolean

  constructor(voiceConnection: BaseMediaConnection) {
    this._nonce = 0
    this._socket = null
    this._mediaConnection = voiceConnection
    this._audioPacketizer = new AudioPacketizer(this)

    const videoCodec = normalizeVideoCodec(this.mediaConnection.streamOptions.videoCodec || 'H264')
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

    this._ready = false
  }

  get mediaConnection(): BaseMediaConnection {
    return this._mediaConnection
  }

  get ready(): boolean {
    return this._ready
  }

  set ready(val: boolean) {
    this._ready = val
  }

  get audioPacketizer(): BaseMediaPacketizer {
    return this._audioPacketizer
  }

  get videoPacketizer(): BaseMediaPacketizer {
    return this._videoPacketizer
  }

  getNewNonceBuffer(): Buffer {
    const nonceBuffer = Buffer.alloc(24)
    this._nonce = (this._nonce + 1) % MAX_INT32BIT
    nonceBuffer.writeUInt32BE(this._nonce, 0)
    return nonceBuffer
  }

  sendAudioFrame(frame: Buffer): void {
    if (!this.ready) return
    this.audioPacketizer.sendFrame(frame)
  }

  sendVideoFrame(frame: any): void {
    if (!this.ready) return
    this.videoPacketizer.sendFrame(frame)
  }

  sendPacket(packet: Buffer): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (!this._socket) {
        reject(new Error('Socket is not initialized'))
        return
      }
      this._socket.send(
        packet,
        0,
        packet.length,
        this._mediaConnection.port!,
        this._mediaConnection.address!,
        (error) => {
          if (error) {
            console.log('ERROR', error)
            reject(error)
          } else {
            resolve()
          }
        }
      )
    })
  }

  handleIncoming(_buf: any): void {
    //console.log('incoming packet', buf)
  }

  stop(): void {
    try {
      this.ready = false
      this._socket?.disconnect()
    } catch (e) {
      console.error('Error disconnecting socket', e)
    }
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
          reject(new Error('Wrong handshake packet for UDP'))
          return
        }
        try {
          const packet = parseLocalPacket(message)
          this._mediaConnection.setProtocols(packet.ip, packet.port)
          resolve()
        } catch (e) {
          reject(e)
        }
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
        (error) => {
          if (error) {
            reject(error)
          }
        }
      )
    })
  }
}
