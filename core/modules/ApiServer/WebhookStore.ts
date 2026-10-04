const modulename = 'ApiServer:WebhookStore';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { customAlphabet } from 'nanoid';
import dict49 from 'nanoid-dictionary/nolookalikes';
import { z } from 'zod';
import { txHostConfig } from '@core/globalData';
import consoleFactory from '@lib/console';
import {
    API_EVENT_TYPES,
    API_WEBHOOKS_MAX,
    API_WEBHOOK_NAME_MAX_LENGTH,
    API_WEBHOOK_SECRET_MAX_LENGTH,
    API_WEBHOOK_SECRET_MIN_LENGTH,
    API_WEBHOOK_URL_MAX_LENGTH,
    type ApiEventType,
    type ApiWebhookRecord,
} from '@shared/apiV1Types';
const console = consoleFactory(modulename);

const genId = customAlphabet(dict49, 12);
const genSecret = customAlphabet(dict49, 40);
const FILE_SCHEMA_VERSION = 1;
const STATS_WRITE_DEBOUNCE_MS = 30_000;


/**
 * Schemas
 */
const eventTypeSchema = z.enum(API_EVENT_TYPES);
const eventsSchema = z.union([
    z.tuple([z.literal('*')]),
    z.array(eventTypeSchema).min(1).max(API_EVENT_TYPES.length),
]);

const storedWebhookSchema = z.object({
    id: z.string().min(8),
    name: z.string().min(1).max(API_WEBHOOK_NAME_MAX_LENGTH),
    url: z.string().url().max(API_WEBHOOK_URL_MAX_LENGTH),
    secret: z.string().min(API_WEBHOOK_SECRET_MIN_LENGTH).max(API_WEBHOOK_SECRET_MAX_LENGTH),
    events: eventsSchema,
    enabled: z.boolean(),
    createdBy: z.string(),
    createdAt: z.number().int(),
    deliveredCount: z.number().int().nonnegative(),
    failedCount: z.number().int().nonnegative(),
    lastDeliveryAt: z.number().int().nullable(),
    lastDeliveryOk: z.boolean().nullable(),
});
export type StoredWebhook = z.infer<typeof storedWebhookSchema>;

const storeFileSchema = z.object({
    version: z.literal(FILE_SCHEMA_VERSION),
    webhooks: z.array(storedWebhookSchema),
});

const urlSchema = z.string().trim().min(1).max(API_WEBHOOK_URL_MAX_LENGTH).url()
    .refine((url) => /^https?:\/\//i.test(url), 'url must start with http:// or https://');

export const webhookCreateSchema = z.object({
    name: z.string().trim().min(1).max(API_WEBHOOK_NAME_MAX_LENGTH)
        .regex(/^[a-zA-Z0-9 _.-]+$/, 'name may only contain letters, numbers, spaces and _.-'),
    url: urlSchema,
    events: z.array(z.string().trim().min(1)).min(1, 'at least one event type is required'),
    secret: z.string().trim().min(API_WEBHOOK_SECRET_MIN_LENGTH).max(API_WEBHOOK_SECRET_MAX_LENGTH).optional(),
});
export type WebhookCreateInput = z.infer<typeof webhookCreateSchema>;

export const webhookUpdateSchema = z.object({
    enabled: z.boolean().optional(),
    events: z.array(z.string().trim().min(1)).min(1).optional(),
}).refine((v) => v.enabled !== undefined || v.events !== undefined, 'nothing to update');
export type WebhookUpdateInput = z.infer<typeof webhookUpdateSchema>;


export class WebhookStoreError extends Error {
    constructor(
        public readonly code: 'duplicate_name' | 'limit_reached' | 'invalid_events' | 'not_found',
        message: string,
        public readonly details?: unknown,
    ) {
        super(message);
        this.name = 'WebhookStoreError';
    }
}


/**
 * Normalizes an events input into the stored shape, rejecting unknown types.
 */
export const normalizeEvents = (input: string[]): StoredWebhook['events'] => {
    const unique = [...new Set(input.map((e) => e.trim()))];
    if (unique.includes('*')) return ['*'];
    const valid = new Set<string>(API_EVENT_TYPES);
    const unknown = unique.filter((e) => !valid.has(e));
    if (unknown.length) {
        throw new WebhookStoreError('invalid_events', 'Unknown event type(s).', { events: unknown });
    }
    return unique as ApiEventType[];
};

export const webhookMatches = (webhook: Pick<StoredWebhook, 'enabled' | 'events'>, type: ApiEventType) => {
    if (!webhook.enabled) return false;
    return webhook.events[0] === '*' || (webhook.events as string[]).includes(type);
};

export const toPublicWebhook = (webhook: StoredWebhook): ApiWebhookRecord => {
    const { secret: _secret, ...rest } = webhook;
    return rest;
};


/**
 * Stores the webhook subscriptions (txData/webhooks.json).
 * Secrets are kept in plaintext because they are needed to sign every delivery; they are
 * returned once on creation and never listed again.
 */
export default class WebhookStore {
    private readonly filePath: string;
    private webhooks: StoredWebhook[] = [];
    private statsTimer: NodeJS.Timeout | null = null;
    private writeChain: Promise<void> = Promise.resolve();

    constructor(filePath?: string) {
        this.filePath = filePath ?? txHostConfig.dataSubPath('webhooks.json');
        this.loadSync();
    }

    private loadSync() {
        let raw: string;
        try {
            raw = fs.readFileSync(this.filePath, 'utf8');
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
                this.webhooks = [];
                return;
            }
            throw new Error(`Failed to read webhooks file: ${(error as Error).message}`);
        }
        let parsed: unknown;
        try {
            parsed = JSON.parse(raw);
        } catch (error) {
            throw new Error(`Failed to parse webhooks file (${this.filePath}): ${(error as Error).message}`);
        }
        const validated = storeFileSchema.safeParse(parsed);
        if (!validated.success) {
            throw new Error(`Invalid webhooks file (${this.filePath}): ${validated.error.issues[0]?.message ?? 'unknown error'}`);
        }
        this.webhooks = validated.data.webhooks;
        console.verbose.ok(`Loaded ${this.webhooks.length} webhook(s).`);
    }

    /**
     * Same serialized atomic write pattern as ApiKeyStore.
     */
    private transact(mutation: (current: StoredWebhook[]) => StoredWebhook[]): Promise<void> {
        const run = async () => {
            const next = mutation(this.webhooks);
            const payload = JSON.stringify({ version: FILE_SCHEMA_VERSION, webhooks: next }, null, 2);
            const tmpPath = `${this.filePath}.${process.pid}.tmp`;
            try {
                await fsp.writeFile(tmpPath, payload, { encoding: 'utf8', mode: 0o600 });
                await fsp.rename(tmpPath, this.filePath);
            } catch (error) {
                await fsp.rm(tmpPath, { force: true }).catch(() => { });
                throw error;
            }
            this.webhooks = next;
        };
        const next = this.writeChain.then(run, run);
        this.writeChain = next.catch(() => { });
        return next;
    }


    get activeCount() {
        return this.webhooks.filter((w) => w.enabled).length;
    }

    list(): ApiWebhookRecord[] {
        return [...this.webhooks]
            .sort((a, b) => b.createdAt - a.createdAt)
            .map(toPublicWebhook);
    }

    get(id: string): ApiWebhookRecord | null {
        const webhook = this.webhooks.find((w) => w.id === id);
        return webhook ? toPublicWebhook(webhook) : null;
    }

    /** Internal: full record including the secret, for the dispatcher. */
    getStored(id: string): StoredWebhook | null {
        return this.webhooks.find((w) => w.id === id) ?? null;
    }

    /** Internal: enabled webhooks subscribed to this event type. */
    subscribersFor(type: ApiEventType): StoredWebhook[] {
        return this.webhooks.filter((w) => webhookMatches(w, type));
    }


    async create(input: WebhookCreateInput, createdBy: string): Promise<{ webhook: ApiWebhookRecord; secret: string }> {
        const name = input.name.trim();
        if (this.webhooks.some((w) => w.name.toLowerCase() === name.toLowerCase())) {
            throw new WebhookStoreError('duplicate_name', `A webhook named '${name}' already exists.`);
        }
        if (this.webhooks.length >= API_WEBHOOKS_MAX) {
            throw new WebhookStoreError('limit_reached', `At most ${API_WEBHOOKS_MAX} webhooks can be registered.`);
        }
        const events = normalizeEvents(input.events);
        const secret = input.secret?.trim() || genSecret();
        const webhook: StoredWebhook = {
            id: genId(),
            name,
            url: input.url.trim(),
            secret,
            events,
            enabled: true,
            createdBy,
            createdAt: Date.now(),
            deliveredCount: 0,
            failedCount: 0,
            lastDeliveryAt: null,
            lastDeliveryOk: null,
        };
        await this.transact((current) => [...current, webhook]);
        return { webhook: toPublicWebhook(webhook), secret };
    }

    async update(id: string, input: WebhookUpdateInput): Promise<ApiWebhookRecord> {
        if (!this.webhooks.some((w) => w.id === id)) {
            throw new WebhookStoreError('not_found', 'Webhook not found.');
        }
        const events = input.events ? normalizeEvents(input.events) : undefined;
        let updated: StoredWebhook | null = null;
        await this.transact((current) => current.map((w) => {
            if (w.id !== id) return w;
            updated = {
                ...w,
                ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
                ...(events ? { events } : {}),
            };
            return updated;
        }));
        return toPublicWebhook(updated!);
    }

    async remove(id: string): Promise<ApiWebhookRecord | null> {
        const existing = this.webhooks.find((w) => w.id === id);
        if (!existing) return null;
        await this.transact((current) => current.filter((w) => w.id !== id));
        return toPublicWebhook(existing);
    }


    /**
     * Updates delivery counters in memory and schedules a debounced write.
     */
    recordDelivery(id: string, ok: boolean) {
        const webhook = this.webhooks.find((w) => w.id === id);
        if (!webhook) return;
        webhook.lastDeliveryAt = Date.now();
        webhook.lastDeliveryOk = ok;
        if (ok) webhook.deliveredCount++;
        else webhook.failedCount++;
        if (this.statsTimer) return;
        this.statsTimer = setTimeout(() => {
            this.statsTimer = null;
            this.transact((current) => current).catch((error) => {
                console.verbose.warn(`Failed to persist webhook stats: ${(error as Error).message}`);
            });
        }, STATS_WRITE_DEBOUNCE_MS);
        this.statsTimer.unref?.();
    }

    async flush() {
        if (this.statsTimer) {
            clearTimeout(this.statsTimer);
            this.statsTimer = null;
            await this.transact((current) => current);
        }
        await this.writeChain;
    }
}
