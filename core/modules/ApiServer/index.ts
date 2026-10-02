const modulename = 'ApiServer';
import consoleFactory from '@lib/console';
import ApiKeyStore, { type ApiKeyCreateInput } from './ApiKeyStore';
import ApiRateLimiter from './rateLimiter';
import { ApiError } from './envelope';
import { invalidIpEntries } from './ipAllowlist';
import type { AuthedAdminType } from '@modules/WebServer/authLogic';
const console = consoleFactory(modulename);


/**
 * Module that owns the public API (/api/v1): key storage, per-key rate limiting
 * and the rules for who can issue which keys.
 * The HTTP routes themselves live in core/routes/api/v1 and are mounted by WebServer/router.ts.
 */
export default class ApiServer {
    public readonly keyStore: ApiKeyStore;
    public readonly rateLimiter: ApiRateLimiter;

    constructor(keysFilePath?: string) {
        this.keyStore = new ApiKeyStore(keysFilePath);
        this.rateLimiter = new ApiRateLimiter();
        if (this.keyStore.activeCount) {
            console.ok(`Public API enabled with ${this.keyStore.activeCount} active key(s).`);
        }
    }

    public handleShutdown() {
        this.keyStore.flush().catch(() => { });
        this.rateLimiter.destroy();
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
            throw new ApiError(409, 'CONFLICT', (error as Error).message);
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
