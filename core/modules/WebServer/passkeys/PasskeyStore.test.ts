import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PasskeyStore, { defaultPasskeyName } from './PasskeyStore';
import { resolveRelyingParty } from './relyingParty';
import { normalAuthLogic } from '../authLogic';

let tmpDir: string;
let filePath: string;

beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'txpasskeys-'));
    filePath = path.join(tmpDir, 'passkeys.json');
});
afterEach(() => {
    vi.unstubAllGlobals();
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

const addPasskey = (store: PasskeyStore, id: string, admin = 'Julian') => store.add({
    id,
    admin,
    publicKey: 'cHVibGlj',
    counter: 0,
    transports: ['internal', 'hybrid'],
    deviceType: 'multiDevice',
    backedUp: true,
    aaguid: 'fbfc3007-154e-4ecc-8c0b-6e020557d7bd',
    rpId: 'txdev2.everfall.net',
    name: 'iCloud Keychain',
});


describe('PasskeyStore', () => {
    it('persists passkeys and user handles across instances', () => {
        const store = new PasskeyStore(filePath);
        const handle = store.getOrCreateUserHandle('Julian');
        addPasskey(store, 'cred1');

        const reloaded = new PasskeyStore(filePath);
        expect(reloaded.getOrCreateUserHandle('julian')).toBe(handle);
        expect(reloaded.list('JULIAN').map((p) => p.id)).toEqual(['cred1']);
        const provider = reloaded.list('julian')[0]?.provider;
        expect(provider?.name).toBe('Apple Passwords');
        expect(provider?.iconLight).toMatch(/^data:image\/svg\+xml;base64,/);
        expect(fs.statSync(filePath).mode & 0o777).toBe(0o600);
    });

    it('only lets the owner rename or remove a passkey', () => {
        const store = new PasskeyStore(filePath);
        addPasskey(store, 'cred1');
        expect(store.rename('someone', 'cred1', 'Stolen')).toBe(false);
        expect(store.remove('someone', 'cred1')).toBe(false);
        expect(store.rename('julian', 'cred1', 'Phone')).toBe(true);
        expect(store.list('julian')[0]?.name).toBe('Phone');
        expect(store.remove('julian', 'cred1')).toBe(true);
        expect(store.list('julian')).toEqual([]);
    });

    it('rejects a credential registered twice', () => {
        const store = new PasskeyStore(filePath);
        addPasskey(store, 'cred1');
        expect(() => addPasskey(store, 'cred1', 'other')).toThrow();
    });

    it('forgets every passkey and the user handle of a deleted admin', () => {
        const store = new PasskeyStore(filePath);
        const handle = store.getOrCreateUserHandle('julian');
        addPasskey(store, 'cred1');
        addPasskey(store, 'cred2');
        addPasskey(store, 'cred3', 'other');

        expect(store.removeAllForAdmin('Julian')).toBe(2);
        expect(store.getById('cred3')).toBeDefined();
        expect(store.getOrCreateUserHandle('julian')).not.toBe(handle);
    });

    it('accepts each login challenge once and only while fresh', () => {
        vi.useFakeTimers();
        try {
            const store = new PasskeyStore(filePath);
            store.issueLoginChallenge('a');
            expect(store.consumeLoginChallenge('a')).toBe(true);
            expect(store.consumeLoginChallenge('a')).toBe(false);
            expect(store.consumeLoginChallenge('never-issued')).toBe(false);

            store.issueLoginChallenge('b');
            vi.setSystemTime(Date.now() + 6 * 60_000);
            expect(store.consumeLoginChallenge('b')).toBe(false);
        } finally {
            vi.useRealTimers();
        }
    });

    it('names passkeys after known providers', () => {
        expect(defaultPasskeyName('fbfc3007-154e-4ecc-8c0b-6e020557d7bd', 'multiDevice', [])).toBe('Apple Passwords');
        expect(defaultPasskeyName('EA9B8D66-4D01-1D21-3CE4-B6B48CB575D4', 'multiDevice', [])).toBe('Google Password Manager');
        expect(defaultPasskeyName('00000000-0000-0000-0000-000000000000', 'singleDevice', ['usb'])).toBe('Security Key');
        expect(defaultPasskeyName('00000000-0000-0000-0000-000000000000', 'multiDevice', ['hybrid'])).toBe('Passkey');
    });
});


describe('resolveRelyingParty', () => {
    it('uses the origin hostname as the relying party', () => {
        expect(resolveRelyingParty('https://txdev2.everfall.net')).toEqual({
            origin: 'https://txdev2.everfall.net',
            rpID: 'txdev2.everfall.net',
        });
        expect(resolveRelyingParty('http://localhost:40120')?.rpID).toBe('localhost');
    });
    it('rejects insecure origins and IP addresses', () => {
        expect(resolveRelyingParty('http://txdev2.everfall.net')).toBeUndefined();
        expect(resolveRelyingParty('https://1.2.3.4:40120')).toBeUndefined();
        expect(resolveRelyingParty('https://[::1]')).toBeUndefined();
        expect(resolveRelyingParty('null')).toBeUndefined();
        expect(resolveRelyingParty(undefined)).toBeUndefined();
    });
});


describe('passkey sessions', () => {
    it('end when their passkey is removed', () => {
        const store = new PasskeyStore(filePath);
        addPasskey(store, 'cred1');
        vi.stubGlobal('txCore', {
            webServer: { passkeyStore: store },
            adminStore: { getAdminByName: () => ({ name: 'Julian', master: true, permissions: [] }) },
            cacheStore: { get: () => undefined },
        });
        const sessTools = {
            get: () => ({
                auth: { type: 'passkey', username: 'Julian', csrfToken: 'x', expiresAt: false, credentialId: 'cred1' },
            }),
            set: () => { },
            destroy: () => { },
        } as const;

        expect(normalAuthLogic(sessTools).success).toBe(true);
        store.remove('julian', 'cred1');
        expect(normalAuthLogic(sessTools).success).toBe(false);
    });
});
