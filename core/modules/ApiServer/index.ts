const modulename = 'ApiServer';
import consoleFactory from '@lib/console';
import ApiKeyStore, { ApiKeyStoreError, type ApiKeyCreateInput } from './ApiKeyStore';
import ApiRateLimiter from './rateLimiter';
import ApiEventBus from './events';
import WebhookStore, { WebhookStoreError, type WebhookCreateInput, type WebhookUpdateInput } from './WebhookStore';
import WebhookDispatcher, { type DispatcherOptions } from './dispatcher';
import type { ApiEventType } from '@shared/apiV1Types';
import { ApiError } from './envelope';
import { invalidIpEntries } from './ipAllowlist';
import type { AuthedAdminType } from '@modules/WebServer/authLogic';
const console = consoleFactory(modulename);


/**
 * Module that owns the public API (/api/v1): key storage, per-key rate limiting
 * and the rules for who can issue which keys.
 * The HTTP routes themselves live in core/routes/api/v1 and are mounted by WebServer/router.ts.
 */
export type ApiServerOptions = {
    keysFilePath?: string;
    webhooksFilePath?: string;
    dispatcher?: DispatcherOptions;
};

export default class ApiServer {
    public readonly keyStore: ApiKeyStore;
    public readonly rateLimiter: ApiRateLimiter;
    public readonly events: ApiEventBus;
    public readonly webhookStore: WebhookStore;
    public readonly dispatcher: WebhookDispatcher;

    constructor(options: ApiServerOptions = {}) {
        this.keyStore = new ApiKeyStore(options.keysFilePath);
        this.rateLimiter = new ApiRateLimiter();
        this.events = new ApiEventBus();
        this.webhookStore = new WebhookStore(options.webhooksFilePath);
        this.dispatcher = new WebhookDispatcher(this.webhookStore, this.events, options.dispatcher);
        if (this.keyStore.activeCount) {
            console.ok(`Public API enabled with ${this.keyStore.activeCount} active key(s) and ${this.webhookStore.activeCount} webhook(s).`);
        }
    }

    public handleShutdown() {
        this.dispatcher.destroy();
        this.keyStore.flush().catch(() => { });
        this.webhookStore.flush().catch(() => { });
        this.rateLimiter.destroy();
    }


    /**
     * Sink for FxRunner.sendEvent and the lifecycle hooks: publishes the event to the ring buffer
     * and the webhooks. Never throws, so a bad listener can't break the in-game broadcast.
     */
    public publishServerEvent(eventType: string, data?: unknown) {
        try {
            this.events.publishServerEvent(eventType, data);
        } catch (error) {
            console.verbose.warn(`Failed to publish ${eventType}: ${(error as Error).message}`);
        }
    }

    /**
     * Publishes an event that is already in the API catalogue (player.joined, server.online...).
     */
    public publishEvent(type: ApiEventType, data: Record<string, unknown> = {}) {
        try {
            this.events.emit(type, data);
        } catch (error) {
            console.verbose.warn(`Failed to publish ${type}: ${(error as Error).message}`);
        }
    }


    /**
     * Webhook management on behalf of an admin (panel and /api/v1/webhooks share these).
     */
    public async createWebhook(admin: AuthedAdminType, input: WebhookCreateInput) {
        let result;
        try {
            result = await this.webhookStore.create(input, admin.name);
        } catch (error) {
            throw mapWebhookError(error);
        }
        admin.logAction(`Created webhook '${result.webhook.name}' (${result.webhook.id}) for ${result.webhook.events.join(', ')} -> ${result.webhook.url}`);
        return result;
    }

    public async updateWebhook(admin: AuthedAdminType, id: string, input: WebhookUpdateInput) {
        let webhook;
        try {
            webhook = await this.webhookStore.update(id, input);
        } catch (error) {
            throw mapWebhookError(error);
        }
        admin.logAction(`Updated webhook '${webhook.name}' (${webhook.id}): ${JSON.stringify(input)}`);
        return webhook;
    }

    public async removeWebhook(admin: AuthedAdminType, id: string) {
        const removed = await this.webhookStore.remove(id);
        if (!removed) {
            throw new ApiError(404, 'NOT_FOUND', 'Webhook not found.');
        }
        this.dispatcher.forget(id);
        admin.logAction(`Deleted webhook '${removed.name}' (${removed.id})`);
        return removed;
    }

    /**
     * Sends a `webhook.test` event to one webhook and waits for the first attempt to settle.
     */
    public async testWebhook(admin: AuthedAdminType, id: string) {
        if (!this.webhookStore.get(id)) {
            throw new ApiError(404, 'NOT_FOUND', 'Webhook not found.');
        }
        const event = this.events.emit('webhook.test', { webhookId: id, requestedBy: admin.name });
        const delivery = this.dispatcher.listDeliveries(id).find((d) => d.eventId === event.id);
        if (!delivery) {
            throw new ApiError(500, 'INTERNAL_ERROR', 'Test delivery was not created.');
        }
        return (await this.dispatcher.waitFor(delivery.id)) ?? delivery;
    }


    /**
     * Validates a create-key request against the issuing admin:
     * - every permission must be a registered txAdmin permission
     * - the issuer must hold every permission being granted (no privilege escalation)
     * - allowedIps entries must be valid IPs/CIDRs
     * Throws ApiError on failure.
     */
    public assertCanGrant(admin: AuthedAdminType, input: ApiKeyCreateInput) {
        const registered = txCore.adminStore.getPermissionsList() as Record<string, string>;
        const unknown = input.permissions.filter((p) => !(p in registered));
        if (unknown.length) {
            throw new ApiError(400, 'VALIDATION_ERROR', 'Unknown permission(s).', { permissions: unknown });
        }
        const notHeld = input.permissions.filter((p) => !admin.hasPermission(p));
        if (notHeld.length) {
            throw new ApiError(403, 'FORBIDDEN', 'You cannot grant permissions you do not hold.', { permissions: notHeld });
        }
        if (input.allowedIps?.length) {
            const invalid = invalidIpEntries(input.allowedIps);
            if (invalid.length) {
                throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid IP or CIDR entries.', { allowedIps: invalid });
            }
        }
    }


    /**
     * Creates a key on behalf of an admin, with the escalation check and action log.
     */
    public async createKey(admin: AuthedAdminType, input: ApiKeyCreateInput) {
        this.assertCanGrant(admin, input);
        let result;
        try {
            result = await this.keyStore.create(input, admin.name);
        } catch (error) {
            if (error instanceof ApiKeyStoreError) {
                if (error.code === 'duplicate_name') {
                    throw new ApiError(409, 'CONFLICT', error.message);
                }
                throw new ApiError(400, 'VALIDATION_ERROR', error.message);
            }
            throw error; //disk errors etc. reach the 500 handler
        }
        admin.logAction(`Created API key '${result.key.name}' (${result.key.id}) with permissions: ${result.key.permissions.join(', ')}`);
        return result;
    }


    /**
     * Revokes a key on behalf of an admin, with the action log.
     */
    public async revokeKey(admin: AuthedAdminType, id: string) {
        const existing = this.keyStore.get(id);
        if (!existing) {
            throw new ApiError(404, 'NOT_FOUND', 'API key not found.');
        }
        const key = await this.keyStore.revoke(id, admin.name);
        if (!existing.revokedAt) {
            admin.logAction(`Revoked API key '${existing.name}' (${existing.id})`);
        }
        return key!;
    }
}


const mapWebhookError = (error: unknown) => {
    if (error instanceof WebhookStoreError) {
        if (error.code === 'duplicate_name') return new ApiError(409, 'CONFLICT', error.message);
        if (error.code === 'limit_reached') return new ApiError(409, 'CONFLICT', error.message);
        if (error.code === 'not_found') return new ApiError(404, 'NOT_FOUND', error.message);
        return new ApiError(400, 'VALIDATION_ERROR', error.message, error.details);
    }
    return error;
};
