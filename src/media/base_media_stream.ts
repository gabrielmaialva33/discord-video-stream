import { setTimeout } from 'node:timers/promises'
import { Writable } from 'node:stream'

export class BaseMediaStream extends Writable {
  syncStream?: BaseMediaStream

  private _pts?: number

  get pts(): number | undefined {
    return this._pts
  }

  protected set pts(n: number | undefined) {
    this._pts = n
  }

  private _syncTolerance: number = 0

  get syncTolerance() {
    return this._syncTolerance
  }

  set syncTolerance(n: number) {
    if (n < 0) return
    this._syncTolerance = n
  }

  _destroy(error: Error | null, callback: (error?: Error | null) => void): void {
    super._destroy(error, callback)
    this.syncStream = undefined
  }

  protected async _waitForOtherStream() {
    while (
      this.syncStream &&
      !this.syncStream.writableEnded &&
      this.syncStream.pts !== undefined &&
      this._pts !== undefined &&
      this._pts - this.syncStream.pts > this._syncTolerance
    )
      await setTimeout(1)
  }
}
