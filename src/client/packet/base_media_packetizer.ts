import { Log } from 'debug-level'

import { MediaUdp } from '../voice/index.js'
import { MAX_INT16BIT, MAX_INT32BIT } from '../../utils.js'

const ntpEpoch = new Date('Jan 01 1900 GMT').getTime()

export class BaseMediaPacketizer {
  private _loggerRtcpSr = new Log('packetizer:rtcp-sr')

  private _ssrc: number
  private readonly _payloadType: number
  private readonly _mtu: number
  private _sequence: number
  private _timestamp: number

  private _totalBytes: number
  private _totalPackets: number
  private _lastPacketTime: number
  private _lastRtcpTime: number
  private _currentMediaTimestamp: number
  private _srInterval: number

  private readonly _mediaUdp: MediaUdp
  private readonly _extensionEnabled: boolean

  constructor(connection: MediaUdp, ssrc: number, payloadType: number, extensionEnabled = false) {
    this._mediaUdp = connection
    this._payloadType = payloadType
    this._ssrc = ssrc
    this._sequence = 0
    this._timestamp = 0
    this._totalBytes = 0
    this._totalPackets = 0
    this._lastPacketTime = 0
    this._lastRtcpTime = 0
    this._currentMediaTimestamp = 0
    this._mtu = 1200
    this._extensionEnabled = extensionEnabled

    this._srInterval = 1000
  }

  public get ssrc(): number | undefined {
    return this._ssrc
  }

  public set ssrc(value: number) {
    this._ssrc = value
    this._totalBytes = this._totalPackets = 0
  }

  /**
   * The interval between 2 consecutive RTCP Sender Report packets in ms
   */
  public get srInterval(): number {
    return this._srInterval
  }

  public set srInterval(interval: number) {
    this._srInterval = interval
  }

  public async sendFrame(_frame: Buffer, _frametime: number): Promise<void> {
    // override this
    this._lastPacketTime = Date.now()
  }

  public async onFrameSent(
    packetsSent: number,
    bytesSent: number,
    frametime: number
  ): Promise<void> {
    if (this._mediaUdp.mediaConnection.streamer.opts.rtcpSenderReportEnabled) {
      this._totalPackets = this._totalPackets + packetsSent
      this._totalBytes = (this._totalBytes + bytesSent) % MAX_INT32BIT

      /**
       * Not using modulo here, since the timestamp might not be an exact
       * multiple of the interval
       */
      if (
        Math.floor(this._currentMediaTimestamp / this._srInterval) -
          Math.floor(this._lastRtcpTime / this._srInterval) >
        0
      ) {
        const senderReport = await this.makeRtcpSenderReport()
        this._mediaUdp.sendPacket(senderReport)
        this._lastRtcpTime = this._currentMediaTimestamp
        this._loggerRtcpSr.debug(
          {
            stats: {
              ssrc: this._ssrc,
              timestamp: this._timestamp,
              totalPackets: this._totalPackets,
              totalBytes: this._totalBytes,
            },
          },
          `Sent RTCP sender report for SSRC ${this._ssrc}`
        )
      }
    }
    this._currentMediaTimestamp += frametime
  }

  /**
   * Partitions a buffer into chunks of length this.mtu
   * @param data buffer to be partitioned
   * @returns array of chunks
   */
  public partitionDataMTUSizedChunks(data: Buffer): Buffer[] {
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

  public getNewSequence(): number {
    this._sequence = (this._sequence + 1) % MAX_INT16BIT
    return this._sequence
  }

  public incrementTimestamp(incrementBy: number): void {
    this._timestamp = (this._timestamp + incrementBy) % MAX_INT32BIT
  }

  public makeRtpHeader(isLastPacket = true): Buffer {
    const packetHeader = Buffer.alloc(12)

    packetHeader[0] = (2 << 6) | ((this._extensionEnabled ? 1 : 0) << 4) // set version and flags
    packetHeader[1] = this._payloadType // set packet payload
    if (isLastPacket) packetHeader[1] |= 0b10000000 // mark M bit if last frame

    packetHeader.writeUIntBE(this.getNewSequence(), 2, 2)
    packetHeader.writeUIntBE(this._timestamp, 4, 4)
    packetHeader.writeUIntBE(this._ssrc, 8, 4)
    return packetHeader
  }

  public async makeRtcpSenderReport(): Promise<Buffer> {
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

    const [ciphertext, nonceBuffer] = await this.encryptData(senderReport, packetHeader)
    return Buffer.concat([packetHeader, ciphertext, nonceBuffer.subarray(0, 4)])
  }

  /**
   * Creates a one-byte extension header
   * https://www.rfc-editor.org/rfc/rfc5285#section-4.2
   * @returns extension header
   */
  public createExtensionHeader(extensions: { id: number; len: number; val: number }[]): Buffer {
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

    return profile
  }

  /**
   * Creates a extension payload in one-byte format according to https://www.rfc-editor.org/rfc/rfc7941.html#section-4.1.1
   * Discord seems to send this extension on every video packet. The extension ids for Discord can be found by connecting
   * to their webrtc gateway using the webclient and the client will send an SDP offer containing it
   * @returns extension payload
   */
  public createExtensionPayload(extensions: { id: number; len: number; val: number }[]): Buffer {
    const extensionsData = []
    for (const ext of extensions) {
      /**
       * EXTENSION DATA - each extension payload is 32 bits
       */
      const data = Buffer.alloc(4)

      // https://webrtc.googlesource.com/src/+/refs/heads/main/docs/native-code/rtp-hdrext/playout-delay
      if (ext.id === 5) {
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
      }

      extensionsData.push(data)
    }

    return Buffer.concat(extensionsData)
  }

  /**
   * Encrypt packet payload. Encrpyed Payload is determined to be
   * according to https://tools.ietf.org/html/rfc3711#section-3.1
   * and https://datatracker.ietf.org/doc/html/rfc7714#section-8.2
   *
   * Associated Data: The version V (2 bits), padding flag P (1 bit),
   extension flag X (1 bit), Contributing Source
   (CSRC) count CC (4 bits), marker M (1 bit),
   Payload Type PT (7 bits), sequence number
   (16 bits), timestamp (32 bits), SSRC (32 bits),
   optional CSRC identifiers (32 bits each), and
   optional RTP extension (variable length).

   Plaintext:       The RTP payload (variable length), RTP padding
   (if used, variable length), and RTP pad count (if
   used, 1 octet).

   Raw Data:        The optional variable-length SRTP Master Key
   Identifier (MKI) and SRTP authentication tag
   (whose use is NOT RECOMMENDED).  These fields are
   appended after encryption has been performed.

   0                   1                   2                   3
   0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
   +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
   A  |V=2|P|X|  CC   |M|     PT      |       sequence number         |
   +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
   A  |                           timestamp                           |
   +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
   A  |           synchronization source (SSRC) identifier            |
   +=+=+=+=+=+=+=+=+=+=+=+=+=+=+=+=+=+=+=+=+=+=+=+=+=+=+=+=+=+=+=+=+
   A  |      contributing source (CSRC) identifiers (optional)        |
   A  |                               ....                            |
   +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
   A  |                   RTP extension header (OPTIONAL)             |
   +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
   P  |                          payload  ...                         |
   P  |                               +-------------------------------+
   P  |                               | RTP padding   | RTP pad count |
   +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+

   P = Plaintext (to be encrypted and authenticated)
   A = Associated Data (to be authenticated only)
   * @param plaintext
   * @param nonceBuffer
   * @param additionalData
   * @returns ciphertext
   */
  public encryptData(plaintext: Buffer, additionalData: Buffer): Promise<[Buffer, Buffer]> {
    const encryptor = this._mediaUdp.mediaConnection.transportEncryptor
    if (!encryptor)
      throw new Error('Transport encryptor not defined. Did you forget to select protocol?')
    return encryptor.encrypt(plaintext, additionalData)
  }

  public get mediaUdp(): MediaUdp {
    return this._mediaUdp
  }

  public get mtu(): number {
    return this._mtu
  }
}
