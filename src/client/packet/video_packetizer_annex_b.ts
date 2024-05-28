import { MediaUdp } from '#src/client/voice/media_udp'
import { BaseMediaPacketizer } from '#src/client/packet/base_media_packetizer'
import { type AnnexBHelpers, H264Helpers, H265Helpers } from '#src/client/processing/annex_bhelper'

const FU_HEADER_SIZE = 2
const NONCE_SIZE = 4

class VideoPacketizerAnnexB extends BaseMediaPacketizer {
  protected _nalFunctions: AnnexBHelpers

  constructor(connection: MediaUdp) {
    super(connection, 0x65, true)
    this.srInterval = 5 * (connection.mediaConnection.streamOptions.fps || 30) * 3 // ~5 seconds, assuming ~3 packets per frame
  }

  override sendFrame(frame: Buffer): void {
    super.sendFrame(frame)
    const nalus = this.extractNALUnits(frame)

    let packetsSent = 0
    let bytesSent = 0

    nalus.forEach((nalu, index) => {
      const isLastNal = index === nalus.length - 1
      if (nalu.length <= this.mtu) {
        // Send as Single NAL Unit Packet.
        const packet = this.createSingleNALUnitPacket(nalu, isLastNal)
        this.mediaUdp.sendPacket(packet)
        packetsSent++
        bytesSent += packet.length
      } else {
        // Send as Fragmentation Unit A (FU-A).
        const packets = this.createFragmentationUnits(nalu, isLastNal)
        packets.forEach((packet) => {
          this.mediaUdp.sendPacket(packet)
          packetsSent++
          bytesSent += packet.length
        })
      }
    })

    this.onFrameSent(packetsSent, bytesSent)
  }

  private extractNALUnits(frame: Buffer): Buffer[] {
    const nalus: Buffer[] = []
    let offset = 0
    while (offset < frame.length) {
      const naluSize = frame.readUInt32BE(offset)
      offset += 4
      nalus.push(frame.subarray(offset, offset + naluSize))
      offset += naluSize
    }
    return nalus
  }

  private createSingleNALUnitPacket(nalu: Buffer, isLastNal: boolean): Buffer {
    const packetHeader = this.makeRtpHeader(isLastNal)
    const packetData = Buffer.concat([this.createHeaderExtension(), nalu])
    const nonceBuffer = this.mediaUdp.getNewNonceBuffer()
    return Buffer.concat([
      packetHeader,
      this.encryptData(packetData, nonceBuffer),
      nonceBuffer.subarray(0, NONCE_SIZE),
    ])
  }

  private createFragmentationUnits(nalu: Buffer, isLastNal: boolean): Buffer[] {
    const [naluHeader, naluData] = this._nalFunctions.splitHeader(nalu)
    const dataChunks = this.partitionDataMTUSizedChunks(naluData)
    return dataChunks.map((dataChunk, index) => {
      const isFirstPacket = index === 0
      const isFinalPacket = index === dataChunks.length - 1
      const markerBit = isLastNal && isFinalPacket

      const packetHeader = this.makeRtpHeader(markerBit)
      const packetData = Buffer.concat([
        this.createHeaderExtension(),
        this.makeFragmentationUnitHeader(isFirstPacket, isFinalPacket, naluHeader),
        dataChunk,
      ])
      const nonceBuffer = this.mediaUdp.getNewNonceBuffer()
      return Buffer.concat([
        packetHeader,
        this.encryptData(packetData, nonceBuffer),
        nonceBuffer.subarray(0, NONCE_SIZE),
      ])
    })
  }

  override onFrameSent(packetsSent: number, bytesSent: number): void {
    super.onFrameSent(packetsSent, bytesSent)
    this.incrementTimestamp(90000 / (this.mediaUdp.mediaConnection.streamOptions.fps || 30))
  }

  protected makeFragmentationUnitHeader(
    isFirstPacket: boolean,
    isLastPacket: boolean,
    naluHeader: Buffer
  ): Buffer {
    console.log('makeFragmentationUnitHeader', isFirstPacket, isLastPacket, naluHeader)
    throw new Error('Not implemented')
  }
}

export class VideoPacketizerH264 extends VideoPacketizerAnnexB {
  constructor(connection: MediaUdp) {
    super(connection)
    this._nalFunctions = H264Helpers
  }

  protected makeFragmentationUnitHeader(
    isFirstPacket: boolean,
    isLastPacket: boolean,
    naluHeader: Buffer
  ): Buffer {
    const nal0 = naluHeader[0]
    const fuPayloadHeader = Buffer.alloc(FU_HEADER_SIZE)
    const nalType = H264Helpers.getUnitType(naluHeader)
    const fnri = nal0 & 0xe0

    // set fu indicator
    fuPayloadHeader[0] = 0x1c | fnri // type 28 with fnri from original frame

    // set fu header
    if (isFirstPacket) {
      fuPayloadHeader[1] = 0x80 | nalType // set start bit
    } else if (isLastPacket) {
      fuPayloadHeader[1] = 0x40 | nalType // set last bit
    } else {
      fuPayloadHeader[1] = nalType // no start ou end bit
    }

    return fuPayloadHeader
  }
}

export class VideoPacketizerH265 extends VideoPacketizerAnnexB {
  constructor(connection: MediaUdp) {
    super(connection)
    this._nalFunctions = H265Helpers
  }

  protected makeFragmentationUnitHeader(
    isFirstPacket: boolean,
    isLastPacket: boolean,
    naluHeader: Buffer
  ): Buffer {
    const fuPayloadHeader = Buffer.alloc(FU_HEADER_SIZE) // Reuse if possible
    const nalType = H265Helpers.getUnitType(naluHeader)
    const fnri = naluHeader[0] & 0xe0

    fuPayloadHeader[0] = 0x1c | fnri // Type 28 with FNRI from original frame
    fuPayloadHeader[1] = nalType // NAL type

    if (isFirstPacket) {
      fuPayloadHeader[1] |= 0x80 // Set start bit
    } else if (isLastPacket) {
      fuPayloadHeader[1] |= 0x40 // Set end bit
    }

    return fuPayloadHeader
  }
}
