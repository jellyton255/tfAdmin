import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionMemoryStorage } from './sessionMws';

let tmpDir: string;
let filePath: string;

beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'txsessions-'));
    filePath = path.join(tmpDir, 'panelSessions.json');
});
afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

const sessId = '0b8f6f0e-6a55-4c39-9a0b-5f4b8d9d1c11';
const auth = {
    type: 'password',
    username: 'julian',
    csrfToken: 'csrf',
    expiresAt: false,
    password_hash: 'hash',
} as const;


describe('SessionMemoryStorage persistence', () => {
    it('keeps a signed-in session across a restart without storing the raw id', () => {
        const store = new SessionMemoryStorage(undefined, filePath);
        store.set(sessId, { auth });
        store.flush();

        expect(fs.readFileSync(filePath, 'utf8')).not.toContain(sessId);
        expect(new SessionMemoryStorage(undefined, filePath).get(sessId)).toEqual({ auth });
    });

    it('does not keep unauthenticated OAuth state', () => {
        const store = new SessionMemoryStorage(undefined, filePath);
        store.set(sessId, { auth });
        store.set('11111111-2222-3333-4444-555555555555', { tmpOauthLoginStateKern: 'x' });
        store.flush();

        expect(new SessionMemoryStorage(undefined, filePath).size).toBe(1);
    });

    it('drops sessions that expired while tfAdmin was down', () => {
        vi.useFakeTimers();
        try {
            const store = new SessionMemoryStorage(60_000, filePath);
            store.set(sessId, { auth });
            store.flush();
            vi.setSystemTime(Date.now() + 61_000);

            expect(new SessionMemoryStorage(60_000, filePath).size).toBe(0);
        } finally {
            vi.useRealTimers();
        }
    });

    it('starts empty when the file is missing or corrupt', () => {
        expect(new SessionMemoryStorage(undefined, filePath).size).toBe(0);
        fs.writeFileSync(filePath, '{nope');
        expect(new SessionMemoryStorage(undefined, filePath).size).toBe(0);
    });

    it('forgets a session after logout', () => {
        const store = new SessionMemoryStorage(undefined, filePath);
        store.set(sessId, { auth });
        store.flush();
        store.destroy(sessId);
        store.flush();

        expect(new SessionMemoryStorage(undefined, filePath).get(sessId)).toBeUndefined();
    });
});
