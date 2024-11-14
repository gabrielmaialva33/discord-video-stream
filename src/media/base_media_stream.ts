import { setTimeout } from 'node:timers/promises'
import { Writable } from 'node:stream'

export class BaseMediaStream extends Writable {
  // Optional reference to another stream for synchronization
  syncStream?: BaseMediaStream

  // Presentation timestamp (PTS) of the current stream
  private _pts?: number

  get pts(): number | undefined {
    return this._pts
  }

  protected set pts(value: number | undefined) {
    this._pts = value
  }

  // Synchronization tolerance in seconds
  private _syncTolerance: number = 0

  get syncTolerance() {
    return this._syncTolerance
  }

  set syncTolerance(value: number) {
    if (value >= 0) {
      this._syncTolerance = value
    }
  }

  // Clean up resources when the stream is destroyed
  _destroy(error: Error | null, callback: (error?: Error | null) => void): void {
    super._destroy(error, callback)
    this.syncStream = undefined
  }

  // Waits until the synchronization condition is met
  protected async _waitForOtherStream() {
    while (this.shouldWaitForSync()) {
      const delta = this._pts! - this.syncStream!.pts! - this._syncTolerance

      // Calculate sleep time in milliseconds based on delta
      const sleepTime = Math.min(delta * 1000, 50) // Cap sleep time to 50ms

      if (sleepTime > 1) {
        await setTimeout(sleepTime)
      } else {
        // Yield control to avoid tight loop if sleep time is too small
        await setTimeout(1)
      }
    }
  }

  // Determines whether the stream should wait for synchronization
  private shouldWaitForSync(): boolean {
    return (
      this.syncStream !== undefined &&
      !this.syncStream.writableEnded &&
      this.syncStream.pts !== undefined &&
      this._pts !== undefined &&
      this._pts - this.syncStream.pts > this._syncTolerance
    )
  }
}
