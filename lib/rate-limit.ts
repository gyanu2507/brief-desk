/** Tiny in-memory rate limit + concurrency gate for Node API routes. */

export type RateLimitResult =
  | { ok: true; remaining: number; resetMs: number }
  | { ok: false; remaining: 0; resetMs: number; retryAfterSec: number };

type Bucket = {
  timestamps: number[];
};

const buckets = new Map<string, Bucket>();

export function rateLimit(opts: {
  key: string;
  limit: number;
  windowMs: number;
  now?: number;
}): RateLimitResult {
  const now = opts.now ?? Date.now();
  const windowStart = now - opts.windowMs;
  let bucket = buckets.get(opts.key);
  if (!bucket) {
    bucket = { timestamps: [] };
    buckets.set(opts.key, bucket);
  }
  bucket.timestamps = bucket.timestamps.filter((t) => t > windowStart);
  if (bucket.timestamps.length >= opts.limit) {
    const oldest = bucket.timestamps[0] ?? now;
    const resetMs = Math.max(0, oldest + opts.windowMs - now);
    return {
      ok: false,
      remaining: 0,
      resetMs,
      retryAfterSec: Math.max(1, Math.ceil(resetMs / 1000)),
    };
  }
  bucket.timestamps.push(now);
  return {
    ok: true,
    remaining: Math.max(0, opts.limit - bucket.timestamps.length),
    resetMs: opts.windowMs,
  };
}

/** Test helper. */
export function resetRateLimitBuckets(): void {
  buckets.clear();
}

type Waiter = {
  resolve: () => void;
};

export class ConcurrencyGate {
  private active = 0;
  private readonly waiters: Waiter[] = [];

  constructor(private readonly max: number) {
    if (max < 1) throw new Error("max concurrency must be >= 1");
  }

  get running(): number {
    return this.active;
  }

  get queued(): number {
    return this.waiters.length;
  }

  async acquire(): Promise<() => void> {
    if (this.active < this.max) {
      this.active += 1;
      return () => this.release();
    }
    await new Promise<void>((resolve) => {
      this.waiters.push({ resolve });
    });
    this.active += 1;
    return () => this.release();
  }

  private release(): void {
    this.active = Math.max(0, this.active - 1);
    const next = this.waiters.shift();
    if (next) next.resolve();
  }
}

/** Shared brief-run gate (process-local). */
export const briefRunGate = new ConcurrencyGate(
  Math.max(1, Number(process.env.BRIEF_RUN_MAX_CONCURRENCY || 2)),
);
