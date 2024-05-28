import { Transform, TransformCallback } from 'node:stream'
import {
  AnnexBHelpers,
  H264Helpers,
  H264NalUnitTypes,
  H265Helpers,
} from '#src/client/processing/annex_bhelper'

const emptyBuffer = Buffer.allocUnsafe(0)
const epbPrefix = Buffer.from([0x00, 0x00, 0x03])
const nalSuffix = Buffer.from([0x00, 0x00, 0x01])

/**
 * Outputs a buffer containing length-delimited NALU units
 * that belong to the same access unit.
 * Expects an Annex B bytestream as input.
 *
 * In an Annex B stream, 1 frame is equal to 1 access unit, and an access
 * unit is composed of 1 to n NAL units.
 */
class AnnexBNalSplitter extends Transform {
  protected _nalFunctions: AnnexBHelpers
  private _buffer: Buffer = emptyBuffer
  private _accessUnit: Buffer[] = []

  /**
   * Removes emulation prevention bytes from a NALU frame
   * @description There are chances that 0x000001 or 0x00000001 exists in the bitstream of a NAL unit.
   * So an emulation prevention byte, 0x03, is presented when there is 0x000000, 0x000001, 0x000002 and 0x000003
   * to make them become 0x00000300, 0x00000301, 0x00000302 and 0x00000303 respectively.
   * @param data
   * @returns Frame with emulation prevention bytes removed
   */
  rbsp(data: Buffer): Buffer {
    const newData = Buffer.allocUnsafe(data.length)
    let newLength = 0

    while (true) {
      const epbsPos = data.indexOf(epbPrefix)
      if (epbsPos === -1) {
        data.copy(newData, newLength)
        newLength += data.length
        break
      }
      const copyRange = data[epbsPos + 3] <= 0x03 ? epbsPos + 3 : epbsPos + 2
      data.copy(newData, newLength, 0, copyRange)
      newLength += copyRange
      data = data.subarray(epbsPos + 3)
    }

    return newData.subarray(0, newLength)
  }

  /**
   * Finds the first NAL unit header in a buffer as efficiently as possible
   * @param buf Buffer of data
   * @returns The index of the first NAL unit header and its length
   */
  findNalStart(buf: Buffer): { index: number; length: number } | null {
    const pos = buf.indexOf(nalSuffix)
    if (pos === -1) return null
    return pos > 0 && buf[pos - 1] === 0 ? { index: pos - 1, length: 4 } : { index: pos, length: 3 }
  }

  removeEpbs(frame: Buffer, unitType: number): Buffer {
    console.log('removeEpbs not implemented', frame, unitType)
    throw new Error('Not implemented')
  }

  processFrame(frame: Buffer): void {
    if (frame.length === 0) return

    const unitType = this._nalFunctions.getUnitType(frame)

    if (this._nalFunctions.isAUD(unitType)) {
      if (this._accessUnit.length > 0) {
        const sizeOfAccessUnit = this._accessUnit.reduce((acc, nalu) => acc + nalu.length + 4, 0)
        const accessUnitBuf = Buffer.allocUnsafe(sizeOfAccessUnit)

        let offset = 0
        for (const nalu of this._accessUnit) {
          accessUnitBuf.writeUint32BE(nalu.length, offset)
          offset += 4
          nalu.copy(accessUnitBuf, offset)
          offset += nalu.length
        }

        this.push(accessUnitBuf)
        this._accessUnit = []
      }
    } else {
      // Remove emulation bytes from frame (only important ones like SPS and SEI since it's a costly operation)
      this._accessUnit.push(this.removeEpbs(frame, unitType))
    }
  }

  _transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback): void {
    let nalStart = this.findNalStart(chunk)
    if (!this._buffer.length && !nalStart) {
      callback()
      return
    }

    chunk = Buffer.concat([this._buffer, chunk])
    while ((nalStart = this.findNalStart(chunk))) {
      const frame = chunk.subarray(0, nalStart.index)
      this.processFrame(frame)
      chunk = chunk.subarray(nalStart.index + nalStart.length)
    }
    this._buffer = chunk
    callback()
  }
}

export class H264NalSplitter extends AnnexBNalSplitter {
  constructor() {
    super()
    this._nalFunctions = H264Helpers
  }

  removeEpbs(frame: Buffer, unitType: number): Buffer {
    return unitType === H264NalUnitTypes.SPS || unitType === H264NalUnitTypes.SEI
      ? this.rbsp(frame)
      : frame
  }
}

export class H265NalSplitter extends AnnexBNalSplitter {
  constructor() {
    super()
    this._nalFunctions = H265Helpers
  }

  removeEpbs(frame: Buffer, _unitType: number): Buffer {
    // We do not remove the EPBS, since the encoder expects it to be there
    // See https://www.motionspell.com/2019/01/31/the-perils-of-start-codes
    return frame
  }
}
