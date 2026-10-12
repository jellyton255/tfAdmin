import { z } from 'zod';
import type { ServiceSignal } from '@shared/socketioTypes';

/**
 * A successful read from resource/sv_services.lua, stamped with the game server clock.
 */
export type ServiceSample = {
    serverNow: number;
    data: unknown;
};
export type ServiceRead =
    | { ok: true; sample: ServiceSample }
    | { ok: false; reason: string };

const nullableNumber = z.number().nullable().default(null);
export const databaseSchema = z.object({
    healthy: z.boolean(),
    detail: z.string().nullable().default(null),
    milliseconds: nullableNumber,
    checkedAt: z.number(),
    checkSeconds: z.number().positive(),
});
export const logDeliverySchema = z.object({
    pendingBatches: z.number().int().nonnegative(),
    oldestPendingSeconds: z.number().nonnegative(),
    lastSuccessAt: nullableNumber,
    failureSince: nullableNumber,
});
export const playerSavesSchema = z.object({
    severity: z.enum(['ok', 'warn', 'error']),
    headline: z.string().nullable().default(null),
});

//ef_lib's probe gives up after 5 seconds, so a check can land that much after its interval
const DATABASE_PROBE_TIMEOUT_SECONDS = 5;

const unknown = (text: string, reason: string): ServiceSignal => ({ state: 'unknown', text, reason });

const plural = (count: number, singular: string, pluralForm = `${singular}s`) => {
    return `${count} ${count === 1 ? singular : pluralForm}`;
};

export const describeDuration = (seconds: number) => {
    const whole = Math.max(0, Math.floor(seconds));
    if (whole < 60) return plural(whole, 'second');
    if (whole < 3600) return plural(Math.floor(whole / 60), 'minute');
    return plural(Math.floor(whole / 3600), 'hour');
};


export function databaseSignal(read: ServiceRead): ServiceSignal {
    if (!read.ok) return unknown('Unknown', read.reason);
    const parsed = databaseSchema.safeParse(read.sample.data);
    if (!parsed.success) return unknown('Unknown', 'ef_lib returned an invalid database check.');

    const health = parsed.data;
    const age = read.sample.serverNow - health.checkedAt;
    if (age > health.checkSeconds * 2 + DATABASE_PROBE_TIMEOUT_SECONDS) {
        return unknown('Unknown', `The last database check ran ${describeDuration(age)} ago.`);
    }
    if (!health.healthy) {
        return { state: 'failing', text: health.detail ?? 'Check failed' };
    }
    if (health.milliseconds === null) {
        return unknown('Unknown', 'ef_lib did not report a response time.');
    }
    return { state: 'ok', text: `${health.milliseconds} ms` };
}


export function logDeliverySignal(read: ServiceRead): ServiceSignal {
    if (!read.ok) return unknown('Unavailable', read.reason);
    const parsed = logDeliverySchema.safeParse(read.sample.data);
    if (!parsed.success) return unknown('Unavailable', 'ef_logs returned an invalid delivery status.');

    const status = parsed.data;
    if (status.pendingBatches > 0) {
        return {
            state: status.failureSince === null ? 'degraded' : 'failing',
            text: `${plural(status.pendingBatches, 'batch', 'batches')} waiting, oldest ${describeDuration(status.oldestPendingSeconds)}`,
        };
    }
    if (status.failureSince !== null) {
        return { state: 'failing', text: 'Last delivery failed' };
    }
    if (status.lastSuccessAt === null) {
        return unknown('No logs delivered yet', 'Loki has not accepted any logs since ef_logs started.');
    }
    const age = read.sample.serverNow - status.lastSuccessAt;
    return { state: 'ok', text: `Loki accepted logs ${describeDuration(age)} ago` };
}


export function playerSavesSignal(read: ServiceRead): ServiceSignal {
    if (!read.ok) return unknown('Unknown', read.reason);
    const parsed = playerSavesSchema.safeParse(read.sample.data);
    if (!parsed.success) return unknown('Unknown', 'qbx_core returned an invalid save diagnosis.');

    const { severity, headline } = parsed.data;
    if (severity === 'ok') return { state: 'ok', text: 'Healthy' };
    return {
        state: severity === 'error' ? 'failing' : 'degraded',
        text: headline ?? 'Player saves need attention',
    };
}
