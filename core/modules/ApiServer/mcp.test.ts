/**
 * Tests for POST /api/v1/mcp on a real Koa app: tools follow the key's scopes and every call goes
 * through the matching /api/v1 route with the caller's own key.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import Koa from 'koa';
import KoaBodyParser from 'koa-bodyparser';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { ResourceUpdatedNotificationSchema } from '@modelcontextprotocol/sdk/types.js';
import { API_SCOPE_ALL } from '@shared/apiScopes';
import ApiServer from './index';
import apiV1Router from './router';

let tmpDir: string;
let server: ReturnType<Koa['listen']>;
let baseUrl: string;
let apiServer: ApiServer;
let readToken: string;
let warnToken: string;
let whitelistToken: string;
let actorToken: string;
let wildcardToken: string;
let actorDeleted = false;
let resourceCommand: ReturnType<typeof vi.fn>;
let resourceReport: { ts: Date; resources: unknown[] } | null = null;

const LIC_A = 'a'.repeat(40);
const ban = {
    id: 'BAN1-AAAA', type: 'ban', ids: [`license:${LIC_A}`], playerName: 'Alice', reason: 'cheating',
    author: 'julian', timestamp: 1, expiration: false, revocation: { timestamp: null, author: null },
};

beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'txapimcp-'));
    apiServer = new ApiServer({ keysFilePath: path.join(tmpDir, 'apiKeys.json'), webhooksFilePath: path.join(tmpDir, 'webhooks.json') });
    readToken = (await apiServer.keyStore.create({ name: 'reader', permissions: [] }, 'test')).token;
    warnToken = (await apiServer.keyStore.create({ name: 'warner', permissions: ['players.warn'] }, 'test')).token;
    whitelistToken = (await apiServer.keyStore.create({ name: 'Agents MCP', permissions: ['players.whitelist'] }, 'test')).token;
    actorToken = (await apiServer.keyStore.create({ name: 'Actor MCP', permissions: ['api.actor', 'manage.admins'] }, 'test')).token;
    wildcardToken = (await apiServer.keyStore.create({ name: 'Wildcard MCP', permissions: [API_SCOPE_ALL, 'api.actor'] }, 'test')).token;

    vi.stubGlobal('txConfig', { general: { serverName: 'Everfall Dev2' } });
    vi.stubGlobal('txManager', {
        globalStatus: {
            configState: 'ready',
            discord: 2,
            runner: { isIdle: false, isChildAlive: true },
            server: { name: 'Everfall Dev2', uptime: 1, health: 'ONLINE', healthReason: 'ok', whitelist: 'approvedLicense' },
            scheduler: { nextRelativeMs: false, nextSkip: false, nextIsTemp: false },
        },
        hostStatus: { playerCount: 0, playerSlots: 64 },
    });
    vi.stubGlobal('txCore', {
        apiServer,
        adminStore: {
            getAdminByIdentifiers: (identifiers: string[]) => actorDeleted ? null : identifiers.includes('discord:11111111111111111')
                ? { name: 'Admin Actor', master: false, permissions: ['manage.admins'] }
                : identifiers.includes('discord:22222222222222222')
                    ? { name: 'Restricted Actor', master: false, permissions: [] }
                    : null,
        },
        cacheStore: { get: () => undefined },
        logger: { admin: { write: () => { } } },
        fxRunner: { child: { isAlive: true, mutex: 'mtx1' }, sendCommand: (...args: unknown[]) => resourceCommand(...args) },
        fxResources: { get resourceReport() { return resourceReport; } },
        fxPlayerlist: { getOnlinePlayersByLicense: () => [] },
        database: {
            players: { findOne: () => null },
            actions: { findOne: (id: string) => (id === ban.id ? ban : null) },
        },
    });
    resourceCommand = vi.fn(() => true);

    const app = new Koa();
    app.use(KoaBodyParser({ jsonLimit: '64kb' }));
    app.use(async (ctx: any, next) => {
        ctx.txVars = { realIP: ctx.ip, isLocalRequest: true, isWebInterface: true, hostType: 'localhost' };
        await next();
    });
    const router = apiV1Router();
    app.use(router.routes()).use(router.allowedMethods());
    server = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server.once('listening', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
    server?.close();
    await apiServer.handleShutdown();
    vi.unstubAllGlobals();
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

const connect = async (token: string) => {
    const client = new Client({ name: 'test', version: '1.0.0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${baseUrl}/api/v1/mcp`), {
        requestInit: { headers: { Authorization: `Bearer ${token}` } },
    }));
    return client;
};
const connectAs = async (token: string, actorId: string) => {
    const client = new Client({ name: 'test', version: '1.0.0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${baseUrl}/api/v1/mcp`), {
        requestInit: { headers: { Authorization: `Bearer ${token}`, 'X-TxAdmin-Actor-Id': actorId } },
    }));
    return client;
};
const toolNames = async (client: Client) => (await client.listTools()).tools.map((t) => t.name);
const textOf = (result: any) => result.content[0].text as string;


describe('POST /api/v1/mcp', () => {
    it('rejects requests without a key', async () => {
        const resp = await fetch(`${baseUrl}/api/v1/mcp`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
            body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
        });
        expect(resp.status).toBe(401);
    });

    it('describes the server and lists only the tools the key can use', async () => {
        const client = await connect(readToken);
        expect(client.getInstructions()).toContain('Everfall Dev2');
        expect(client.getInstructions()).toContain('api:reader');
        const names = await toolNames(client);
        expect(names).toContain('tfadmin_status');
        expect(names).toContain('tfadmin_whitelist_requests');
        expect(names).not.toContain('tfadmin_players_ban');
        expect(names).not.toContain('tfadmin_whitelist_approve');
        expect(names).not.toContain('tfadmin_admins_list');
        await client.close();

        const agent = await connect(whitelistToken);
        const agentNames = await toolNames(agent);
        expect(agentNames).toContain('tfadmin_whitelist_approve');
        expect(agentNames).toContain('tfadmin_whitelist_remove_approval');
        expect(agentNames).not.toContain('tfadmin_players_kick');
        await agent.close();
    });

    it('annotates reads and destructive writes', async () => {
        const client = await connect(warnToken);
        const tools = (await client.listTools()).tools;
        expect(tools.find((t) => t.name === 'tfadmin_status')?.annotations?.readOnlyHint).toBe(true);
        expect(tools.find((t) => t.name === 'tfadmin_players_warn')?.annotations?.destructiveHint).toBe(true);
        await client.close();
    });

    it('answers a tool call through its route', async () => {
        const client = await connect(readToken);
        const result = await client.callTool({ name: 'tfadmin_status', arguments: {} });
        expect(result.isError).toBeFalsy();
        expect(result.structuredContent).toEqual(expect.objectContaining({ data: expect.any(Object) }));
        expect(JSON.parse(textOf(result)).data.server.health).toBe('ONLINE');
        await client.close();
    });

    it('returns the route refusal as a tool error', async () => {
        const client = await connect(warnToken);
        const forbidden = await client.callTool({ name: 'tfadmin_actions_revoke', arguments: { id: ban.id } });
        expect(forbidden.isError).toBe(true);
        expect(textOf(forbidden)).toContain('FORBIDDEN');
        expect(textOf(forbidden)).toContain('players.ban');

        const missing = await client.callTool({ name: 'tfadmin_players_get', arguments: { license: 'b'.repeat(40) } });
        expect(missing.isError).toBe(true);
        expect(textOf(missing)).toContain('NOT_FOUND');
        await client.close();
    });

    it('validates tool input before calling the route', async () => {
        const client = await connect(readToken);
        const result = await client.callTool({ name: 'tfadmin_players_get', arguments: { license: 'nope' } });
        expect(result.isError).toBe(true);
        expect(textOf(result)).toContain('40 hex');
        await client.close();
    });

    it('lists and reads resources, then receives subscribed event updates', async () => {
        const client = await connect(readToken);
        const listed = await client.listResources();
        expect(listed.resources.map((resource) => resource.uri)).toContain('tfadmin://status');
        const status = await client.readResource({ uri: 'tfadmin://status' });
        const statusContent = status.contents[0];
        if (!('text' in statusContent)) throw new Error('Expected a text status resource.');
        expect(JSON.parse(statusContent.text).data.server.health).toBe('ONLINE');

        const update = new Promise<{ uri: string }>((resolve) => {
            client.setNotificationHandler(ResourceUpdatedNotificationSchema, (notification) => resolve(notification.params));
        });
        await client.subscribeResource({ uri: 'tfadmin://events/all' });
        apiServer.publishEvent('player.joined', { netid: 7 });
        await expect(update).resolves.toEqual({ uri: 'tfadmin://events/all' });
        await client.unsubscribeResource({ uri: 'tfadmin://events/all' });
        let updates = 0;
        client.setNotificationHandler(ResourceUpdatedNotificationSchema, () => { updates++; });
        apiServer.publishEvent('player.left', { netid: 7 });
        await new Promise((resolve) => setTimeout(resolve, 25));
        expect(updates).toBe(0);
        await client.close();
    });

    it('requires bearer authentication for resource session requests', async () => {
        const resp = await fetch(`${baseUrl}/api/v1/mcp`, { method: 'GET' });
        expect(resp.status).toBe(401);
    });

    it('rejects unknown resources and unknown sessions', async () => {
        const client = await connect(readToken);
        await expect(client.subscribeResource({ uri: 'tfadmin://events/not-an-event' })).rejects.toThrow();
        await expect(client.readResource({ uri: 'tfadmin://events/not-an-event' })).rejects.toThrow();
        await client.close();
        const response = await fetch(`${baseUrl}/api/v1/mcp`, {
            method: 'GET', headers: { Authorization: `Bearer ${readToken}`, 'Mcp-Session-Id': 'missing-session' },
        });
        expect(response.status).toBe(404);
    });

    it('binds a stateful session to its key and rejects revoked access', async () => {
        const initialize = await fetch(`${baseUrl}/api/v1/mcp`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${readToken}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
            body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' } } }),
        });
        expect(initialize.status).toBe(200);
        const sessionId = initialize.headers.get('mcp-session-id');
        expect(sessionId).toBeTruthy();
        const otherKey = await fetch(`${baseUrl}/api/v1/mcp`, {
            method: 'GET', headers: { Authorization: `Bearer ${warnToken}`, 'Mcp-Session-Id': sessionId ?? '' },
        });
        expect(otherKey.status).toBe(403);
        const reader = apiServer.keyStore.list().find((key) => key.name === 'reader');
        expect(reader).toBeTruthy();
        await apiServer.keyStore.revoke(reader?.id ?? '', 'test');
        const revoked = await fetch(`${baseUrl}/api/v1/mcp`, {
            method: 'GET', headers: { Authorization: `Bearer ${readToken}`, 'Mcp-Session-Id': sessionId ?? '' },
        });
        expect(revoked.status).toBe(401);
    });

    it('binds a session to the exact actor and filters restricted admin events', async () => {
        const initialize = await fetch(`${baseUrl}/api/v1/mcp`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${actorToken}`, 'X-TxAdmin-Actor-Id': 'discord:11111111111111111', 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
            body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' } } }),
        });
        const sessionId = initialize.headers.get('mcp-session-id');
        expect(sessionId).toBeTruthy();
        const differentActor = await fetch(`${baseUrl}/api/v1/mcp`, {
            method: 'GET', headers: { Authorization: `Bearer ${actorToken}`, 'X-TxAdmin-Actor-Id': 'discord:22222222222222222', 'Mcp-Session-Id': sessionId ?? '' },
        });
        expect(differentActor.status).toBe(403);
        const restricted = await connectAs(actorToken, 'discord:22222222222222222');
        let delivered = false;
        restricted.setNotificationHandler(ResourceUpdatedNotificationSchema, () => { delivered = true; });
        await restricted.subscribeResource({ uri: 'tfadmin://events/all' });
        apiServer.publishEvent('admin.login', { admin: 'hidden' });
        await new Promise((resolve) => setTimeout(resolve, 25));
        expect(delivered).toBe(false);
        await restricted.close();

        const wildcard = await connectAs(wildcardToken, 'discord:11111111111111111');
        let notifications = 0;
        wildcard.setNotificationHandler(ResourceUpdatedNotificationSchema, () => { notifications++; });
        await wildcard.subscribeResource({ uri: 'tfadmin://events/all' });
        apiServer.publishEvent('admin.login', { admin: 'visible' });
        await new Promise((resolve) => setTimeout(resolve, 25));
        expect(notifications).toBe(1);
        const wildcardKey = apiServer.keyStore.list().find((key) => key.name === 'Wildcard MCP');
        expect(wildcardKey).toBeTruthy();
        await apiServer.keyStore.updatePermissions(wildcardKey?.id ?? '', ['manage.admins']);
        apiServer.publishEvent('admin.login', { admin: 'scope-removed' });
        await new Promise((resolve) => setTimeout(resolve, 25));
        expect(notifications).toBe(1);
        await wildcard.close().catch(() => { });

        await apiServer.keyStore.updatePermissions(wildcardKey?.id ?? '', [API_SCOPE_ALL, 'api.actor']);
        const deletedActor = await connectAs(wildcardToken, 'discord:11111111111111111');
        let deletedNotifications = 0;
        deletedActor.setNotificationHandler(ResourceUpdatedNotificationSchema, () => { deletedNotifications++; });
        await deletedActor.subscribeResource({ uri: 'tfadmin://events/all' });
        actorDeleted = true;
        apiServer.publishEvent('admin.login', { admin: 'deleted' });
        await new Promise((resolve) => setTimeout(resolve, 25));
        expect(deletedNotifications).toBe(0);
        await deletedActor.close().catch(() => { });
        actorDeleted = false;
    });

    it('disposes a resource poll when actor authorization changes in flight', async () => {
        const client = await connectAs(wildcardToken, 'discord:11111111111111111');
        await client.subscribeResource({ uri: 'tfadmin://resources' });
        await vi.waitFor(() => expect(resourceCommand).toHaveBeenCalled());
        const wildcardKey = apiServer.keyStore.list().find((key) => key.name === 'Wildcard MCP');
        expect(wildcardKey).toBeTruthy();
        await apiServer.keyStore.updatePermissions(wildcardKey?.id ?? '', ['manage.admins']);
        resourceReport = { ts: new Date(), resources: [{ name: 'test', status: 'started', path: '/tmp/test' }] };
        await new Promise((resolve) => setTimeout(resolve, 100));
        await apiServer.keyStore.updatePermissions(wildcardKey?.id ?? '', [API_SCOPE_ALL, 'api.actor']);
        await expect(client.listResources()).rejects.toThrow();
        resourceReport = null;
        await client.close().catch(() => { });
    });
});
