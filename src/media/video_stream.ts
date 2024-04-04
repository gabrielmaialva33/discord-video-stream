import { Writable } from 'node:stream'

import { MediaUdp } from '#src/client/index'

export class VideoStream extends Writable {
  udp: MediaUdp
  count: number
  sleepTime: number
  startTime?: number
  private readonly noSleep: boolean

  constructor(udp: MediaUdp, fps: number = 30, noSleep = false) {
    super()
    this.udp = udp
    this.count = 0
    this.sleepTime = 1000 / fps
    this.noSleep = noSleep
  }

  setSleepTime(time: number) {
    this.sleepTime = time
  }

  _write(frame: any, _encoding: BufferEncoding, callback: (error?: Error | null) => void) {
    this.count++
    if (!this.startTime) this.startTime = performance.now()

    this.udp.sendVideoFrame(frame)

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
