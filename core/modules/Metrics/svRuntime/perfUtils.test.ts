import { expect, it, suite, vi } from 'vitest';
import { diffPerfs, didPerfReset, fetchRawPerfData } from './perfUtils';

const { requestText } = vi.hoisted(() => ({ requestText: vi.fn<() => Promise<string>>() }));
vi.mock('@lib/got', () => ({ default: () => ({ text: requestText }) }));

it('returns the raw performance response even when its format is unrecognized', async () => {
    const raw = '# Unrecognized performance format\nnew_metric 1\n';
    requestText.mockResolvedValueOnce(raw);
    expect(await fetchRawPerfData('127.0.0.1:30122')).toBe(raw);
});


suite('diffPerfs', () => {
    it('should correctly calculate the difference between two performance snapshots', () => {
        const oldPerf = {
            svSync: { count: 10, sum: 20, buckets: [1, 2, 3] },
            svNetwork: { count: 15, sum: 30, buckets: [4, 5, 6] },
            svMain: { count: 20, sum: 40, buckets: [7, 8, 9] },
        };
        const newPerf = {
            svSync: { count: 20, sum: 40, buckets: [2, 4, 6] },
            svNetwork: { count: 30, sum: 60, buckets: [8, 10, 12] },
            svMain: { count: 40, sum: 80, buckets: [14, 16, 18] },
        };
        const expectedDiff = {
            svSync: { count: 10, sum: 20, buckets: [1, 2, 3] },
            svNetwork: { count: 15, sum: 30, buckets: [4, 5, 6] },
            svMain: { count: 20, sum: 40, buckets: [7, 8, 9] },
        };
        const result = diffPerfs(newPerf, oldPerf);
        expect(result).toEqual(expectedDiff);
    });

    it('should correctly return the diff when there is no old data', () => {
        const newPerf = {
            shouldBeIgnored: { count: 20, sum: 40, buckets: [2, 4, 6] },
            svSync: { count: 20, sum: 40, buckets: [2, 4, 6] },
            svNetwork: { count: 30, sum: 60, buckets: [8, 10, 12] },
            svMain: { count: 40, sum: 80, buckets: [14, 16, 18] },
        };
        const expectedDiff = {
            svSync: { count: 20, sum: 40, buckets: [2, 4, 6] },
            svNetwork: { count: 30, sum: 60, buckets: [8, 10, 12] },
            svMain: { count: 40, sum: 80, buckets: [14, 16, 18] },
        };
        const result = diffPerfs(newPerf);
        expect(result).toEqual(expectedDiff);
    });
});


suite('didPerfReset', () => {
    it('should detect change in count in any thread', () => {
        const oldPerf = {
            svNetwork: { count: 10, sum: 0, buckets: [] },
            svSync: { count: 10, sum: 0, buckets: [] },
            svMain: { count: 10, sum: 0, buckets: [] },
        };
        const newPerf = {
            svNetwork: { count: 10, sum: 0, buckets: [] },
            svSync: { count: 5, sum: 0, buckets: [] },
            svMain: { count: 10, sum: 0, buckets: [] },
        };
        expect(didPerfReset(newPerf, oldPerf)).toBe(true);
    });

    it('should detect change in sum in any thread', () => {
        const oldPerf = {
            svNetwork: { count: 0, sum: 10, buckets: [] },
            svSync: { count: 0, sum: 10, buckets: [] },
            svMain: { count: 0, sum: 10, buckets: [] },
        };
        const newPerf = {
            svNetwork: { count: 0, sum: 10, buckets: [] },
            svSync: { count: 0, sum: 5, buckets: [] },
            svMain: { count: 0, sum: 10, buckets: [] },
        };
        expect(didPerfReset(newPerf, oldPerf)).toBe(true);
    });

    it('should detect reset - real case', () => {
        const oldPerf = {
            svNetwork: { count: 5940, sum: 0.08900000000000005, buckets: [] },
            svSync: { count: 7333, sum: 0.1400000000000001, buckets: [] },
            svMain: { count: 1209, sum: 0.1960000000000001, buckets: [] },
        };
        const newPerf = {
            svSync: { count: 1451, sum: 0.01600000000000001, buckets: [] },
            svNetwork: { count: 1793, sum: 0.03900000000000003, buckets: [] },
            svMain: { count: 278, sum: 0.05300000000000004, buckets: [] },
        };
        expect(didPerfReset(newPerf, oldPerf)).toBe(true);
    });

    it('should detect progression - real case', () => {
        const oldPerf = {
            svSync: { count: 1451, sum: 0.01600000000000001, buckets: [] },
            svNetwork: { count: 1793, sum: 0.03900000000000003, buckets: [] },
            svMain: { count: 278, sum: 0.05300000000000004, buckets: [] },
        };
        const newPerf = {
            svNetwork: { count: 8764, sum: 0.1030000000000001, buckets: [] },
            svSync: { count: 10815, sum: 0.1880000000000001, buckets: [] },
            svMain: { count: 1792, sum: 0.3180000000000002, buckets: [] },
        };
        expect(didPerfReset(newPerf, oldPerf)).toBe(false);
    });
});
