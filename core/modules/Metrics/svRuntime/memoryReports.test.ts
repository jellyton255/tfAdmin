import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import SvRuntimeMetrics from './index';

vi.mock('@core/globalData', () => ({
    txEnv: { profilePath: '/tmp/tfadmin-memory-report-test', txaVersion: '9.9.9-test' },
    txDevEnv: {},
    txHostConfig: {},
}));

vi.mock('node:fs/promises', () => ({
    default: {
        readFile: vi.fn().mockRejectedValue(Object.assign(new Error('Missing test history'), { code: 'ENOENT' })),
        writeFile: vi.fn().mockResolvedValue(undefined),
    },
}));

const pushRefresh = vi.fn();

beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-16T12:00:00Z'));
    vi.stubGlobal('txCore', { webServer: { webSocket: { pushRefresh } } });
    pushRefresh.mockClear();
});

afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

it('accepts legacy heap reports without inventing whole-process memory', () => {
    const metrics = new SvRuntimeMetrics();
    metrics.logServerNodeMemory({ used: 80, limit: 256 });
    expect(metrics.getRecentStats().nodeMemory).toEqual({ used: 80, limit: 256 });
    expect(metrics.getFxsMemory()).toBeUndefined();
});

it('expires both memory readings and refreshes the dashboard when reports stop', async () => {
    const metrics = new SvRuntimeMetrics();
    metrics.logServerNodeMemory({ ts: Date.now(), used: 80, limit: 256, rss: 1024 });
    expect(metrics.getFxsMemory()).toBe(1024);
    await vi.advanceTimersByTimeAsync(36_000);
    expect(metrics.getFxsMemory()).toBeUndefined();
    expect(metrics.getRecentStats().nodeMemory).toBeUndefined();
    expect(pushRefresh).toHaveBeenCalledTimes(2);
});

it('limits future-dated reports to the normal freshness window', () => {
    const metrics = new SvRuntimeMetrics();
    metrics.logServerNodeMemory({ ts: Date.now() + 60_000, used: 80, limit: 256, rss: 1024 });
    vi.setSystemTime(Date.now() + 35_001);
    expect(metrics.getFxsMemory()).toBeUndefined();
});

it('rejects invalid memory reports and clears valid readings when the server closes', () => {
    const metrics = new SvRuntimeMetrics();
    metrics.logServerNodeMemory({ used: 80, limit: 256, rss: -1 });
    expect(metrics.getRecentStats().nodeMemory).toBeUndefined();
    expect(pushRefresh).not.toHaveBeenCalled();
    metrics.logServerNodeMemory({ used: 80, limit: 256, rss: 1024 });
    metrics.logServerClose('test shutdown');
    expect(metrics.getFxsMemory()).toBeUndefined();
    expect(metrics.getRecentStats().nodeMemory).toBeUndefined();
});
