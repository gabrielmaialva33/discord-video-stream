import fs from 'node:fs'
import { Transform, TransformCallback } from 'node:stream'

type IvfHeader = {
  signature: string
  version: number
  headerLength: number
  codec: string
  width: number
  height: number
  timeDenominator: number
  timeNumerator: number
  frameCount: number
}

class IvfTransformer extends Transform {
  private readonly headerSize: number
  private readonly frameHeaderSize: number
  private header: IvfHeader | null
  private buffer: Buffer | null
  private readonly returnFullFrame: boolean

  constructor(options?: any) {
    super(options)
    this.headerSize = 32
    this.frameHeaderSize = 12
    this.header = null
    this.buffer = null
    this.returnFullFrame = options?.fullframe ?? false
  }

  private parseHeader(header: Buffer) {
    this.header = {
      signature: header.subarray(0, 4).toString(),
      version: header.readUIntLE(4, 2),
      headerLength: header.readUIntLE(6, 2),
      codec: header.subarray(8, 12).toString(),
      width: header.readUIntLE(12, 2),
      height: header.readUIntLE(14, 2),
      timeDenominator: header.readUIntLE(16, 4),
      timeNumerator: header.readUIntLE(20, 4),
      frameCount: header.readUIntLE(24, 4),
    }
    this.emit('header', this.header)
  }

  private getFrameSize(buf: Buffer) {
    return buf.readUIntLE(0, 4)
  }

  private parseFrame(frame: Buffer) {
    const size = this.getFrameSize(frame)

    if (this.returnFullFrame) {
      this.push(frame.subarray(0, 12 + size))
      return
    }

    const frameData = {
      size: size,
      timestamp: frame.readBigUInt64LE(4),
      data: frame.subarray(12, 12 + size),
    }
    this.push(frameData.data)
  }

  private appendChunkToBuffer(chunk: Buffer) {
    this.buffer = this.buffer ? Buffer.concat([this.buffer, chunk]) : chunk
  }

  private updateBuffer(size: number) {
    if (!this.buffer) return

    this.buffer = this.buffer.length > size ? this.buffer.subarray(size) : null
  }

  _transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback): void {
    this.appendChunkToBuffer(chunk)

    // Parse header
    if (!this.header && this.buffer && this.buffer.length >= this.headerSize) {
      this.parseHeader(this.buffer.subarray(0, this.headerSize))
      this.updateBuffer(this.headerSize)
    }

    // Parse frames
    while (this.buffer && this.buffer.length >= this.frameHeaderSize) {
      const frameSize = this.getFrameSize(this.buffer) + this.frameHeaderSize

      if (this.buffer.length >= frameSize) {
        this.parseFrame(this.buffer.subarray(0, frameSize))
        this.updateBuffer(frameSize)
      } else {
        break
      }
    }

    callback()
  }
}

async function readIvfFile(filepath: string) {
  const inputStream = fs.createReadStream(filepath)
  const transformer = new IvfTransformer({ fullframe: true })

  inputStream.pipe(transformer)

  const result: { frames: Buffer[] } & Partial<IvfHeader> = { frames: [] }

  await new Promise<void>((resolve) => {
    transformer.on('header', (header) => {
      Object.assign(result, header)
    })

    transformer.on('data', (frame) => {
      result.frames.push(frame)
    })

    transformer.on('end', () => {
      resolve()
    })
  })

  return result
}

// Get frame, starts at one
function getFrameFromIvf(file: any, framenum = 1) {
  if (!(framenum > 0 && framenum <= file.frameCount)) return false

  let currentFrame = 1
  let currentBuffer = file.frames

  while (true) {
    const size = currentBuffer.readUIntLE(0, 4)

    if (currentFrame !== framenum) {
      currentBuffer = currentBuffer.slice(12 + size)
      currentFrame++
      continue
    }

    return {
      size: size,
      timestamp: currentBuffer.readBigUInt64LE(4),
      data: currentBuffer.slice(12, 12 + size),
    }
  }
}

function getFrameDelayInMilliseconds(file: IvfHeader) {
  return (file.timeNumerator / file.timeDenominator) * 1000
}

export { getFrameFromIvf, readIvfFile, getFrameDelayInMilliseconds, IvfTransformer }
