import { Writable, WritableOptions } from 'node:stream'
import { MediaUdp } from '#src/client/index'

class AudioStream extends Writable {
  private readonly udp: MediaUdp
  private count: number
  private readonly sleepTime: number
  private startTime?: number
  private readonly noSleep: boolean
  paused: boolean = false

  constructor(udp: MediaUdp, noSleep = false, options?: WritableOptions) {
    super(options)
    this.udp = udp
    this.count = 0
    this.sleepTime = 20
    this.noSleep = noSleep
  }

  async _write(
    chunk: any,
    _: BufferEncoding,
    callback: (error?: Error | null) => void
  ): Promise<void> {
    this.count++
    if (!this.startTime) this.startTime = performance.now()

    this.udp.sendAudioFrame(chunk)

    if (this.noSleep) {
      callback()
    } else {
      do {
        this.count++
        const next = (this.count + 1) * this.sleepTime - (performance.now() - this.startTime)
        await this.delay(next)
      } while (this.paused)
      callback()
    }
  }

  delay(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  pause() {
    this.paused = true
  }

  resume() {
    this.paused = false
  }
}

export { AudioStream }
