import { afterEach, describe, expect, it } from 'vitest';
import ApiRateLimiter from './rateLimiter';
import { invalidIpEntries, isIpAllowed, normalizeIp } from './ipAllowlist';

describe('ApiRateLimiter', () => {
    let limiter: ApiRateLimiter;
    afterEach(() => limiter?.destroy());

    it('allows up to capacity then blocks with a retry hint', () => {
        limiter = new ApiRateLimiter({ capacity: 3, refillPerSec: 1 }, { capacity: 1, refillPerSec: 0.1 });
        const t0 = 1_000_000;
        expect(limiter.consume('k', false, t0).allowed).toBe(true);
        expect(limiter.consume('k', false, t0).allowed).toBe(true);
        expect(limiter.consume('k', false, t0).allowed).toBe(true);
        const blocked = limiter.consume('k', false, t0);
        expect(blocked.allowed).toBe(false);
        expect(blocked.retryAfterSec).toBe(1);
        //refills over time
        expect(limiter.consume('k', false, t0 + 1000).allowed).toBe(true);
    });

    it('keeps separate buckets per key and for heavy actions', () => {
        limiter = new ApiRateLimiter({ capacity: 2, refillPerSec: 1 }, { capacity: 1, refillPerSec: 0.1 });
        const t0 = 5_000;
        expect(limiter.consume('a', false, t0).allowed).toBe(true);
        expect(limiter.consume('a', false, t0).allowed).toBe(true);
        expect(limiter.consume('a', false, t0).allowed).toBe(false);
        expect(limiter.consume('b', false, t0).allowed).toBe(true);
        expect(limiter.consume('a', true, t0).allowed).toBe(true);
        const heavyBlocked = limiter.consume('a', true, t0);
        expect(heavyBlocked.allowed).toBe(false);
        expect(heavyBlocked.retryAfterSec).toBe(10);
    });
});

describe('ipAllowlist', () => {
    it('normalizes mapped ipv4', () => {
        expect(normalizeIp('::ffff:1.2.3.4')).toBe('1.2.3.4');
        expect(normalizeIp('2001:db8::1')).toBe('2001:db8::1');
    });
    it('matches ips and cidrs, ignores invalid entries', () => {
        expect(isIpAllowed('1.2.3.4', [])).toBe(true);
        expect(isIpAllowed('1.2.3.4', ['1.2.3.4'])).toBe(true);
        expect(isIpAllowed('1.2.3.5', ['1.2.3.4'])).toBe(false);
        expect(isIpAllowed('192.168.7.7', ['192.168.0.0/16'])).toBe(true);
        expect(isIpAllowed('2001:db8::5', ['2001:db8::/32'])).toBe(true);
        expect(isIpAllowed('1.2.3.4', ['garbage', '1.2.3.0/24'])).toBe(true);
    });
    it('reports invalid entries', () => {
        expect(invalidIpEntries(['1.2.3.4', '10.0.0.0/8', 'nope', '1.2.3.4/99', '::1'])).toEqual(['nope', '1.2.3.4/99']);
    });
});
