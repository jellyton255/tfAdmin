/**
 * End-to-end test of the /api/v1 router on a real Koa app with a stubbed txCore.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import Koa from 'koa';
import KoaBodyParser from 'koa-bodyparser';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import ApiServer from './index';
import apiV1Router, { apiNotFound } from './router';

let tmpDir: string;
let server: ReturnType<Koa['listen']>;
let baseUrl: string;
let apiServer: ApiServer;
const adminLog: string[] = [];

beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'txapirouter-'));
    apiServer = new ApiServer({ keysFilePath: path.join(tmpDir, 'apiKeys.json'), webhooksFilePath: path.join(tmpDir, 'webhooks.json') });

    vi.stubGlobal('txCore', {
        apiServer,
        adminStore: {
            getPermissionsList: () => ({
                'all_permissions': 'All Permissions',
                'manage.admins': 'Manage Admins',
                'players.ban': 'Ban',
                'players.kick': 'Kick',
                'control.server': 'Server control',
            }),
        },
        cacheStore: { get: () => undefined },
        logger: { admin: { write: (author: string, msg: string) => adminLog.push(`${author}: ${msg}`) } },
    });

    const app = new Koa();
    app.use(KoaBodyParser({ jsonLimit: '64kb' }));
    //Minimal stand-ins for the WebServer middlewares the API relies on
    app.use(async (ctx: any, next) => {
        ctx.txVars = { realIP: ctx.ip, isLocalRequest: true, isWebInterface: true, hostType: 'localhost' };
        ctx.send = (data: unknown) => { ctx.body = data; };
        await next();
    });
    const router = apiV1Router();
    app.use(router.routes()).use(router.allowedMethods());
    app.use(async (ctx: any) => {
        if (ctx.path.startsWith('/api/')) return apiNotFound(ctx);
        ctx.body = 'index';
    });
    server = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const { port } = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
    server?.close();
    await apiServer.handleShutdown();
    vi.unstubAllGlobals();
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

const call = async (method: string, route: string, token?: string, body?: unknown, contentType = 'application/json') => {
    const resp = await fetch(baseUrl + route, {
        method,
        headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...(body !== undefined ? { 'Content-Type': contentType } : {}),
        },
        body: body !== undefined ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
    });
    const json = await resp.json().catch(() => null);
    return { status: resp.status, headers: resp.headers, json };
};


describe('/api/v1', () => {
    let adminToken: string;
    let adminKeyId: string;

    it('rejects requests without a bearer token', async () => {
        const r = await call('GET', '/api/v1/me');
        expect(r.status).toBe(401);
        expect(r.json.error.code).toBe('UNAUTHORIZED');
        expect(r.headers.get('www-authenticate')).toContain('Bearer');
        expect(r.headers.get('x-request-id')).toBeTruthy();
    });

    it('rejects a bogus token', async () => {
        const r = await call('GET', '/api/v1/me', 'txk_abcdefghijkl.' + 'x'.repeat(40));
        expect(r.status).toBe(401);
        expect(r.json.error.message).toBe('Unknown API key.');
    });

    it('returns a JSON 404 for unknown api routes, not the react index', async () => {
        const r = await call('GET', '/api/v1/nope');
        expect(r.status).toBe(404);
        expect(r.json.error.code).toBe('NOT_FOUND');
    });

    it('/me describes the calling key', async () => {
        const created = await apiServer.keyStore.create({ name: 'root', permissions: ['all_permissions'] }, 'test');
        adminToken = created.token;
        adminKeyId = created.key.id;

        const r = await call('GET', '/api/v1/me', adminToken);
        expect(r.status).toBe(200);
        expect(r.json.data.key.id).toBe(adminKeyId);
        expect(r.json.data.key.secretHash).toBeUndefined();
        expect(r.json.data.serverTime).toBeTypeOf('number');
        expect(r.headers.get('x-ratelimit-remaining')).toBeTruthy();
    });

    it('creates a scoped key through the API and logs the action', async () => {
        const r = await call('POST', '/api/v1/keys', adminToken, {
            name: 'bot',
            permissions: ['players.ban', 'players.kick'],
            allowedIps: ['127.0.0.1'],
        });
        expect(r.status).toBe(201);
        expect(r.json.data.token).toMatch(/^txk_/);
        expect(r.json.data.key.permissions).toEqual(['players.ban', 'players.kick']);
        expect(r.json.data.key.createdBy).toBe('api:root');
        expect(adminLog.some((l) => l.startsWith('api:root: Created API key \'bot\''))).toBe(true);

        //the new key can call /me but not manage keys
        const me = await call('GET', '/api/v1/me', r.json.data.token);
        expect(me.status).toBe(200);
        const list = await call('GET', '/api/v1/keys', r.json.data.token);
        expect(list.status).toBe(403);
        expect(list.json.error.code).toBe('FORBIDDEN');
    });

    it('refuses to grant permissions the issuer does not hold', async () => {
        const limited = await apiServer.keyStore.create({ name: 'mgr', permissions: ['manage.admins', 'players.kick'] }, 'test');
        const r = await call('POST', '/api/v1/keys', limited.token, { name: 'esc', permissions: ['players.ban'] });
        expect(r.status).toBe(403);
        expect(r.json.error.details.permissions).toEqual(['players.ban']);
        const ok = await call('POST', '/api/v1/keys', limited.token, { name: 'fine', permissions: ['players.kick'] });
        expect(ok.status).toBe(201);
        //scopes with no admin permission behind them (notes) and read-only keys need nothing extra
        const notes = await call('POST', '/api/v1/keys', limited.token, { name: 'notes', permissions: ['players.note'] });
        expect(notes.status).toBe(201);
        const readOnly = await call('POST', '/api/v1/keys', limited.token, { name: 'reader', permissions: [] });
        expect(readOnly.status).toBe(201);
        expect(readOnly.json.data.key.permissions).toEqual([]);
        const me = await call('GET', '/api/v1/me', readOnly.json.data.token);
        expect(me.status).toBe(200);
    });

    it('validates bodies and content types', async () => {
        const bad = await call('POST', '/api/v1/keys', adminToken, { name: 'x', permissions: ['nope.perm'] });
        expect(bad.status).toBe(400);
        expect(bad.json.error.code).toBe('VALIDATION_ERROR');
        expect(bad.json.error.details.permissions).toEqual(['nope.perm']);

        const missing = await call('POST', '/api/v1/keys', adminToken, { permissions: ['players.ban'] });
        expect(missing.status).toBe(400);
        expect(missing.json.error.details[0].path).toBe('name');

        const dupe = await call('POST', '/api/v1/keys', adminToken, { name: 'bot', permissions: ['players.ban'] });
        expect(dupe.status).toBe(409);

        const past = await call('POST', '/api/v1/keys', adminToken, { name: 'past', permissions: ['players.ban'], expiresAt: 1000 });
        expect(past.status).toBe(400);
        expect(past.json.error.code).toBe('VALIDATION_ERROR');

        const text = await call('POST', '/api/v1/keys', adminToken, 'name=bot', 'text/plain');
        expect(text.status).toBe(415);
    });

    it('lists and revokes keys', async () => {
        const list = await call('GET', '/api/v1/keys', adminToken);
        expect(list.status).toBe(200);
        expect(list.json.data.keys.length).toBeGreaterThanOrEqual(3);
        expect(list.json.data.scopes.find((s: any) => s.id === 'players.ban').label).toBe('Ban players');
        const bot = list.json.data.keys.find((k: any) => k.name === 'bot');

        const rev = await call('DELETE', `/api/v1/keys/${bot.id}`, adminToken);
        expect(rev.status).toBe(200);
        expect(rev.json.data.key.revokedAt).toBeTypeOf('number');
        expect(rev.json.data.key.revokedBy).toBe('api:root');

        const missing = await call('DELETE', '/api/v1/keys/zzzzzzzzzzzz', adminToken);
        expect(missing.status).toBe(404);
    });

    it('rate limits per key', async () => {
        const { token } = await apiServer.keyStore.create({ name: 'spammy', permissions: ['players.kick'] }, 'test');
        let limited = null;
        for (let i = 0; i < 130; i++) {
            const r = await call('GET', '/api/v1/me', token);
            if (r.status === 429) { limited = r; break; }
        }
        expect(limited).not.toBeNull();
        expect(limited!.json.error.code).toBe('RATE_LIMITED');
        expect(Number(limited!.headers.get('retry-after'))).toBeGreaterThan(0);
        //other keys unaffected
        expect((await call('GET', '/api/v1/me', adminToken)).status).toBe(200);
    });
});
