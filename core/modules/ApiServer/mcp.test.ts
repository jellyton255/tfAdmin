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
import ApiServer from './index';
import apiV1Router from './router';

let tmpDir: string;
let server: ReturnType<Koa['listen']>;
let baseUrl: string;
let apiServer: ApiServer;
let readToken: string;
let warnToken: string;
let whitelistToken: string;

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
        cacheStore: { get: () => undefined },
        logger: { admin: { write: () => { } } },
        fxRunner: { child: { isAlive: true, mutex: 'mtx1' } },
        fxPlayerlist: { getOnlinePlayersByLicense: () => [] },
        database: {
            players: { findOne: () => null },
            actions: { findOne: (id: string) => (id === ban.id ? ban : null) },
        },
    });

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
});
