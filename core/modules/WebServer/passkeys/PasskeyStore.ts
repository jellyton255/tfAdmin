const modulename = 'WebServer:PasskeyStore';
import fs from 'node:fs';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { LRUCacheWithDelete } from 'mnemonist';
import consoleFactory from '@lib/console';
import type { PasskeyInfo } from '@shared/authApiTypes';
import { getPasskeyProvider } from './providers';
const console = consoleFactory(modulename);

const FILE_SCHEMA_VERSION = 1;
const LOGIN_CHALLENGE_TTL_MS = 5 * 60_000;
const NAME_MAX_LENGTH = 48;

const storedPasskeySchema = z.object({
    id: z.string().min(1), //base64url credential id
    admin: z.string().min(1), //lowercased admin name
    publicKey: z.string().min(1), //base64url COSE key
    counter: z.number().int().nonnegative(),
    transports: z.array(z.string()),
    deviceType: z.enum(['singleDevice', 'multiDevice']),
    backedUp: z.boolean(),
    aaguid: z.string(),
    rpId: z.string().min(1),
    name: z.string().min(1).max(NAME_MAX_LENGTH),
    createdAt: z.number().int(),
    lastUsedAt: z.number().int().nullable(),
});
export type StoredPasskey = z.infer<typeof storedPasskeySchema>;

const storeFileSchema = z.object({
    version: z.literal(FILE_SCHEMA_VERSION),
    userHandles: z.record(z.string(), z.string()), //lowercased admin name → base64url handle
    passkeys: z.array(storedPasskeySchema),
});
type StoreFile = z.infer<typeof storeFileSchema>;

export const passkeyNameSchema = z.string().trim().min(1).max(NAME_MAX_LENGTH);

/**
 * Picks a readable default name for a new passkey.
 */
export const defaultPasskeyName = (aaguid: string, deviceType: StoredPasskey['deviceType'], transports: string[]) => {
    const provider = getPasskeyProvider(aaguid);
    if (provider) return provider.name;
    if (deviceType === 'singleDevice' && transports.some((t) => t === 'usb' || t === 'nfc')) {
        return 'Security Key';
    }
    return 'Passkey';
};

const toInfo = (passkey: StoredPasskey): PasskeyInfo => ({
    id: passkey.id,
    name: passkey.name,
    rpId: passkey.rpId,
    synced: passkey.backedUp,
    provider: getPasskeyProvider(passkey.aaguid),
    createdAt: passkey.createdAt,
    lastUsedAt: passkey.lastUsedAt,
});


/**
 * Stores the admins' passkeys in txData/passkeys.json, and the one-time login challenges in memory.
 */
export default class PasskeyStore {
    private readonly filePath: string;
    private data: StoreFile = { version: FILE_SCHEMA_VERSION, userHandles: {}, passkeys: [] };
    private readonly loginChallenges = new LRUCacheWithDelete<string, number>(1000);

    constructor(filePath: string) {
        this.filePath = filePath;
        this.loadSync();
    }

    /**
     * Loads the passkeys file, tolerating a missing file (first run).
     */
    private loadSync() {
        let raw: string;
        try {
            raw = fs.readFileSync(this.filePath, 'utf8');
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
            throw new Error(`Failed to read passkeys file: ${(error as Error).message}`);
        }
        const validated = storeFileSchema.safeParse(JSON.parse(raw));
        if (!validated.success) {
            throw new Error(`Invalid passkeys file (${this.filePath}): ${validated.error.issues[0]?.message ?? 'unknown error'}`);
        }
        this.data = validated.data;
        console.verbose.ok(`Loaded ${this.data.passkeys.length} passkey(s).`);
    }

    /**
     * Applies a change and writes it atomically (temp file + rename).
     * If the write fails the in-memory state is left untouched.
     */
    private commit(next: StoreFile) {
        const tmpPath = `${this.filePath}.${process.pid}.tmp`;
        try {
            fs.writeFileSync(tmpPath, JSON.stringify(next, null, 2), { encoding: 'utf8', mode: 0o600 });
            fs.renameSync(tmpPath, this.filePath);
        } catch (error) {
            fs.rmSync(tmpPath, { force: true });
            throw new Error(`Failed to save passkeys file: ${(error as Error).message}`);
        }
        this.data = next;
    }


    /**
     * Remembers a login challenge so it can be used exactly once.
     */
    issueLoginChallenge(challenge: string) {
        this.loginChallenges.set(challenge, Date.now() + LOGIN_CHALLENGE_TTL_MS);
    }

    /**
     * Consumes a login challenge, returning whether it was issued and is still fresh.
     */
    consumeLoginChallenge(challenge: string) {
        const expires = this.loginChallenges.get(challenge);
        if (expires === undefined) return false;
        this.loginChallenges.delete(challenge);
        return expires > Date.now();
    }


    /**
     * Returns the admin's WebAuthn user handle, creating it on first use.
     */
    getOrCreateUserHandle(adminName: string) {
        const admin = adminName.toLowerCase();
        const existing = this.data.userHandles[admin];
        if (existing) return existing;
        const handle = randomBytes(32).toString('base64url');
        this.commit({ ...this.data, userHandles: { ...this.data.userHandles, [admin]: handle } });
        return handle;
    }

    getUserHandle(adminName: string): string | undefined {
        return this.data.userHandles[adminName.toLowerCase()];
    }

    getById(id: string) {
        return this.data.passkeys.find((p) => p.id === id);
    }

    ownsPasskey(adminName: string, id: string) {
        return this.getById(id)?.admin === adminName.toLowerCase();
    }

    listRaw(adminName: string) {
        const admin = adminName.toLowerCase();
        return this.data.passkeys.filter((p) => p.admin === admin);
    }

    list(adminName: string) {
        return this.listRaw(adminName)
            .map(toInfo)
            .sort((a, b) => b.createdAt - a.createdAt);
    }

    countByAdmin() {
        const counts = new Map<string, number>();
        for (const passkey of this.data.passkeys) {
            counts.set(passkey.admin, (counts.get(passkey.admin) ?? 0) + 1);
        }
        return counts;
    }

    add(passkey: Omit<StoredPasskey, 'createdAt' | 'lastUsedAt'>) {
        if (this.getById(passkey.id)) throw new Error('This passkey is already registered.');
        const stored = storedPasskeySchema.parse({
            ...passkey,
            admin: passkey.admin.toLowerCase(),
            createdAt: Date.now(),
            lastUsedAt: null,
        });
        this.commit({ ...this.data, passkeys: [...this.data.passkeys, stored] });
        return toInfo(stored);
    }

    recordUse(id: string, counter: number) {
        this.commit({
            ...this.data,
            passkeys: this.data.passkeys.map((p) => p.id === id ? { ...p, counter, lastUsedAt: Date.now() } : p),
        });
    }

    rename(adminName: string, id: string, name: string) {
        if (!this.ownsPasskey(adminName, id)) return false;
        this.commit({
            ...this.data,
            passkeys: this.data.passkeys.map((p) => p.id === id ? { ...p, name } : p),
        });
        return true;
    }

    remove(adminName: string, id: string) {
        if (!this.ownsPasskey(adminName, id)) return false;
        this.commit({ ...this.data, passkeys: this.data.passkeys.filter((p) => p.id !== id) });
        return true;
    }

    /**
     * Removes every passkey and the user handle of an admin.
     * Returns how many passkeys were removed.
     */
    removeAllForAdmin(adminName: string) {
        const admin = adminName.toLowerCase();
        const remaining = this.data.passkeys.filter((p) => p.admin !== admin);
        const removed = this.data.passkeys.length - remaining.length;
        if (!removed && !this.data.userHandles[admin]) return 0;
        const { [admin]: _dropped, ...userHandles } = this.data.userHandles;
        this.commit({ ...this.data, userHandles, passkeys: remaining });
        return removed;
    }
}
