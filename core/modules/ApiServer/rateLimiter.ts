/**
 * Per-key token bucket rate limiter.
 * Each key gets a bucket for normal requests and a smaller one for "heavy" actions
 * (server control, console commands), so a runaway bot can't restart the server in a loop.
 */
export type BucketConfig = {
    capacity: number; //max tokens
    refillPerSec: number; //tokens added per second
};

type Bucket = {
    tokens: number;
    updatedAt: number;
};

export const DEFAULT_BUCKET: BucketConfig = { capacity: 120, refillPerSec: 2 }; //~120 req/min
export const HEAVY_BUCKET: BucketConfig = { capacity: 10, refillPerSec: 10 / 60 }; //~10 req/min

export type RateLimitResult = {
    allowed: boolean;
    remaining: number;
    retryAfterSec: number;
};

export default class ApiRateLimiter {
    private buckets = new Map<string, Bucket>();
    private readonly sweepTimer: NodeJS.Timeout;

    constructor(
        private readonly normal: BucketConfig = DEFAULT_BUCKET,
        private readonly heavy: BucketConfig = HEAVY_BUCKET,
    ) {
        //Drop idle buckets every 10 minutes so the map can't grow forever
        this.sweepTimer = setInterval(() => {
            const cutoff = Date.now() - 10 * 60_000;
            for (const [k, b] of this.buckets) {
                if (b.updatedAt < cutoff) this.buckets.delete(k);
            }
        }, 10 * 60_000);
        this.sweepTimer.unref?.();
    }

    /**
     * Consumes one token from the key's bucket. `heavy` selects the stricter bucket.
     */
    consume(keyId: string, heavy = false, now = Date.now()): RateLimitResult {
        const cfg = heavy ? this.heavy : this.normal;
        const bucketId = heavy ? `${keyId}#heavy` : keyId;
        let bucket = this.buckets.get(bucketId);
        if (!bucket) {
            bucket = { tokens: cfg.capacity, updatedAt: now };
            this.buckets.set(bucketId, bucket);
        } else {
            const elapsedSec = Math.max(0, now - bucket.updatedAt) / 1000;
            bucket.tokens = Math.min(cfg.capacity, bucket.tokens + elapsedSec * cfg.refillPerSec);
            bucket.updatedAt = now;
        }

        if (bucket.tokens >= 1) {
            bucket.tokens -= 1;
            return { allowed: true, remaining: Math.floor(bucket.tokens), retryAfterSec: 0 };
        }
        const deficit = 1 - bucket.tokens;
        return {
            allowed: false,
            remaining: 0,
            retryAfterSec: Math.max(1, Math.ceil(deficit / cfg.refillPerSec)),
        };
    }

    destroy() {
        clearInterval(this.sweepTimer);
        this.buckets.clear();
    }
}
