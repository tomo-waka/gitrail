import type { ExtractionTimings, MonotonicClock, StageProfiler } from "./types.js";

export class DefaultStageProfiler implements StageProfiler {
  private _traversalMs = 0;
  private _blobReadMs = 0;
  private _diffMs = 0;
  private _projectionMs = 0;
  private _writeMs = 0;

  private readonly clock: MonotonicClock;

  constructor(clock: MonotonicClock) {
    this.clock = clock;
  }

  now(): number {
    return this.clock();
  }

  addTraversalMs(ms: number): void {
    this._traversalMs += ms;
  }

  addBlobReadMs(ms: number): void {
    this._blobReadMs += ms;
  }

  addDiffMs(ms: number): void {
    this._diffMs += ms;
  }

  addProjectionMs(ms: number): void {
    this._projectionMs += ms;
  }

  addWriteMs(ms: number): void {
    this._writeMs += ms;
  }

  snapshot(): ExtractionTimings {
    return {
      traversalMs: this._traversalMs,
      blobReadMs: this._blobReadMs,
      diffMs: this._diffMs,
      projectionMs: this._projectionMs,
      writeMs: this._writeMs,
    };
  }
}
