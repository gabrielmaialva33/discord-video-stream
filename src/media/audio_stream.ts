import { Writable, WritableOptions } from 'node:stream'
import { MediaUdp } from '#src/client/index'

class AudioStream extends Writable {
  private readonly udp: MediaUdp
  private count: number
  private readonly sleepTime: number
  private startTime?: number
  private readonly noSleep: boolean

  constructor(udp: MediaUdp, noSleep = false, options?: WritableOptions) {
    super(options)
    this.udp = udp
    this.count = 0
    this.sleepTime = 20
    this.noSleep = noSleep
  }

  _write(chunk: any, _: BufferEncoding, callback: (error?: Error | null) => void): void {
    this.count++
    if (!this.startTime) this.startTime = performance.now()

    this.udp.sendAudioFrame(chunk)

    const next = (this.count + 1) * this.sleepTime - (performance.now() - this.startTime)

    if (this.noSleep || next <= 0) {
      callback()
    } else {
      setTimeout(callback, next)
    }
  }
}

export { AudioStream }
