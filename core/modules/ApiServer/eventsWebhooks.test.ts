/**
 * Tests for the phase 4 pieces: event ring buffer, webhook store, signed dispatcher with retries,
 * and the /api/v1/events + /api/v1/webhooks routes on a real Koa app with a stubbed txCore.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import Koa from 'koa';
import KoaBodyParser from 'koa-bodyparser';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import ApiServer from './index';
import apiV1Router from './router';
import ApiEventBus from './events';
import WebhookStore from './WebhookStore';
import WebhookDispatcher, { signWebhookBody, verifyWebhookSignature, type WebhookSendResult } from './dispatcher';

let tmpDir: string;
let server: ReturnType<Koa['listen']>;
let baseUrl: string;
let apiServer: ApiServer;
let rootToken: string;
let readOnlyToken: string;
let adminLog: string[];

//Fake transport: every call recorded, response controlled per test
let sent: { url: string; body: string; headers: Record<string, string> }[];
let respondWith: () => WebhookSendResult;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const api = async (method: string, route: string, token: string | null, body?: unknown) => {
    const headers: Record<string, string> = {};
    if (token) headers['authorization'] = `Bearer ${token}`;
    if (body !== undefined) headers['content-type'] = 'application/json';
    const resp = await fetch(`${baseUrl}/api/v1${route}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
    return { status: resp.status, body: await resp.json() as any };
};

beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'txapievents-'));
    sent = [];
    respondWith = () => ({ status: 200 });
    apiServer = new ApiServer({
        keysFilePath: path.join(tmpDir, 'apiKeys.json'),
        webhooksFilePath: path.join(tmpDir, 'webhooks.json'),
        dispatcher: {
            sender: async (url, body, headers) => { sent.push({ url, body, headers }); return respondWith(); },
            backoffMs: [30, 30], //3 attempts total
        },
    });
    rootToken = (await apiServer.keyStore.create({ name: 'root', permissions: ['all_permissions'] }, 'test')).token;
    readOnlyToken = (await apiServer.keyStore.create({ name: 'reader', permissions: ['players.kick'] }, 'test')).token;

    vi.stubGlobal('txConfig', { general: { serverName: 'Everfall Dev2' } });
    vi.stubGlobal('txManager', { isShuttingDown: false });
    vi.stubGlobal('txCore', {
        apiServer,
        adminStore: { getPermissionsList: () => ({ 'all_permissions': 'All' }) },
        cacheStore: { get: () => undefined },
        logger: { admin: { write: (author: string, msg: string) => adminLog.push(`${author}: ${msg}`) } },
    });

    const app = new Koa();
    app.use(KoaBodyParser({ jsonLimit: '64kb' }));
    app.use(async (ctx: any, next) => {
        ctx.txVars = { realIP: ctx.ip, isLocalRequest: true, isWebInterface: true, hostType: 'localhost' };
        await next();
    });
    const router = apiV1Router();
    app.use(router.routes()).use(router.allowedMethods());
    await new Promise<void>((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

beforeEach(() => {
    sent = [];
    respondWith = () => ({ status: 200 });
    adminLog = [];
});

afterAll(async () => {
    apiServer.handleShutdown();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.unstubAllGlobals();
});


describe('ApiEventBus', () => {
    it('keeps a bounded buffer with monotonic ids and pages by cursor', () => {
        const bus = new ApiEventBus(5, 100);
        for (let i = 0; i < 8; i++) bus.emit('player.joined', { i });
        expect(bus.size).toBe(5);
        const first = bus.list({ limit: 2 });
        expect(first.events.map((e) => e.data.i)).toEqual([3, 4]);
        expect(first.hasMore).toBe(true);
        expect(first.dropped).toBe(false);
        const second = bus.list({ since: first.cursor!, limit: 10 });
        expect(second.events.map((e) => e.data.i)).toEqual([5, 6, 7]);
        expect(second.hasMore).toBe(false);
        const third = bus.list({ since: second.cursor!, limit: 10 });
        expect(third.events).toEqual([]);
        expect(third.cursor).toBe(second.cursor);
    });

    it('flags dropped events when the cursor is older than the buffer', () => {
        const bus = new ApiEventBus(3, 100);
        const first = bus.emit('player.joined');
        for (let i = 0; i < 5; i++) bus.emit('player.left');
        const page = bus.list({ since: first.id, limit: 10 });
        expect(page.dropped).toBe(true);
        expect(page.events).toHaveLength(3);
    });

    it('filters by type and advances the cursor past skipped events', () => {
        const bus = new ApiEventBus(10, 100);
        bus.emit('player.joined');
        bus.emit('player.banned');
        const last = bus.emit('player.left');
        const page = bus.list({ types: ['player.banned'], limit: 10 });
        expect(page.events.map((e) => e.type)).toEqual(['player.banned']);
        expect(page.cursor).toBe(last.id);
    });

    it('maps in-game event names and ignores internal ones', () => {
        const bus = new ApiEventBus(10, 100);
        expect(bus.publishServerEvent('playerBanned', { actionId: 'X' })).toBe(true);
        expect(bus.publishServerEvent('consoleCommand', {})).toBe(false);
        expect(bus.publishServerEvent('adminsUpdated', [1, 2])).toBe(false);
        expect(bus.list({ limit: 10 }).events.map((e) => e.type)).toEqual(['player.banned']);
    });
});


describe('signatures', () => {
    it('round-trips and rejects tampering or stale timestamps', () => {
        const ts = Date.now();
        const header = signWebhookBody('s3cret-s3cret-s3cret', ts, '{"a":1}');
        expect(verifyWebhookSignature('s3cret-s3cret-s3cret', header, '{"a":1}', ts)).toBe(true);
        expect(verifyWebhookSignature('s3cret-s3cret-s3cret', header, '{"a":2}', ts)).toBe(false);
        expect(verifyWebhookSignature('other-secret-other', header, '{"a":1}', ts)).toBe(false);
        expect(verifyWebhookSignature('s3cret-s3cret-s3cret', header, '{"a":1}', ts + 10 * 60_000)).toBe(false);
        expect(verifyWebhookSignature('s3cret-s3cret-s3cret', undefined, '{"a":1}', ts)).toBe(false);
    });
});


describe('WebhookDispatcher', () => {
    const makeIsolated = (sender: (url: string, body: string, headers: Record<string, string>) => Promise<WebhookSendResult>) => {
        const store = new WebhookStore(path.join(tmpDir, `wh-${Math.random().toString(36).slice(2)}.json`));
        const bus = new ApiEventBus(100, 100);
        const dispatcher = new WebhookDispatcher(store, bus, { sender, backoffMs: [20, 20] });
        return { store, bus, dispatcher };
    };

    it('signs and delivers to matching webhooks only', async () => {
        const calls: { url: string; body: string; headers: Record<string, string> }[] = [];
        const { store, bus, dispatcher } = makeIsolated(async (url, body, headers) => { calls.push({ url, body, headers }); return { status: 204 }; });
        const bans = await store.create({ name: 'bans', url: 'https://example.test/bans', events: ['player.banned'] }, 'tester');
        await store.create({ name: 'all', url: 'https://example.test/all', events: ['*'] }, 'tester');
        bus.emit('player.banned', { actionId: 'B1' });
        bus.emit('player.joined', { netid: 1 });
        await sleep(50);
        expect(calls.map((c) => c.url).sort()).toEqual(['https://example.test/all', 'https://example.test/all', 'https://example.test/bans']);
        const banCall = calls.find((c) => c.url.endsWith('/bans'))!;
        expect(verifyWebhookSignature(bans.secret, banCall.headers['x-txadmin-signature'], banCall.body)).toBe(true);
        const payload = JSON.parse(banCall.body);
        expect(payload.event.type).toBe('player.banned');
        expect(payload.event.data).toEqual({ actionId: 'B1' });
        expect(payload.webhookId).toBe(bans.webhook.id);
        expect(payload.attempt).toBe(1);
        expect(banCall.headers['x-txadmin-event']).toBe('player.banned');
        expect(store.get(bans.webhook.id)!.deliveredCount).toBe(1);
        expect(store.get(bans.webhook.id)!.lastDeliveryOk).toBe(true);
        dispatcher.destroy();
    });

    it('retries with backoff then marks the delivery failed', async () => {
        let n = 0;
        const { store, bus, dispatcher } = makeIsolated(async () => { n++; return n < 3 ? { status: 500 } : { status: null, error: 'ECONNREFUSED' }; });
        const wh = await store.create({ name: 'flaky', url: 'https://example.test/x', events: ['*'] }, 'tester');
        bus.emit('server.online', {});
        await sleep(150);
        const [delivery] = dispatcher.listDeliveries(wh.webhook.id);
        expect(delivery.status).toBe('failed');
        expect(delivery.attempts).toBe(3);
        expect(delivery.error).toBe('ECONNREFUSED');
        expect(store.get(wh.webhook.id)!.failedCount).toBe(1);
        expect(dispatcher.pendingCount).toBe(0);
        dispatcher.destroy();
    });

    it('recovers on a later attempt', async () => {
        let n = 0;
        const { store, bus, dispatcher } = makeIsolated(async () => { n++; return { status: n === 1 ? 502 : 200 }; });
        const wh = await store.create({ name: 'recovers', url: 'https://example.test/x', events: ['*'] }, 'tester');
        bus.emit('server.online', {});
        await sleep(80);
        const [delivery] = dispatcher.listDeliveries(wh.webhook.id);
        expect(delivery.status).toBe('ok');
        expect(delivery.attempts).toBe(2);
        expect(delivery.httpStatus).toBe(200);
        dispatcher.destroy();
    });

    it('stops retrying when the webhook is disabled or removed', async () => {
        let n = 0;
        const { store, bus, dispatcher } = makeIsolated(async () => { n++; return { status: 500 }; });
        const wh = await store.create({ name: 'gone', url: 'https://example.test/x', events: ['*'] }, 'tester');
        bus.emit('server.online', {});
        await sleep(5);
        await store.update(wh.webhook.id, { enabled: false });
        await sleep(60);
        expect(n).toBe(1);
        expect(dispatcher.listDeliveries(wh.webhook.id)[0].status).toBe('failed');
        dispatcher.destroy();
    });
});


describe('WebhookStore validation', () => {
    it('rejects unknown events, duplicates and the limit', async () => {
        const store = new WebhookStore(path.join(tmpDir, 'wh-validation.json'));
        await expect(store.create({ name: 'a', url: 'https://x.test', events: ['nope'] }, 't')).rejects.toMatchObject({ code: 'invalid_events' });
        await store.create({ name: 'a', url: 'https://x.test', events: ['*', 'player.banned'] }, 't');
        expect(store.list()[0].events).toEqual(['*']);
        await expect(store.create({ name: 'A', url: 'https://x.test', events: ['*'] }, 't')).rejects.toMatchObject({ code: 'duplicate_name' });
        for (let i = 1; i < 10; i++) await store.create({ name: `w${i}`, url: 'https://x.test', events: ['*'] }, 't');
        await expect(store.create({ name: 'w10', url: 'https://x.test', events: ['*'] }, 't')).rejects.toMatchObject({ code: 'limit_reached' });
        //secrets never leak through list/get
        expect(JSON.stringify(store.list())).not.toContain('secret');
    });
});


describe('routes', () => {
    it('GET /events pages with cursor and type filter', async () => {
        apiServer.events.emit('player.joined', { netid: 7 });
        apiServer.events.emit('player.banned', { actionId: 'B2' });
        const all = await api('GET', '/events?limit=500', readOnlyToken);
        expect(all.status).toBe(200);
        expect(all.body.data.events.some((e: any) => e.type === 'player.banned' && e.data.actionId === 'B2')).toBe(true);
        expect(all.body.meta.hasMore).toBe(false);
        const cursor = all.body.meta.cursor;
        const none = await api('GET', `/events?since=${cursor}`, readOnlyToken);
        expect(none.body.data.events).toEqual([]);
        apiServer.events.emit('server.offline', {});
        const next = await api('GET', `/events?since=${cursor}&types=server.offline`, readOnlyToken);
        expect(next.body.data.events.map((e: any) => e.type)).toEqual(['server.offline']);
        const bad = await api('GET', '/events?types=bogus', readOnlyToken);
        expect(bad.status).toBe(400);
        const badCursor = await api('GET', '/events?since=abc', readOnlyToken);
        expect(badCursor.status).toBe(400);
    });

    it('publishes apiKey.firstUse once per key', async () => {
        const token = (await apiServer.keyStore.create({ name: 'fresh', permissions: ['players.kick'] }, 'test')).token;
        await api('GET', '/me', token);
        await api('GET', '/me', token);
        const page = await api('GET', '/events?types=apiKey.firstUse&limit=500', rootToken);
        const mine = page.body.data.events.filter((e: any) => e.data.keyName === 'fresh');
        expect(mine).toHaveLength(1);
        //a key without manage.admins never sees key/webhook events, even though the cursor advances
        const hidden = await api('GET', '/events?types=apiKey.firstUse&limit=500', readOnlyToken);
        expect(hidden.body.data.events).toEqual([]);
        expect(hidden.body.meta.cursor).toBe(page.body.meta.cursor);
    });

    it('hides admin.login from keys without manage.admins', async () => {
        apiServer.publishEvent('admin.login', { name: 'tabarra', method: 'password', ip: '127.0.0.1' });
        const page = await api('GET', '/events?types=admin.login&limit=500', rootToken);
        expect(page.body.data.events.some((e: any) => e.data.name === 'tabarra' && e.data.method === 'password')).toBe(true);
        const hidden = await api('GET', '/events?types=admin.login&limit=500', readOnlyToken);
        expect(hidden.body.data.events).toEqual([]);
        expect(hidden.body.meta.cursor).toBe(page.body.meta.cursor);
    });

    it('serves the Swagger page without a key', async () => {
        const res = await fetch(`${baseUrl}/api/v1/docs`);
        expect(res.status).toBe(200);
        expect(res.headers.get('content-type')).toContain('text/html');
        expect(await res.text()).toContain('openapi.json');
    });

    it('publishes apiKey.firstUse even when the first request is forbidden', async () => {
        const token = (await apiServer.keyStore.create({ name: 'forbidden-first', permissions: ['players.kick'] }, 'test')).token;
        expect((await api('GET', '/webhooks', token)).status).toBe(403);
        const page = await api('GET', '/events?types=apiKey.firstUse&limit=500', rootToken);
        expect(page.body.data.events.filter((e: any) => e.data.keyName === 'forbidden-first')).toHaveLength(1);
    });

    it('test endpoint returns promptly when the receiver fails', async () => {
        respondWith = () => ({ status: 500 });
        const created = await api('POST', '/webhooks', rootToken, { name: 'failing', url: 'https://failing.test/hook', events: ['*'] });
        const started = Date.now();
        const test = await api('POST', `/webhooks/${created.body.data.webhook.id}/test`, rootToken);
        expect(Date.now() - started).toBeLessThan(2000);
        expect(test.body.data.delivery.status).toBe('pending');
        expect(test.body.data.delivery.attempts).toBe(1);
        expect(test.body.data.delivery.error).toBe('HTTP 500');
        await api('DELETE', `/webhooks/${created.body.data.webhook.id}`, rootToken);
    });

    it('GET /events/types lists the catalogue', async () => {
        const resp = await api('GET', '/events/types', readOnlyToken);
        expect(resp.body.data.types).toContain('player.banned');
        expect(resp.body.data.types).toContain('webhook.test');
    });

    it('webhooks need manage.admins', async () => {
        expect((await api('GET', '/webhooks', readOnlyToken)).status).toBe(403);
        expect((await api('POST', '/webhooks', readOnlyToken, { name: 'x', url: 'https://x.test', events: ['*'] })).status).toBe(403);
    });

    it('create, list, test, deliveries, patch and delete a webhook', async () => {
        const created = await api('POST', '/webhooks', rootToken, { name: 'site', url: 'https://site.test/hook', events: ['player.banned', 'player.warned'] });
        expect(created.status).toBe(201);
        expect(created.body.data.secret).toMatch(/^.{16,}$/);
        const id = created.body.data.webhook.id;
        expect(created.body.data.webhook).not.toHaveProperty('secret');
        expect(adminLog.some((l) => l.startsWith('api:root: Created webhook'))).toBe(true);

        const list = await api('GET', '/webhooks', rootToken);
        expect(list.body.data.webhooks.map((w: any) => w.id)).toContain(id);
        expect(list.body.data.eventTypes).toContain('player.banned');

        //test delivery goes only to that webhook, even though 'site' is not subscribed to webhook.test
        const test = await api('POST', `/webhooks/${id}/test`, rootToken);
        expect(test.status).toBe(200);
        expect(test.body.data.delivery.status).toBe('ok');
        expect(test.body.data.delivery.eventType).toBe('webhook.test');
        expect(sent).toHaveLength(1);
        expect(sent[0].url).toBe('https://site.test/hook');
        expect(verifyWebhookSignature(created.body.data.secret, sent[0].headers['x-txadmin-signature'], sent[0].body)).toBe(true);
        expect(JSON.parse(sent[0].body).server.name).toBe('Everfall Dev2');

        //a real event
        apiServer.events.emit('player.warned', { actionId: 'W1' });
        await sleep(30);
        expect(sent).toHaveLength(2);
        const deliveries = await api('GET', `/webhooks/${id}/deliveries`, rootToken);
        expect(deliveries.body.data.deliveries).toHaveLength(2);
        expect(deliveries.body.data.deliveries[0].eventType).toBe('player.warned');

        //patch: disable -> no more deliveries
        const patched = await api('PATCH', `/webhooks/${id}`, rootToken, { enabled: false, events: ['*'] });
        expect(patched.status).toBe(200);
        expect(patched.body.data.webhook.enabled).toBe(false);
        expect(patched.body.data.webhook.events).toEqual(['*']);
        apiServer.events.emit('player.warned', { actionId: 'W2' });
        await sleep(30);
        expect(sent).toHaveLength(2);
        expect((await api('PATCH', `/webhooks/${id}`, rootToken, {})).status).toBe(400);

        const removed = await api('DELETE', `/webhooks/${id}`, rootToken);
        expect(removed.status).toBe(200);
        expect((await api('DELETE', `/webhooks/${id}`, rootToken)).status).toBe(404);
        expect((await api('POST', `/webhooks/${id}/test`, rootToken)).status).toBe(404);
        expect((await api('GET', `/webhooks/${id}/deliveries`, rootToken)).status).toBe(404);
    });

    it('validates webhook input', async () => {
        expect((await api('POST', '/webhooks', rootToken, { name: 'bad', url: 'ftp://x.test', events: ['*'] })).status).toBe(400);
        expect((await api('POST', '/webhooks', rootToken, { name: 'bad', url: 'http://example.com/hook', events: ['*'] })).status).toBe(400);
        const local = await api('POST', '/webhooks', rootToken, { name: 'local', url: 'http://127.0.0.1:3000/hook', events: ['*'] });
        expect(local.status).toBe(201);
        await api('DELETE', `/webhooks/${local.body.data.webhook.id}`, rootToken);
        expect((await api('POST', '/webhooks', rootToken, { name: 'bad', url: 'https://x.test', events: [] })).status).toBe(400);
        const unknown = await api('POST', '/webhooks', rootToken, { name: 'bad', url: 'https://x.test', events: ['player.flew'] });
        expect(unknown.status).toBe(400);
        expect(unknown.body.error.details).toEqual({ events: ['player.flew'] });
        expect((await api('POST', '/webhooks', rootToken, { name: 'bad', url: 'https://x.test', events: ['*'], secret: 'short' })).status).toBe(400);
    });

    it('serves openapi.json without auth', async () => {
        const resp = await api('GET', '/openapi.json', null);
        expect(resp.status).toBe(200);
        expect(resp.body.openapi).toBe('3.1.0');
        expect(resp.body.paths['/webhooks']).toBeDefined();
    });
});
