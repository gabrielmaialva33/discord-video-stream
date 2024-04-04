import { crypto_secretbox_easy } from 'libsodium-wrappers'

import { MediaUdp } from '#src/client/voice/media_udp'

export const MAX_INT16BIT = 2 ** 16

export const MAX_INT32BIT = 2 ** 32

const ntpEpoch = new Date('Jan 01 1900 GMT').getTime()

export class BaseMediaPacketizer {
  private readonly _payloadType: number
  private _sequence: number
  private _timestamp: number
  private _totalBytes: number
  private _totalPackets: number
  private _prevTotalPackets: number
  private _lastPacketTime: number
  private readonly _extensionEnabled: boolean
  private readonly _mtu: number
  private readonly _mediaUdp: MediaUdp

  constructor(connection: MediaUdp, payloadType: number, extensionEnabled = false) {
    this._mediaUdp = connection
    this._payloadType = payloadType
    this._sequence = 0
    this._timestamp = 0
    this._totalBytes = 0
    this._prevTotalPackets = 0
    this._mtu = 1200
    this._extensionEnabled = extensionEnabled

    this._ssrc = 0
    this._srInterval = 512 // Sane fallback value for interval
  }

  private _ssrc: number

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

  private _srInterval: number

  /**
   * The interval (number of packets) between 2 consecutive RTCP Sender
   * Report packets
   */
  get srInterval(): number {
    return this._srInterval
  }

  set srInterval(interval: number) {
    this._srInterval = interval
  }

  get mediaUdp(): MediaUdp {
    return this._mediaUdp
  }

  sendFrame(frame: any): void {
    // override this
    console.log('sendFrame', frame)
    this._lastPacketTime = Date.now()
  }

  onFrameSent(packetsSent: number, bytesSent: number): void {
    this._totalPackets = this._totalPackets + packetsSent
    this._totalBytes = (this._totalBytes + bytesSent) % MAX_INT32BIT

    // Not using modulo here, since the number of packet sent might not be
    // exactly a multiple of the interval
    if (
      Math.floor(this._totalPackets / this._srInterval) -
        Math.floor(this._prevTotalPackets / this._srInterval) >
      0
    ) {
      const senderReport = this.makeRtcpSenderReport()
      this._mediaUdp.sendPacket(senderReport)
      this._prevTotalPackets = this._totalPackets
    }
  }

  /**
   * Partitions a buffer into chunks of length this.mtu
   * @param data buffer to be partitioned
   * @returns array of chunks
   */
  partitionDataMTUSizedChunks(data: Buffer): Buffer[] {
    let i = 0
    let len = data.length

    const out = []

    while (len > 0) {
      const size = Math.min(len, this._mtu)
      out.push(data.subarray(i, i + size))
      len -= size
      i += size
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
    const packetHeader = Buffer.alloc(12)

    packetHeader[0] = (2 << 6) | ((this._extensionEnabled ? 1 : 0) << 4) // set version and flags
    packetHeader[1] = this._payloadType // set packet payload
    if (isLastPacket) packetHeader[1] |= 0b10000000 // mark M bit if last frame

    packetHeader.writeUIntBE(this.getNewSequence(), 2, 2)
    packetHeader.writeUIntBE(this._timestamp, 4, 4)
    packetHeader.writeUIntBE(this._ssrc, 8, 4)
    return packetHeader
  }

  // encrypts all data that is not in rtp header.

  makeRtcpSenderReport(): Buffer {
    const packetHeader = Buffer.allocUnsafe(8)

    packetHeader[0] = 0x80 // RFC1889 v2, no padding, no reception report count
    packetHeader[1] = 0xc8 // Type: Sender Report (200)

    // Packet length (always 0x06 for some reason)
    packetHeader[2] = 0x00
    packetHeader[3] = 0x06
    packetHeader.writeUInt32BE(this._ssrc, 4)

    const senderReport = Buffer.allocUnsafe(20)

    // Convert from floating point to 32.32 fixed point
    // Convert each part separately to reduce precision loss
    const ntpTimestamp = (this._lastPacketTime - ntpEpoch) / 1000
    const ntpTimestampMsw = Math.floor(ntpTimestamp)
    const ntpTimestampLsw = Math.round((ntpTimestamp - ntpTimestampMsw) * MAX_INT32BIT)

    senderReport.writeUInt32BE(ntpTimestampMsw, 0)
    senderReport.writeUInt32BE(ntpTimestampLsw, 4)
    senderReport.writeUInt32BE(this._timestamp, 8)
    senderReport.writeUInt32BE(this._totalPackets % MAX_INT32BIT, 12)
    senderReport.writeUInt32BE(this._totalBytes, 16)

    const nonceBuffer = this._mediaUdp.getNewNonceBuffer()
    return Buffer.concat([
      packetHeader,
      crypto_secretbox_easy(senderReport, nonceBuffer, this._mediaUdp.mediaConnection.secretkey),
      nonceBuffer.subarray(0, 4),
    ])
  }

  /**
   * Creates a single extension of type playout-delay
   * Discord seems to send this extension on every video packet
   * @see https://webrtc.googlesource.com/src/+/refs/heads/main/docs/native-code/rtp-hdrext/playout-delay
   * @returns playout-delay extension @type Buffer
   */
  createHeaderExtension(): Buffer {
    const extensions = [{ id: 5, len: 2, val: 0 }]

    /**
         *  0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
         +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
         |      defined by profile       |           length              |
         +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
         */
    const profile = Buffer.alloc(4)
    profile[0] = 0xbe
    profile[1] = 0xde
    profile.writeInt16BE(extensions.length, 2) // extension count

    const extensionsData = []
    for (let ext of extensions) {
      /**
       * EXTENSION DATA - each extension payload is 32 bits
       */
      const data = Buffer.alloc(4)

      /**
             *  0 1 2 3 4 5 6 7
             +-+-+-+-+-+-+-+-+
             |  ID   |  len  |
             +-+-+-+-+-+-+-+-+

             where len = actual length - 1
             */
      data[0] = (ext.id & 0b00001111) << 4
      data[0] |= (ext.len - 1) & 0b00001111

      /**  Specific to type playout-delay
             *  0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4
             +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
             |       MIN delay       |       MAX delay       |
             +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
             */
      data.writeUIntBE(ext.val, 1, 2) // not quite but its 0 anyway

      extensionsData.push(data)
    }

    return Buffer.concat([profile, ...extensionsData])
  }

  // rtp header extensions and payload headers are also encrypted
  encryptData(message: string | Uint8Array, nonceBuffer: Buffer): Uint8Array {
    return crypto_secretbox_easy(message, nonceBuffer, this._mediaUdp.mediaConnection.secretkey)
  }
}
