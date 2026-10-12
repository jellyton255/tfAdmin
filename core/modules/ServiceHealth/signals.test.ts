import { describe, expect, it } from 'vitest';
import { databaseSignal, logDeliverySignal, playerSavesSignal, type ServiceRead } from './signals';

const NOW = 1_700_000_000;
const read = (data: unknown): ServiceRead => ({ ok: true, sample: { serverNow: NOW, data } });
const missing: ServiceRead = { ok: false, reason: 'ef_lib is not started' };


describe('databaseSignal', () => {
    const check = { healthy: true, milliseconds: 12, checkedAt: NOW - 20, checkSeconds: 60 };

    it('shows the response time of a fresh healthy check', () => {
        expect(databaseSignal(read(check))).toEqual({ state: 'ok', text: '12 ms' });
    });

    it('shows the failure text of a failed check', () => {
        const failed = { healthy: false, detail: 'Check did not respond within 5 seconds', checkedAt: NOW, checkSeconds: 60 };
        expect(databaseSignal(read(failed))).toEqual({ state: 'failing', text: 'Check did not respond within 5 seconds' });
    });

    it('treats a check older than two intervals as unknown', () => {
        expect(databaseSignal(read({ ...check, checkedAt: NOW - 200 })).state).toBe('unknown');
    });

    it('treats a missing or malformed reading as unknown', () => {
        expect(databaseSignal(missing)).toEqual({ state: 'unknown', text: 'Unknown', reason: 'ef_lib is not started' });
        expect(databaseSignal(read({ healthy: 'yes' })).state).toBe('unknown');
    });
});


describe('logDeliverySignal', () => {
    it('shows when Loki last accepted logs', () => {
        const status = { pendingBatches: 0, oldestPendingSeconds: 0, lastSuccessAt: NOW - 125 };
        expect(logDeliverySignal(read(status))).toEqual({ state: 'ok', text: 'Loki accepted logs 2 minutes ago' });
    });

    it('shows waiting batches as degraded, and failing while deliveries fail', () => {
        const waiting = { pendingBatches: 3, oldestPendingSeconds: 240, lastSuccessAt: NOW - 240 };
        expect(logDeliverySignal(read(waiting))).toEqual({ state: 'degraded', text: '3 batches waiting, oldest 4 minutes' });
        expect(logDeliverySignal(read({ ...waiting, pendingBatches: 1, failureSince: NOW - 60 })))
            .toEqual({ state: 'failing', text: '1 batch waiting, oldest 4 minutes' });
    });

    it('never calls delivery healthy without an accepted batch', () => {
        expect(logDeliverySignal(read({ pendingBatches: 0, oldestPendingSeconds: 0 })).state).toBe('unknown');
        expect(logDeliverySignal(missing)).toMatchObject({ state: 'unknown', text: 'Unavailable' });
    });
});


describe('playerSavesSignal', () => {
    it('maps qbx_core severities to signal states with its own headline', () => {
        expect(playerSavesSignal(read({ severity: 'ok' }))).toEqual({ state: 'ok', text: 'Healthy' });
        expect(playerSavesSignal(read({ severity: 'warn', headline: '1 player has not finished spawning' })))
            .toEqual({ state: 'degraded', text: '1 player has not finished spawning' });
        expect(playerSavesSignal(read({ severity: 'error', headline: 'Save loop has not completed a pass' })))
            .toEqual({ state: 'failing', text: 'Save loop has not completed a pass' });
    });

    it('treats a snapshot without a diagnosis as unknown', () => {
        expect(playerSavesSignal(read({ writesAcknowledged: 4 })).state).toBe('unknown');
    });
});
