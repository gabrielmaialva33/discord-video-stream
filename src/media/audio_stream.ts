import { Writable } from 'node:stream'

import { MediaUdp } from '#src/client/index'

class AudioStream extends Writable {
  udp: MediaUdp
  count: number
  sleepTime: number
  startTime?: number
  private readonly noSleep: boolean

  constructor(udp: MediaUdp, noSleep = false) {
    super()
    this.udp = udp
    this.count = 0
    this.sleepTime = 20
    this.noSleep = noSleep
  }

  _write(chunk: any, _: BufferEncoding, callback: (error?: Error | null) => void) {
    this.count++
    if (!this.startTime) this.startTime = performance.now()

    this.udp.sendAudioFrame(chunk)

    const next = (this.count + 1) * this.sleepTime - (performance.now() - this.startTime)

    if (this.noSleep) {
      callback()
    } else {
      setTimeout(() => {
        callback()
      }, next)
    }
  }
}

export { AudioStream }
