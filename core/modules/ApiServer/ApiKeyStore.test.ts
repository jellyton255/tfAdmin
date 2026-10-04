import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import fsp from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ApiKeyStore, { formatToken, hashSecret, parseToken } from './ApiKeyStore';

let tmpDir: string;
let filePath: string;

beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'txapikeys-'));
    filePath = path.join(tmpDir, 'apiKeys.json');
});
afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

const baseInput = { name: 'discord-bot', permissions: ['players.ban', 'players.warn'] };


describe('parseToken', () => {
    it('parses a well-formed token', () => {
        const parsed = parseToken(formatToken('abcdefghijkl', 'S'.repeat(40)));
        expect(parsed).toEqual({ id: 'abcdefghijkl', secret: 'S'.repeat(40) });
    });
    it('rejects garbage', () => {
        expect(parseToken('')).toBeNull();
        expect(parseToken('Bearer x')).toBeNull();
        expect(parseToken('txk_short.short')).toBeNull();
        expect(parseToken('txk_abcdefghijkl')).toBeNull();
        expect(parseToken('x'.repeat(200))).toBeNull();
    });
});


describe('ApiKeyStore', () => {
    it('starts empty when the file does not exist', () => {
        const store = new ApiKeyStore(filePath);
        expect(store.list()).toEqual([]);
        expect(store.activeCount).toBe(0);
    });

    it('creates a key, persists only the hash, and verifies the plaintext token', async () => {
        const store = new ApiKeyStore(filePath);
        const { key, token } = await store.create(baseInput, 'julian');
        expect(token.startsWith(`txk_${key.id}.`)).toBe(true);
        expect((key as any).secretHash).toBeUndefined();
        expect(key.permissions).toEqual(['players.ban', 'players.warn']);
        expect(key.createdBy).toBe('julian');

        const onDisk = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        expect(onDisk.version).toBe(1);
        expect(onDisk.keys).toHaveLength(1);
        expect(onDisk.keys[0].secretHash).toBe(hashSecret(parseToken(token)!.secret));
        expect(JSON.stringify(onDisk)).not.toContain(parseToken(token)!.secret);

        const result = store.verify(token, '203.0.113.9');
        expect(result.success).toBe(true);
        if (result.success) expect(result.key.id).toBe(key.id);
    });

    it('reloads keys from disk', async () => {
        const first = new ApiKeyStore(filePath);
        const { token } = await first.create(baseInput, 'julian');
        const second = new ApiKeyStore(filePath);
        expect(second.list()).toHaveLength(1);
        expect(second.verify(token, '127.0.0.1').success).toBe(true);
    });

    it('rejects bad, unknown, revoked and expired tokens', async () => {
        const store = new ApiKeyStore(filePath);
        const { key, token } = await store.create(baseInput, 'julian');
        const { id, secret } = parseToken(token)!;

        expect(store.verify('nonsense', '1.2.3.4')).toEqual({ success: false, reason: 'malformed' });
        expect(store.verify(formatToken('zzzzzzzzzzzz', secret), '1.2.3.4')).toEqual({ success: false, reason: 'unknown_key' });
        expect(store.verify(formatToken(id, 'X'.repeat(40)), '1.2.3.4')).toEqual({ success: false, reason: 'bad_secret' });

        await store.revoke(key.id, 'julian');
        expect(store.verify(token, '1.2.3.4')).toEqual({ success: false, reason: 'revoked' });
        expect(store.get(key.id)?.revokedBy).toBe('julian');
        expect(store.activeCount).toBe(0);

        const { token: expiring } = await store.create({
            name: 'temp',
            permissions: ['players.kick'],
            expiresAt: Date.now() + 50,
        }, 'julian');
        expect(store.verify(expiring, '1.2.3.4').success).toBe(true);
        await new Promise((r) => setTimeout(r, 60));
        expect(store.verify(expiring, '1.2.3.4')).toEqual({ success: false, reason: 'expired' });
    });

    it('enforces the IP allowlist with plain IPs and CIDRs', async () => {
        const store = new ApiKeyStore(filePath);
        const { token } = await store.create({
            ...baseInput,
            allowedIps: ['203.0.113.5', '10.0.0.0/8'],
        }, 'julian');
        expect(store.verify(token, '203.0.113.5').success).toBe(true);
        expect(store.verify(token, '::ffff:203.0.113.5').success).toBe(true);
        expect(store.verify(token, '10.42.0.1').success).toBe(true);
        expect(store.verify(token, '203.0.113.6')).toEqual({ success: false, reason: 'ip_not_allowed' });
        expect(store.verify(token, 'not-an-ip')).toEqual({ success: false, reason: 'ip_not_allowed' });
    });

    it('collapses all_permissions and rejects duplicate active names', async () => {
        const store = new ApiKeyStore(filePath);
        const { key } = await store.create({ name: 'root', permissions: ['players.ban', 'all_permissions'] }, 'julian');
        expect(key.permissions).toEqual(['all_permissions']);
        await expect(store.create({ name: 'ROOT', permissions: ['players.ban'] }, 'julian'))
            .rejects.toThrow(/already exists/);
        await store.revoke(key.id, 'julian');
        await expect(store.create({ name: 'root', permissions: ['players.ban'] }, 'julian')).resolves.toBeTruthy();
    });

    it('validates input', async () => {
        const store = new ApiKeyStore(filePath);
        await expect(store.create({ name: '', permissions: ['x'] }, 'j')).rejects.toThrow();
        await expect(store.create({ name: 'bad<name>', permissions: ['x'] }, 'j')).rejects.toThrow();
        const readOnly = await store.create({ name: 'reader', permissions: [] }, 'j');
        expect(readOnly.key.permissions).toEqual([]);
        await expect(store.create({ name: 'ok', permissions: ['x'], expiresAt: Date.now() - 1 }, 'j')).rejects.toThrow(/future/);
    });

    it('persists lastUsedAt on flush', async () => {
        const store = new ApiKeyStore(filePath);
        const { key, token } = await store.create(baseInput, 'julian');
        expect(store.get(key.id)?.lastUsedAt).toBeNull();
        store.verify(token, '1.2.3.4');
        expect(store.get(key.id)?.lastUsedAt).toBeTypeOf('number');
        await store.flush();
        const reloaded = new ApiKeyStore(filePath);
        expect(reloaded.get(key.id)?.lastUsedAt).toBeTypeOf('number');
    });

    it('leaves memory untouched when the write fails', async () => {
        const store = new ApiKeyStore(filePath);
        const { key, token } = await store.create(baseInput, 'julian');
        const spy = vi.spyOn(fsp, 'writeFile').mockRejectedValueOnce(new Error('disk full'));

        await expect(store.create({ name: 'second', permissions: ['players.kick'] }, 'julian')).rejects.toThrow('disk full');
        expect(store.list()).toHaveLength(1);
        //a retry with the same name is not blocked by a phantom record
        spy.mockRejectedValueOnce(new Error('disk full'));
        await expect(store.revoke(key.id, 'julian')).rejects.toThrow('disk full');
        expect(store.get(key.id)?.revokedAt).toBeNull();
        expect(store.verify(token, '1.2.3.4').success).toBe(true);
        spy.mockRestore();

        //writes work again afterwards and the chain is not stuck
        await expect(store.create({ name: 'second', permissions: ['players.kick'] }, 'julian')).resolves.toBeTruthy();
        expect(store.list()).toHaveLength(2);
        expect(fs.readdirSync(tmpDir)).toEqual(['apiKeys.json']);
    });

    it('serializes concurrent writes', async () => {
        const store = new ApiKeyStore(filePath);
        await Promise.all([
            store.create({ name: 'a', permissions: ['players.kick'] }, 'j'),
            store.create({ name: 'b', permissions: ['players.kick'] }, 'j'),
            store.create({ name: 'c', permissions: ['players.kick'] }, 'j'),
        ]);
        expect(store.list().map((k) => k.name).sort()).toEqual(['a', 'b', 'c']);
        expect(new ApiKeyStore(filePath).list()).toHaveLength(3);
    });

    it('refuses a corrupt file', () => {
        fs.writeFileSync(filePath, '{"version": 1, "keys": [{"id": 1}]}');
        expect(() => new ApiKeyStore(filePath)).toThrow(/Invalid API keys file/);
    });
});
