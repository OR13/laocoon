/** Minimum interval between successive calls. */
export class RateLimiter {
  #last = 0;

  constructor(private readonly minIntervalMs: number) {}

  async wait(): Promise<void> {
    if (this.minIntervalMs <= 0) return;
    const elapsed = Date.now() - this.#last;
    if (this.#last && elapsed < this.minIntervalMs) {
      await Bun.sleep(this.minIntervalMs - elapsed);
    }
    this.#last = Date.now();
  }
}
