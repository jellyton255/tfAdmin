const modulename = 'WebServer:PasskeyStore';
import fs from 'node:fs';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { LRUCacheWithDelete } from 'mnemonist';
import consoleFactory from '@lib/console';
import type { PasskeyInfo } from '@shared/authApiTypes';
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
 * Well-known passkey providers, by authenticator AAGUID, used to name new passkeys.
 */
const knownProviders: Record<string, string> = {
    'ea9b8d66-4d01-1d21-3ce4-b6b48cb575d4': 'Google Password Manager',
    'adce0002-35bc-c60a-648b-0b25f1f05503': 'Chrome on Mac',
    'fbfc3007-154e-4ecc-8c0b-6e020557d7bd': 'iCloud Keychain',
    'dd4ec289-e01d-41c9-bb89-70fa845d4bf2': 'iCloud Keychain',
    '08987058-cadc-4b81-b6e1-30de50dcbe96': 'Windows Hello',
    '9ddd1817-af5a-4672-a2b9-3e3dd95000a9': 'Windows Hello',
    '6028b017-b1d4-4c02-b4b3-afcdafc96bb2': 'Windows Hello',
    'bada5566-a7aa-401f-bd96-45619a55120d': '1Password',
    'd548826e-79b4-db40-a3d8-11116f7e8349': 'Bitwarden',
    '531126d6-e717-415c-9320-3d9aa6981239': 'Dashlane',
    '50726f74-6f6e-5061-7373-50726f746f6e': 'Proton Pass',
};

/**
 * Picks a readable default name for a new passkey.
 */
export const defaultPasskeyName = (aaguid: string, deviceType: StoredPasskey['deviceType'], transports: string[]) => {
    const provider = knownProviders[aaguid];
    if (provider) return provider;
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
