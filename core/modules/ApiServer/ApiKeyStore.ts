const modulename = 'ApiServer:KeyStore';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { createHash, timingSafeEqual } from 'node:crypto';
import { customAlphabet } from 'nanoid';
import dict49 from 'nanoid-dictionary/nolookalikes';
import { z } from 'zod';
import { txHostConfig } from '@core/globalData';
import consoleFactory from '@lib/console';
import { isIpAllowed } from './ipAllowlist';
import {
    API_KEY_ALLOWED_IPS_MAX,
    API_KEY_NAME_MAX_LENGTH,
    API_KEY_PREFIX,
    type ApiKeyPublicRecord,
} from '@shared/apiV1Types';
const console = consoleFactory(modulename);

const genKeyId = customAlphabet(dict49, 12);
const genSecret = customAlphabet(dict49, 40);
const FILE_SCHEMA_VERSION = 1;
const LAST_USED_WRITE_DEBOUNCE_MS = 30_000;


/**
 * Schemas
 */
const storedKeySchema = z.object({
    id: z.string().min(8),
    name: z.string().min(1).max(API_KEY_NAME_MAX_LENGTH),
    secretHash: z.string().length(64), //sha256 hex
    permissions: z.array(z.string()),
    createdBy: z.string(),
    createdAt: z.number().int(),
    lastUsedAt: z.number().int().nullable(),
    expiresAt: z.number().int().nullable(),
    allowedIps: z.array(z.string()).max(API_KEY_ALLOWED_IPS_MAX),
    revokedAt: z.number().int().nullable(),
    revokedBy: z.string().nullable(),
});
export type StoredApiKey = z.infer<typeof storedKeySchema>;

const storeFileSchema = z.object({
    version: z.literal(FILE_SCHEMA_VERSION),
    keys: z.array(storedKeySchema),
});

export const apiKeyCreateSchema = z.object({
    name: z.string().trim().min(1).max(API_KEY_NAME_MAX_LENGTH)
        .regex(/^[a-zA-Z0-9 _.-]+$/, 'name may only contain letters, numbers, spaces and _.-'),
    permissions: z.array(z.string().min(1)).min(1, 'at least one permission is required'),
    expiresAt: z.number().int().positive().nullable().optional(),
    allowedIps: z.array(z.string().trim().min(1)).max(API_KEY_ALLOWED_IPS_MAX).optional(),
});
export type ApiKeyCreateInput = z.infer<typeof apiKeyCreateSchema>;


/**
 * Result of verifying a bearer token
 */
export type ApiKeyVerifyResult = {
    success: true;
    key: StoredApiKey;
} | {
    success: false;
    reason: 'malformed' | 'unknown_key' | 'bad_secret' | 'revoked' | 'expired' | 'ip_not_allowed';
};


/**
 * Helpers
 */
export const hashSecret = (secret: string) => createHash('sha256').update(secret).digest('hex');

export const formatToken = (id: string, secret: string) => `${API_KEY_PREFIX}_${id}.${secret}`;

/**
 * Parses `txk_<id>.<secret>` into its parts, or returns null.
 */
export const parseToken = (token: string): { id: string; secret: string } | null => {
    if (typeof token !== 'string' || token.length > 128) return null;
    const match = /^txk_([A-Za-z0-9_-]{8,32})\.([A-Za-z0-9_-]{20,64})$/.exec(token);
    if (!match) return null;
    return { id: match[1], secret: match[2] };
};

export const toPublicRecord = (key: StoredApiKey): ApiKeyPublicRecord => {
    const { secretHash: _hash, ...rest } = key;
    return rest;
};


/**
 * Stores, loads and verifies the API keys (txData/apiKeys.json).
 * Secrets are stored as sha256 hashes; the plaintext is returned once on creation.
 */
export default class ApiKeyStore {
    private readonly filePath: string;
    private keys: StoredApiKey[] = [];
    private lastUsedDirty = new Set<string>();
    private lastUsedTimer: NodeJS.Timeout | null = null;

    constructor(filePath?: string) {
        this.filePath = filePath ?? txHostConfig.dataSubPath('apiKeys.json');
        this.loadSync();
    }


    /**
     * Loads the keys file, tolerating a missing file (first run).
     */
    private loadSync() {
        let raw: string;
        try {
            raw = fs.readFileSync(this.filePath, 'utf8');
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
                this.keys = [];
                return;
            }
            throw new Error(`Failed to read API keys file: ${(error as Error).message}`);
        }

        let parsed: unknown;
        try {
            parsed = JSON.parse(raw);
        } catch (error) {
            throw new Error(`Failed to parse API keys file (${this.filePath}): ${(error as Error).message}`);
        }
        const validated = storeFileSchema.safeParse(parsed);
        if (!validated.success) {
            throw new Error(`Invalid API keys file (${this.filePath}): ${validated.error.issues[0]?.message ?? 'unknown error'}`);
        }
        this.keys = validated.data.keys;
        console.verbose.ok(`Loaded ${this.keys.length} API key(s).`);
    }


    /**
     * Persists the keys file.
     */
    private async write() {
        const payload = JSON.stringify({ version: FILE_SCHEMA_VERSION, keys: this.keys }, null, 2);
        await fsp.writeFile(this.filePath, payload, 'utf8');
    }


    /**
     * Returns all keys without their hashes, newest first.
     */
    list(): ApiKeyPublicRecord[] {
        return [...this.keys]
            .sort((a, b) => b.createdAt - a.createdAt)
            .map(toPublicRecord);
    }

    get(id: string): ApiKeyPublicRecord | null {
        const key = this.keys.find((k) => k.id === id);
        return key ? toPublicRecord(key) : null;
    }

    get activeCount() {
        const now = Date.now();
        return this.keys.filter((k) => !k.revokedAt && (!k.expiresAt || k.expiresAt > now)).length;
    }


    /**
     * Creates a new key. The caller is responsible for checking that `createdBy` holds every
     * permission being granted (see ApiServer.assertCanGrant).
     * Returns the record plus the plaintext token, which is never stored.
     */
    async create(input: ApiKeyCreateInput, createdBy: string) {
        const validated = apiKeyCreateSchema.parse(input);
        if (validated.expiresAt && validated.expiresAt <= Date.now()) {
            throw new Error('expiresAt must be in the future');
        }
        if (this.keys.some((k) => !k.revokedAt && k.name.toLowerCase() === validated.name.toLowerCase())) {
            throw new Error(`An active key named '${validated.name}' already exists.`);
        }

        //Dedupe permissions, collapse all_permissions
        let permissions = [...new Set(validated.permissions)];
        if (permissions.includes('all_permissions')) permissions = ['all_permissions'];

        //Generate a unique id
        let id = genKeyId();
        while (this.keys.some((k) => k.id === id)) id = genKeyId();
        const secret = genSecret();

        const record: StoredApiKey = {
            id,
            name: validated.name,
            secretHash: hashSecret(secret),
            permissions,
            createdBy,
            createdAt: Date.now(),
            lastUsedAt: null,
            expiresAt: validated.expiresAt ?? null,
            allowedIps: validated.allowedIps ?? [],
            revokedAt: null,
            revokedBy: null,
        };
        this.keys.push(record);
        await this.write();

        return {
            key: toPublicRecord(record),
            token: formatToken(id, secret),
        };
    }


    /**
     * Revokes a key (soft delete, kept for audit).
     */
    async revoke(id: string, revokedBy: string): Promise<ApiKeyPublicRecord | null> {
        const key = this.keys.find((k) => k.id === id);
        if (!key) return null;
        if (!key.revokedAt) {
            key.revokedAt = Date.now();
            key.revokedBy = revokedBy;
            await this.write();
        }
        return toPublicRecord(key);
    }


    /**
     * Verifies a bearer token against the store.
     * Does a constant-time compare of the secret hash so timing doesn't leak the hash.
     */
    verify(token: string, remoteIp: string): ApiKeyVerifyResult {
        const parsed = parseToken(token);
        if (!parsed) return { success: false, reason: 'malformed' };

        const key = this.keys.find((k) => k.id === parsed.id);
        if (!key) return { success: false, reason: 'unknown_key' };

        const given = Buffer.from(hashSecret(parsed.secret), 'hex');
        const stored = Buffer.from(key.secretHash, 'hex');
        if (given.length !== stored.length || !timingSafeEqual(given, stored)) {
            return { success: false, reason: 'bad_secret' };
        }

        if (key.revokedAt) return { success: false, reason: 'revoked' };
        if (key.expiresAt && key.expiresAt <= Date.now()) return { success: false, reason: 'expired' };
        if (key.allowedIps.length && !isIpAllowed(remoteIp, key.allowedIps)) {
            return { success: false, reason: 'ip_not_allowed' };
        }

        this.touch(key);
        return { success: true, key };
    }


    /**
     * Updates lastUsedAt in memory and schedules a debounced write.
     */
    private touch(key: StoredApiKey) {
        key.lastUsedAt = Date.now();
        this.lastUsedDirty.add(key.id);
        if (this.lastUsedTimer) return;
        this.lastUsedTimer = setTimeout(() => {
            this.lastUsedTimer = null;
            this.lastUsedDirty.clear();
            this.write().catch((error) => {
                console.verbose.warn(`Failed to persist lastUsedAt: ${(error as Error).message}`);
            });
        }, LAST_USED_WRITE_DEBOUNCE_MS);
        this.lastUsedTimer.unref?.();
    }


    /**
     * Flushes any pending writes (used on shutdown and in tests).
     */
    async flush() {
        if (this.lastUsedTimer) {
            clearTimeout(this.lastUsedTimer);
            this.lastUsedTimer = null;
        }
        if (this.lastUsedDirty.size) {
            this.lastUsedDirty.clear();
            await this.write();
        }
    }
}
