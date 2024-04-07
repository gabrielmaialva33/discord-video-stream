import _sodium from 'libsodium-wrappers'
import { MediaUdp } from '#src/client/voice/media_udp'

export const MAX_INT16BIT = 2 ** 16
export const MAX_INT32BIT = 2 ** 32

const ntpEpoch = new Date('Jan 01 1900 GMT').getTime()

let sodium = _sodium
await (async () => {
  await _sodium.ready
  sodium = _sodium
})()
export class BaseMediaPacketizer {
  protected readonly _payloadType: number
  private _sequence: number
  protected _timestamp: number
  private _totalBytes: number
  private _totalPackets: number
  private _prevTotalPackets: number
  protected _lastPacketTime: number
  protected readonly _extensionEnabled: boolean
  private readonly _mtu: number = 1200
  private readonly _mediaUdp: MediaUdp
  protected readonly _packetHeaderBuffer: Buffer = Buffer.alloc(12)
  private readonly _senderReportHeader: Buffer = Buffer.allocUnsafe(8)
  private readonly _senderReportBody: Buffer = Buffer.allocUnsafe(20)

  constructor(connection: MediaUdp, payloadType: number, extensionEnabled = false) {
    this._mediaUdp = connection
    this._payloadType = payloadType
    this._sequence = 0
    this._timestamp = 0
    this._totalBytes = 0
    this._prevTotalPackets = 0
    this._extensionEnabled = extensionEnabled
    this._ssrc = 0
    this._srInterval = 512 // Sane fallback value for interval
    this._lastPacketTime = 0
  }

  private _ssrc: number
  private _srInterval: number

  get ssrc(): number {
    return this._ssrc
  }

  set ssrc(value: number) {
    this._ssrc = value
    this._totalBytes = this._totalPackets = this._prevTotalPackets = 0
  }

  get mtu(): number {
    return this._mtu
  }

  get srInterval(): number {
    return this._srInterval
  }

  set srInterval(interval: number) {
    this._srInterval = interval
  }

  get mediaUdp(): MediaUdp {
    return this._mediaUdp
  }

  sendFrame(_frame: any): void {
    // override this
    this._lastPacketTime = Date.now()
  }

  onFrameSent(packetsSent: number, bytesSent: number): void {
    this._totalPackets += packetsSent
    this._totalBytes = (this._totalBytes + bytesSent) % MAX_INT32BIT

    if (
      Math.floor(this._totalPackets / this._srInterval) >
      Math.floor(this._prevTotalPackets / this._srInterval)
    ) {
      const senderReport = this.makeRtcpSenderReport()
      this._mediaUdp.sendPacket(senderReport)
      this._prevTotalPackets = this._totalPackets
    }
  }

  partitionDataMTUSizedChunks(data: Buffer): Buffer[] {
    const out = []
    for (let i = 0; i < data.length; i += this._mtu) {
      out.push(data.subarray(i, Math.min(i + this._mtu, data.length)))
    }
    return out
  }

  getNewSequence(): number {
    this._sequence = (this._sequence + 1) % MAX_INT16BIT
    return this._sequence
  }

  incrementTimestamp(incrementBy: number): void {
    this._timestamp = (this._timestamp + incrementBy) % MAX_INT32BIT
  }

  makeRtpHeader(isLastPacket: boolean = true): Buffer {
    const header = this._packetHeaderBuffer
    header.fill(0)

    header[0] = (2 << 6) | ((this._extensionEnabled ? 1 : 0) << 4) // set version and flags
    header[1] = this._payloadType // set packet payload
    if (isLastPacket) header[1] |= 0b10000000 // mark M bit if last frame
    // header[1] |= 0x80; // mark M bit if last frame

    // write sequence number
    header.writeUIntBE(this.getNewSequence(), 2, 2)
    header.writeUIntBE(this._timestamp, 4, 4)
    header.writeUIntBE(this._ssrc, 8, 4)

    return header
  }

  makeRtcpSenderReport(): Buffer {
    const header = this._senderReportHeader
    header[0] = 0x80 // RFC1889 v2, no padding, no reception report count
    header[1] = 0xc8 // Type: Sender Report (200)
    header[2] = 0x00 // Packet length (always 0x06 for some reason)
    header[3] = 0x06
    header.writeUInt32BE(this._ssrc, 4)

    const body = this._senderReportBody
    const ntpTimestamp = (Date.now() - ntpEpoch) / 1000
    const ntpTimestampMsw = Math.floor(ntpTimestamp)
    const ntpTimestampLsw = Math.round((ntpTimestamp - ntpTimestampMsw) * MAX_INT32BIT)

    body.writeUInt32BE(ntpTimestampMsw, 0)
    body.writeUInt32BE(ntpTimestampLsw, 4)
    body.writeUInt32BE(this._timestamp, 8)
    body.writeUInt32BE(this._totalPackets % MAX_INT32BIT, 12)
    body.writeUInt32BE(this._totalBytes, 16)

    const nonceBuffer = this._mediaUdp.getNewNonceBuffer()
    return Buffer.concat([
      header,
      sodium.crypto_secretbox_easy(body, nonceBuffer, this._mediaUdp.mediaConnection.secretkey),
      nonceBuffer.subarray(0, 4),
    ])
  }

  createHeaderExtension(): Buffer {
    // Assuming fixed-size and fixed-value extensions for simplicity
    const extensionSize = 4 // Size for one extension
    const profile = Buffer.alloc(4)
    profile[0] = 0xbe
    profile[1] = 0xde
    profile.writeInt16BE(1, 2) // extension count

    const extensionData = Buffer.alloc(extensionSize)
    extensionData[0] = (5 << 4) | 1 // ID=5, len=2
    // No specific value, just an example
    extensionData.writeInt16BE(0, 2) // ext.val = 0

    return Buffer.concat([profile, extensionData])
  }

  encryptData(message: string | Uint8Array, nonceBuffer: Buffer): Uint8Array {
    return sodium.crypto_secretbox_easy(
      message,
      nonceBuffer,
      this._mediaUdp.mediaConnection.secretkey
    )
  }
}
