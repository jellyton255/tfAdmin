const modulename = 'ApiServer:Webhooks';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { customAlphabet } from 'nanoid';
import dict49 from 'nanoid-dictionary/nolookalikes';
import { txEnv } from '@core/globalData';
import consoleFactory from '@lib/console';
import defaultGot from '@lib/got';
import {
    API_WEBHOOK_DELIVERIES_KEPT,
    API_WEBHOOK_SIGNATURE_HEADER,
    type ApiEvent,
    type ApiWebhookDelivery,
    type ApiWebhookPayload,
} from '@shared/apiV1Types';
import type ApiEventBus from './events';
import type WebhookStore from './WebhookStore';
import type { StoredWebhook } from './WebhookStore';
const console = consoleFactory(modulename);

const genDeliveryId = customAlphabet(dict49, 16);

/** Retry delays after a failed attempt: 10s, 1min, 10min, 1h; then the delivery is marked failed. */
export const DEFAULT_BACKOFF_MS = [10_000, 60_000, 600_000, 3_600_000];
export const DELIVERY_TIMEOUT_MS = 5_000;
/** Signatures older than this are rejected by verifyWebhookSignature (replay protection). */
export const SIGNATURE_TOLERANCE_MS = 5 * 60_000;

export type WebhookSendResult = { status: number; error?: undefined } | { status: null; error: string };
export type WebhookSender = (url: string, body: string, headers: Record<string, string>) => Promise<WebhookSendResult>;

export type DispatcherOptions = {
    sender?: WebhookSender;
    backoffMs?: number[];
};


/**
 * Signing helpers (shared with docs/tests; the client package has a copy of verify)
 */
export const signWebhookBody = (secret: string, ts: number, body: string) => {
    const hmac = createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex');
    return `t=${ts},v1=${hmac}`;
};

export const verifyWebhookSignature = (
    secret: string,
    header: string | undefined,
    body: string,
    nowMs = Date.now(),
    toleranceMs = SIGNATURE_TOLERANCE_MS,
): boolean => {
    if (typeof header !== 'string') return false;
    const parts = Object.fromEntries(header.split(',').map((kv) => kv.split('=') as [string, string]));
    const ts = Number(parts.t);
    if (!Number.isFinite(ts) || typeof parts.v1 !== 'string') return false;
    if (Math.abs(nowMs - ts) > toleranceMs) return false;
    const expected = createHmac('sha256', secret).update(`${ts}.${body}`).digest();
    const given = Buffer.from(parts.v1, 'hex');
    return given.length === expected.length && timingSafeEqual(given, expected);
};


/**
 * Default transport: a plain POST with the txAdmin got instance, no redirects, no got retries.
 */
const gotSender: WebhookSender = async (url, body, headers) => {
    try {
        const resp = await defaultGot.post(url, {
            body,
            headers,
            followRedirect: false,
            throwHttpErrors: false,
            retry: { limit: 0 },
            timeout: { request: DELIVERY_TIMEOUT_MS },
        });
        return { status: resp.statusCode };
    } catch (error) {
        return { status: null, error: (error as Error).message };
    }
};


type PendingDelivery = {
    delivery: ApiWebhookDelivery;
    event: ApiEvent;
    webhookId: string;
    timer: NodeJS.Timeout | null;
};


/**
 * Fans events out to subscribed webhooks: signs, posts, retries with backoff and keeps the
 * last deliveries per webhook in memory for the panel and GET /webhooks/:id/deliveries.
 */
export default class WebhookDispatcher {
    private readonly sender: WebhookSender;
    private readonly backoffMs: number[];
    private readonly history = new Map<string, ApiWebhookDelivery[]>();
    private readonly pending = new Map<string, PendingDelivery>();
    private readonly unsubscribe: () => void;
    private destroyed = false;

    constructor(
        private readonly store: WebhookStore,
        events: ApiEventBus,
        options: DispatcherOptions = {},
    ) {
        this.sender = options.sender ?? gotSender;
        this.backoffMs = options.backoffMs ?? DEFAULT_BACKOFF_MS;
        this.unsubscribe = events.onEvent((event) => this.enqueue(event));
    }

    destroy() {
        this.destroyed = true;
        this.unsubscribe();
        for (const entry of this.pending.values()) {
            if (entry.timer) clearTimeout(entry.timer);
        }
        this.pending.clear();
    }

    get pendingCount() {
        return this.pending.size;
    }


    /**
     * Creates one delivery per subscribed webhook and fires the first attempt.
     * `webhook.test` events only go to the webhook they were created for.
     */
    enqueue(event: ApiEvent): ApiWebhookDelivery[] {
        if (this.destroyed) return [];
        let targets: StoredWebhook[];
        if (event.type === 'webhook.test') {
            const target = this.store.getStored(String(event.data.webhookId ?? ''));
            targets = target ? [target] : [];
        } else {
            targets = this.store.subscribersFor(event.type);
        }
        return targets.map((webhook) => this.createDelivery(webhook, event));
    }

    private createDelivery(webhook: StoredWebhook, event: ApiEvent): ApiWebhookDelivery {
        const delivery: ApiWebhookDelivery = {
            id: genDeliveryId(),
            webhookId: webhook.id,
            eventId: event.id,
            eventType: event.type,
            status: 'pending',
            attempts: 0,
            httpStatus: null,
            error: null,
            createdAt: Date.now(),
            lastAttemptAt: null,
            nextAttemptAt: Date.now(),
        };
        this.remember(delivery);
        const entry: PendingDelivery = { delivery, event, webhookId: webhook.id, timer: null };
        this.pending.set(delivery.id, entry);
        void this.attempt(entry);
        return delivery;
    }

    private remember(delivery: ApiWebhookDelivery) {
        const list = this.history.get(delivery.webhookId) ?? [];
        list.unshift(delivery);
        if (list.length > API_WEBHOOK_DELIVERIES_KEPT) list.length = API_WEBHOOK_DELIVERIES_KEPT;
        this.history.set(delivery.webhookId, list);
    }


    /**
     * One attempt. The webhook is re-read from the store on every attempt so a deleted or
     * disabled webhook stops receiving retries.
     */
    private async attempt(entry: PendingDelivery): Promise<void> {
        if (this.destroyed || !this.pending.has(entry.delivery.id)) return;
        const { delivery, event } = entry;
        const webhook = this.store.getStored(entry.webhookId);
        if (!webhook || (!webhook.enabled && event.type !== 'webhook.test')) {
            this.finish(entry, 'failed', null, 'webhook removed or disabled');
            return;
        }

        delivery.attempts++;
        delivery.lastAttemptAt = Date.now();
        delivery.nextAttemptAt = null;
        const payload: ApiWebhookPayload = {
            event,
            webhookId: webhook.id,
            deliveryId: delivery.id,
            attempt: delivery.attempts,
            server: {
                name: (globalThis as any).txConfig?.general?.serverName ?? 'txAdmin',
                txAdminVersion: txEnv.txaVersion,
            },
        };
        const body = JSON.stringify(payload);
        const ts = Date.now();
        const headers: Record<string, string> = {
            'content-type': 'application/json',
            [API_WEBHOOK_SIGNATURE_HEADER]: signWebhookBody(webhook.secret, ts, body),
            'x-txadmin-event': event.type,
            'x-txadmin-delivery': delivery.id,
            'x-txadmin-webhook': webhook.id,
        };

        let result: WebhookSendResult;
        try {
            result = await this.sender(webhook.url, body, headers);
        } catch (error) {
            result = { status: null, error: (error as Error).message };
        }
        if (this.destroyed || !this.pending.has(delivery.id)) return;

        delivery.httpStatus = result.status;
        if (result.status !== null && result.status >= 200 && result.status < 300) {
            this.finish(entry, 'ok', result.status, null);
            return;
        }

        const error = result.status !== null ? `HTTP ${result.status}` : (result.error ?? 'request failed');
        const delay = this.backoffMs[delivery.attempts - 1];
        if (delay === undefined) {
            this.finish(entry, 'failed', result.status, error);
            return;
        }
        delivery.error = error;
        delivery.nextAttemptAt = Date.now() + delay;
        console.verbose.warn(`Delivery ${delivery.id} to '${webhook.name}' failed (${error}), retrying in ${delay / 1000}s.`);
        entry.timer = setTimeout(() => {
            entry.timer = null;
            void this.attempt(entry);
        }, delay);
        entry.timer.unref?.();
    }

    private finish(entry: PendingDelivery, status: 'ok' | 'failed', httpStatus: number | null, error: string | null) {
        const { delivery } = entry;
        delivery.status = status;
        delivery.httpStatus = httpStatus;
        delivery.error = error;
        delivery.nextAttemptAt = null;
        if (entry.timer) clearTimeout(entry.timer);
        this.pending.delete(delivery.id);
        this.store.recordDelivery(delivery.webhookId, status === 'ok');
        if (status === 'failed') {
            console.warn(`Webhook delivery ${delivery.id} (${delivery.eventType}) gave up after ${delivery.attempts} attempt(s): ${error}`);
        }
    }


    /**
     * Waits for a delivery to settle (resolves with its final state). Used by the test endpoint.
     */
    async waitFor(deliveryId: string, timeoutMs = DELIVERY_TIMEOUT_MS + 1000): Promise<ApiWebhookDelivery | null> {
        const found = this.find(deliveryId);
        if (!found) return null;
        const start = Date.now();
        //nextAttemptAt is null only while an attempt is in flight; a scheduled retry means the first attempt settled
        while (this.pending.has(deliveryId) && found.nextAttemptAt === null && Date.now() - start < timeoutMs) {
            await new Promise((r) => setTimeout(r, 25));
        }
        return found;
    }

    find(deliveryId: string): ApiWebhookDelivery | null {
        for (const list of this.history.values()) {
            const hit = list.find((d) => d.id === deliveryId);
            if (hit) return hit;
        }
        return null;
    }

    listDeliveries(webhookId: string): ApiWebhookDelivery[] {
        return [...(this.history.get(webhookId) ?? [])];
    }

    forget(webhookId: string) {
        for (const [id, entry] of this.pending) {
            if (entry.webhookId !== webhookId) continue;
            if (entry.timer) clearTimeout(entry.timer);
            this.pending.delete(id);
        }
        this.history.delete(webhookId);
    }
}
