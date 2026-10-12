const modulename = 'ServiceHealth';
import { z } from 'zod';
import got from '@lib/got';
import consoleFactory from '@lib/console';
import type { ServiceSignals } from '@shared/socketioTypes';
import { databaseSignal, logDeliverySignal, playerSavesSignal, type ServiceRead } from './signals';
const console = consoleFactory(modulename);

const POLL_INTERVAL_MS = 15_000;
const REQUEST_TIMEOUT_MS = 3_000;
//Two missed polls and the cached reading no longer describes the server
const STALE_AFTER_MS = POLL_INTERVAL_MS * 2 + REQUEST_TIMEOUT_MS;
const SERVICE_NAMES = ['database', 'logDelivery', 'playerSaves'] as const;
type ServiceName = typeof SERVICE_NAMES[number];

const sampleRespSchema = z.object({ now: z.number(), data: z.unknown() });
const errorRespSchema = z.object({ error: z.string() });

type CachedRead = {
    mutex: string;
    receivedAt: number;
    read: ServiceRead;
};


/**
 * Asks the monitor resource (resource/sv_services.lua) for one service's status export.
 * The panel never reaches the game server; it only sees the cached signals in the status event.
 */
async function fetchService(netEndpoint: string, name: ServiceName): Promise<ServiceRead> {
    let resp;
    try {
        resp = await got.post({
            url: `http://${netEndpoint}/monitor/services/${name}`,
            json: { txAdminToken: txCore.webServer.luaComToken },
            maxRedirects: 0,
            timeout: { request: REQUEST_TIMEOUT_MS },
            retry: { limit: 0 },
            throwHttpErrors: false,
        }).json<unknown>();
    } catch (error) {
        console.verbose.warn(`Service check ${name} failed: ${(error as Error).message}`);
        return { ok: false, reason: 'The game server did not answer the service check.' };
    }

    const sample = sampleRespSchema.safeParse(resp);
    if (sample.success) {
        return { ok: true, sample: { serverNow: sample.data.now, data: sample.data.data } };
    }
    const gameError = errorRespSchema.safeParse(resp);
    if (gameError.success && gameError.data.error === 'route not found') {
        return { ok: false, reason: 'The game server needs a restart to load service checks.' };
    }
    if (gameError.success) {
        return { ok: false, reason: `Service check failed: ${gameError.data.error}.` };
    }
    return { ok: false, reason: 'The game server returned an invalid service check.' };
}


/**
 * Everfall: polls database, log delivery and player save health from the game server
 * for the panel's Services block. Missing or stale readings are reported as unknown.
 */
export default class ServiceHealth {
    private readonly cache = new Map<ServiceName, CachedRead>();
    private pollInFlight = false;

    constructor() {
        setInterval(() => {
            this.poll();
        }, POLL_INTERVAL_MS);
    }

    private async poll() {
        if (this.pollInFlight) return;
        const child = txCore.fxRunner.child;
        if (!child?.isAlive || !child.netEndpoint) {
            this.cache.clear();
            return;
        }

        this.pollInFlight = true;
        try {
            const { mutex, netEndpoint } = child;
            await Promise.all(SERVICE_NAMES.map(async (name) => {
                const read = await fetchService(netEndpoint, name);
                this.cache.set(name, { mutex, receivedAt: Date.now(), read });
            }));
        } finally {
            this.pollInFlight = false;
        }
    }

    private currentRead(name: ServiceName): ServiceRead {
        const cached = this.cache.get(name);
        const child = txCore.fxRunner.child;
        if (!cached || !child?.isAlive || cached.mutex !== child.mutex) {
            return { ok: false, reason: 'No reading from the current game server yet.' };
        }
        if (Date.now() - cached.receivedAt > STALE_AFTER_MS) {
            return { ok: false, reason: 'The last reading is out of date.' };
        }
        return cached.read;
    }

    public get signals(): ServiceSignals {
        return {
            database: databaseSignal(this.currentRead('database')),
            logDelivery: logDeliverySignal(this.currentRead('logDelivery')),
            playerSaves: playerSavesSignal(this.currentRead('playerSaves')),
        };
    }
}
