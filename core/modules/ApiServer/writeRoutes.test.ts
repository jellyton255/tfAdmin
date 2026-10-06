/**
 * Tests for the /api/v1 write endpoints (bans, warns, kicks, whitelist, server control) on a real
 * Koa app with a stubbed txCore. The stubs record every database write, admin log line and
 * txAdmin:events:* payload so each test can assert the side effects.
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
import { DuplicateKeyError } from '@modules/Database/dbUtils';
import { ServerPlayer } from '@lib/player/playerClasses';
import type { DatabaseActionType, DatabasePlayerType, DatabaseWhitelistApprovalsType, DatabaseWhitelistRequestsType } from '@modules/Database/databaseTypes';

let tmpDir: string;
let server: ReturnType<Koa['listen']>;
let baseUrl: string;
let apiServer: ApiServer;
let rootToken: string;
let kickOnlyToken: string;

const nowSec = () => Math.round(Date.now() / 1000);
const LIC_ON = 'a'.repeat(40); //online
const LIC_OFF = 'b'.repeat(40); //offline, in database
const LIC_NEW = 'f'.repeat(40); //unknown

let players: DatabasePlayerType[];
let actions: DatabaseActionType[];
let approvals: DatabaseWhitelistApprovalsType[];
let requests: DatabaseWhitelistRequestsType[];
let events: { type: string; data: any }[];
let commands: { cmd: string; args: any[]; author: any }[];
let rawCommands: string[];
let adminLog: string[];
let runnerState: { alive: boolean; idle: boolean; restartDelayMs: number };
let actionSeq = 0;
let keySeq = 0;

const makePlayers = (): DatabasePlayerType[] => [
    {
        license: LIC_ON, ids: [`license:${LIC_ON}`, 'fivem:1001'], hwids: ['hw1'],
        displayName: 'Alice', pureName: 'alice', playTime: 10, tsLastConnection: nowSec(), tsJoined: nowSec() - 10,
    },
    {
        license: LIC_OFF, ids: [`license:${LIC_OFF}`], hwids: [],
        displayName: 'Bob', pureName: 'bob', playTime: 5, tsLastConnection: nowSec() - 500, tsJoined: nowSec() - 600,
    },
];

const onlinePlayer = () => Object.assign(Object.create(ServerPlayer.prototype), {
    netid: 3,
    displayName: 'Alice',
    pureName: 'alice',
    license: LIC_ON,
    isConnected: true,
    isRegistered: true,
    tsConnected: nowSec() - 60,
    idsOnline: [`license:${LIC_ON}`, 'fivem:1001'],
    hwidsOnline: ['hw1'],
    dbData: players[0],
}) as ServerPlayer;

const matches = <T>(list: T[], filter: object | Function | undefined) => {
    if (!filter) return list;
    if (typeof filter === 'function') return list.filter(filter as any);
    return list.filter((item: any) => Object.entries(filter).every(([k, v]) => item[k] === v));
};

beforeEach(async () => {
    //fresh root key per test so the heavy rate-limit bucket (10/min) never leaks between tests
    rootToken = (await apiServer.keyStore.create({ name: `root${++keySeq}`, permissions: ['all_permissions'] }, 'test')).token;
    players = makePlayers();
    actions = [];
    approvals = [];
    requests = [{ id: 'R0001', license: LIC_OFF, playerDisplayName: 'Bob', playerPureName: 'bob', discordTag: 'bob#1', tsLastAttempt: nowSec() - 5 }];
    events = [];
    commands = [];
    rawCommands = [];
    adminLog = [];
    runnerState = { alive: true, idle: false, restartDelayMs: 500 };
});

beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'txapiwrite-'));
    apiServer = new ApiServer({ keysFilePath: path.join(tmpDir, 'apiKeys.json'), webhooksFilePath: path.join(tmpDir, 'webhooks.json') });
    kickOnlyToken = (await apiServer.keyStore.create({ name: 'kicker', permissions: ['players.kick', 'players.warn', 'players.note'] }, 'test')).token;
    players = makePlayers();

    vi.stubGlobal('txConfig', {
        general: { serverName: 'Everfall Dev2' },
        whitelist: { mode: 'approvedLicense' },
        banlist: { requiredHwidMatches: 1, templates: [] },
        server: { dataPath: '/srv/data' },
    });
    vi.stubGlobal('txManager', { isShuttingDown: false });
    vi.stubGlobal('txCore', {
        apiServer,
        adminStore: {
            getPermissionsList: () => ({ 'all_permissions': 'All' }),
            getAdminsIdentifiers: () => [],
            getAdminsList: () => [],
            getAdminPublicName: (name: string) => `public(${name})`,
        },
        cacheStore: { get: () => undefined },
        logger: { admin: { write: (author: string, msg: string) => adminLog.push(`${author}: ${msg}`) } },
        translator: {
            t: (key: string, opts?: any) => `${key}${opts ? ':' + JSON.stringify(opts) : ''}`,
            tDuration: (ms: number) => `${ms / 1000}s`,
        },
        discordBot: {
            sendAnnouncement: vi.fn(async () => { }),
            resolveMemberProfile: vi.fn(async (uid: string) => ({ tag: `user${uid}`, avatar: 'http://a/v.png' })),
        },
        fxRunner: {
            get child() { return { isAlive: runnerState.alive, mutex: 'mtx' }; },
            get isIdle() { return runnerState.idle; },
            get restartSpawnDelay() { return { ms: runnerState.restartDelayMs }; },
            sendEvent: (type: string, data: any) => { events.push({ type, data }); return runnerState.alive; },
            sendCommand: (cmd: string, args: any[], author: any) => { commands.push({ cmd, args, author }); return true; },
            sendRawCommand: (cmd: string) => { rawCommands.push(cmd); return true; },
            restartServer: vi.fn(async () => null),
            killServer: vi.fn(async () => { runnerState.idle = true; return null; }),
            spawnServer: vi.fn(async () => { runnerState.idle = false; return null; }),
        },
        fxPlayerlist: {
            onlineCount: 1,
            licenseCache: [],
            getPlayerList: () => [],
            getOnlinePlayersLicenses: () => new Set([LIC_ON]),
            getOnlinePlayersByLicense: (lic: string) => (lic === LIC_ON && runnerState.alive ? [onlinePlayer()] : []),
            getPlayerById: () => undefined,
            handleDbDataSync: () => { },
        },
        database: {
            isReady: true,
            getDboRef: () => ({ chain: null }),
            players: {
                findOne: (lic: string) => players.find((p) => p.license === lic) ?? null,
                findMany: (filter: any) => matches(players, filter),
                update: (lic: string, data: object) => {
                    const p = players.find((x) => x.license === lic)!;
                    Object.assign(p, data);
                    return p;
                },
            },
            actions: {
                findOne: (id: string) => actions.find((a) => a.id === id) ?? null,
                findMany: (ids: string[]) => actions.filter((a) => ids.some((id) => a.ids.includes(id))),
                registerBan: (ids: string[], author: string, reason: string, expiration: number | false, playerName: string | false, hwids?: string[]) => {
                    const id = `BAN${++actionSeq}`;
                    actions.push({ id, type: 'ban', ids, hwids, author, reason, expiration, playerName, timestamp: nowSec(), revocation: { timestamp: null, author: null } });
                    return id;
                },
                registerWarn: (ids: string[], author: string, reason: string, playerName: string | false) => {
                    const id = `WARN${++actionSeq}`;
                    actions.push({ id, type: 'warn', ids, author, reason, expiration: false, acked: false, playerName, timestamp: nowSec(), revocation: { timestamp: null, author: null } });
                    return id;
                },
                revoke: (id: string, author: string, allowed: string[] | true) => {
                    const a = actions.find((x) => x.id === id);
                    if (!a) throw new Error('action not found');
                    if (allowed !== true && !allowed.includes(a.type)) throw new Error('not allowed');
                    a.revocation = { timestamp: nowSec(), author };
                    return a;
                },
            },
            whitelist: {
                findManyApprovals: (f?: any) => matches(approvals, f),
                findManyRequests: (f?: any) => matches(requests, f),
                registerApproval: (a: DatabaseWhitelistApprovalsType) => {
                    if (approvals.some((x) => x.identifier === a.identifier)) throw new DuplicateKeyError('dupe');
                    approvals.push(a);
                },
                removeManyApprovals: (f: any) => {
                    const removed = matches(approvals, f);
                    approvals = approvals.filter((a) => !removed.includes(a));
                    return removed;
                },
                removeManyRequests: (f: any) => {
                    const removed = matches(requests, f);
                    requests = requests.filter((r) => !removed.includes(r));
                    return removed;
                },
            },
            stats: {},
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
    const { port } = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
    server?.close();
    await apiServer.handleShutdown();
    vi.unstubAllGlobals();
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

const call = async (method: string, route: string, body?: unknown, bearer = rootToken, extraHeaders: Record<string, string> = {}) => {
    const resp = await fetch(baseUrl + route, {
        method,
        headers: {
            ...extraHeaders,
            Authorization: `Bearer ${bearer}`,
            ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    return { status: resp.status, json: await resp.json().catch(() => null) };
};
const lastEvent = (type: string) => events.filter((e) => e.type === type).at(-1)?.data;


describe('player moderation', () => {
    it('bans an online player, logs it and sends the kick event', async () => {
        const r = await call('POST', `/api/v1/players/${LIC_ON}/ban`, { reason: 'cheating', duration: '2 days' });
        expect(r.status).toBe(201);
        expect(r.json.data.action).toMatchObject({ type: 'ban', reason: 'cheating', banStatus: 'active', hwids: ['hw1'] });
        expect(r.json.data.action.expiresAt).toBeGreaterThan(Date.now() + 47 * 3600 * 1000);
        expect(r.json.data.eventSent).toBe(true);
        expect(adminLog.some((l) => /^api:root\d+: Banned player "Alice": cheating$/.test(l))).toBe(true);
        const ev = lastEvent('playerBanned');
        expect(ev).toMatchObject({ targetNetId: 3, targetIds: [`license:${LIC_ON}`, 'fivem:1001'], targetHwids: ['hw1'], durationInput: '2 days', durationTranslated: '172800s' });
        expect(ev.kickMessage).toContain('ban_messages.kick_temporary');
        expect(ev.kickMessage).toMatch(/public\(api:root\d+\)/);
    });

    it('bans an offline player permanently without an event when the server is idle', async () => {
        runnerState.idle = true;
        const r = await call('POST', `/api/v1/players/${LIC_OFF}/ban`, { reason: 'alt account', duration: 'permanent' });
        expect(r.status).toBe(201);
        expect(r.json.data.action.banStatus).toBe('permanent');
        expect(r.json.data.eventSent).toBe(false);
        expect(events).toHaveLength(0);
    });

    it('validates ban input and permissions', async () => {
        expect((await call('POST', `/api/v1/players/${LIC_ON}/ban`, { reason: 'x', duration: '3 fortnights' })).status).toBe(400);
        expect((await call('POST', `/api/v1/players/${LIC_ON}/ban`, { reason: 'x' })).status).toBe(400);
        expect((await call('POST', `/api/v1/players/${LIC_NEW}/ban`, { reason: 'x', duration: 'permanent' })).status).toBe(404);
        const denied = await call('POST', `/api/v1/players/${LIC_ON}/ban`, { reason: 'x', duration: 'permanent' }, kickOnlyToken);
        expect(denied.status).toBe(403);
        expect(actions).toHaveLength(0);
    });

    it('warns, kicks and messages', async () => {
        const warn = await call('POST', `/api/v1/players/${LIC_OFF}/warn`, { reason: 'language' }, kickOnlyToken);
        expect(warn.status).toBe(201);
        expect(warn.json.data.action).toMatchObject({ type: 'warn', acked: false, author: 'api:kicker' });
        expect(lastEvent('playerWarned')).toMatchObject({ targetNetId: null, targetName: 'Bob' });

        const kick = await call('POST', `/api/v1/players/${LIC_ON}/kick`, { reason: 'afk' }, kickOnlyToken);
        expect(kick.status).toBe(200);
        expect(lastEvent('playerKicked')).toMatchObject({ target: 3, reason: 'afk', author: 'api:kicker' });

        const kickNoBody = await call('POST', `/api/v1/players/${LIC_ON}/kick`, undefined, kickOnlyToken);
        expect(kickNoBody.status).toBe(200);
        expect(lastEvent('playerKicked').reason).toBe('kick_messages.unknown_reason');

        const kickOffline = await call('POST', `/api/v1/players/${LIC_OFF}/kick`, { reason: 'x' });
        expect(kickOffline.status).toBe(409);
        expect(kickOffline.json.error.code).toBe('PLAYER_OFFLINE');

        const dm = await call('POST', `/api/v1/players/${LIC_ON}/message`, { message: 'hello' });
        expect(dm.status).toBe(200);
        expect(lastEvent('playerDirectMessage')).toMatchObject({ target: 3, message: 'hello' });
        expect((await call('POST', `/api/v1/players/${LIC_ON}/message`, { message: 'hi' }, kickOnlyToken)).status).toBe(403);
    });

    it('returns 503 for kick when the server is offline', async () => {
        runnerState.alive = false;
        const r = await call('POST', `/api/v1/players/${LIC_ON}/kick`, { reason: 'x' });
        expect(r.status).toBe(503);
        expect(r.json.error.code).toBe('SERVER_OFFLINE');
    });

    it('sets whitelist and notes', async () => {
        const wl = await call('PUT', `/api/v1/players/${LIC_OFF}/whitelist`, { whitelisted: true });
        expect(wl.status).toBe(200);
        expect(players[1].tsWhitelisted).toBeTypeOf('number');
        expect(lastEvent('whitelistPlayer')).toMatchObject({ action: 'added', license: LIC_OFF });
        expect(adminLog.some((l) => l.endsWith(`: Added ${LIC_OFF} to the whitelist.`))).toBe(true);

        const noNoteToken = (await apiServer.keyStore.create({ name: 'note-denied', permissions: ['players.kick'] }, 'test')).token;
        const deniedNote = await call('PUT', `/api/v1/players/${LIC_OFF}/note`, { note: 'nope' }, noNoteToken);
        expect(deniedNote.status).toBe(403);
        expect(deniedNote.json.error.details.permission).toBe('players.note');

        const note = await call('PUT', `/api/v1/players/${LIC_OFF}/note`, { note: '  watch this one ' }, kickOnlyToken);
        expect(note.status).toBe(200);
        expect(players[1].notes).toMatchObject({ text: 'watch this one', lastAdmin: 'api:kicker' });
    });
});


describe('actions', () => {
    it('bans raw identifiers and revokes with the per-type permission', async () => {
        const r = await call('POST', '/api/v1/actions/ban-identifiers', {
            identifiers: ['discord:12345678901234567', 'FIVEM:42'], reason: 'ban evasion', duration: '1 week',
        });
        expect(r.status).toBe(201);
        expect(r.json.data.action.ids).toEqual(['discord:12345678901234567', 'fivem:42']);
        expect(r.json.data.action.playerName).toBeNull();
        expect(lastEvent('playerBanned')).toMatchObject({ targetName: 'identifiers', targetIds: ['discord:12345678901234567', 'fivem:42'] });

        const bad = await call('POST', '/api/v1/actions/ban-identifiers', { identifiers: ['nope:1'], reason: 'xxx', duration: '1 day' });
        expect(bad.status).toBe(400);
        expect(bad.json.error.details.invalids).toEqual(['nope:1']);

        const banId = r.json.data.action.id;
        const denied = await call('POST', `/api/v1/actions/${banId}/revoke`, undefined, kickOnlyToken);
        expect(denied.status).toBe(403);
        expect(denied.json.error.details.permission).toBe('players.ban');

        const ok = await call('POST', `/api/v1/actions/${banId.toLowerCase()}/revoke`);
        expect(ok.status).toBe(200);
        expect(ok.json.data.action.revokedBy).toMatch(/^api:root\d+$/);
        expect(lastEvent('actionRevoked')).toMatchObject({ actionId: banId, actionType: 'ban' });

        expect((await call('POST', `/api/v1/actions/${banId}/revoke`)).status).toBe(409);
        expect((await call('POST', '/api/v1/actions/NOPE/revoke')).status).toBe(404);

        //warns can be revoked by a players.warn key
        const warn = await call('POST', `/api/v1/players/${LIC_OFF}/warn`, { reason: 'x' });
        const revokeWarn = await call('POST', `/api/v1/actions/${warn.json.data.action.id}/revoke`, undefined, kickOnlyToken);
        expect(revokeWarn.status).toBe(200);
    });
});


describe('acting for a staff member', () => {
    it('records the actor and the key on bans, warns and revokes', async () => {
        const actorToken = (await apiServer.keyStore.create({ name: 'Tickets', permissions: ['api.actor', 'players.ban', 'players.warn'] }, 'test')).token;
        const asJulian = { 'X-TxAdmin-Actor': ' Julian ' };

        const ban = await call('POST', `/api/v1/players/${LIC_ON}/ban`, { reason: 'cheating', duration: '1 day' }, actorToken, asJulian);
        expect(ban.status).toBe(201);
        expect(ban.json.data.action.author).toBe('Julian (via api:Tickets)');
        expect(adminLog.at(-1)).toMatch(/^Julian \(via api:Tickets\): Banned player "Alice": cheating$/);
        expect(lastEvent('playerBanned')).toMatchObject({ author: 'Julian (via api:Tickets)' });

        const warn = await call('POST', `/api/v1/players/${LIC_OFF}/warn`, { reason: 'rdm' }, actorToken, { 'X-TxAdmin-Actor': 'Mod_Kate#2' });
        expect(warn.json.data.action.author).toBe('Mod_Kate#2 (via api:Tickets)');

        const revoke = await call('POST', `/api/v1/actions/${ban.json.data.action.id}/revoke`, undefined, actorToken, asJulian);
        expect(revoke.json.data.action.revokedBy).toBe('Julian (via api:Tickets)');

        //without the header the key name alone is recorded
        const plain = await call('POST', `/api/v1/players/${LIC_OFF}/warn`, { reason: 'again' }, actorToken);
        expect(plain.json.data.action.author).toBe('api:Tickets');
    });

    it('rejects the header without the api.actor scope or with a bad name', async () => {
        const denied = await call('POST', `/api/v1/players/${LIC_OFF}/warn`, { reason: 'x' }, kickOnlyToken, { 'X-TxAdmin-Actor': 'Julian' });
        expect(denied.status).toBe(403);
        expect(denied.json.error.details.permission).toBe('api.actor');

        for (const bad of ['', '   ', 'Julian (via api:root)', 'a'.repeat(49), '<script>', '-lead']) {
            const r = await call('POST', `/api/v1/players/${LIC_OFF}/warn`, { reason: 'x' }, rootToken, { 'X-TxAdmin-Actor': bad });
            expect(r.status, bad).toBe(400);
        }
        expect(actions).toHaveLength(0);
    });
});


describe('whitelist', () => {
    it('adds and removes approvals', async () => {
        const add = await call('POST', '/api/v1/whitelist/approvals', { identifier: 'discord:12345678901234567' });
        expect(add.status).toBe(201);
        expect(add.json.data.approval).toMatchObject({ identifier: 'discord:12345678901234567', playerName: 'user12345678901234567' });
        expect(lastEvent('whitelistPreApproval')).toMatchObject({ action: 'added' });

        expect((await call('POST', '/api/v1/whitelist/approvals', { identifier: 'discord:12345678901234567' })).status).toBe(409);
        expect((await call('POST', '/api/v1/whitelist/approvals', { identifier: 'garbage' })).status).toBe(400);
        expect((await call('POST', '/api/v1/whitelist/approvals', { identifier: 'fivem:1' }, kickOnlyToken)).status).toBe(403);

        const del = await call('DELETE', '/api/v1/whitelist/approvals/discord:12345678901234567');
        expect(del.status).toBe(200);
        expect(approvals).toHaveLength(0);
        expect((await call('DELETE', '/api/v1/whitelist/approvals/discord:12345678901234567')).status).toBe(404);
    });

    it('approves, denies and denies all requests', async () => {
        const approve = await call('POST', '/api/v1/whitelist/requests/r0001/approve');
        expect(approve.status).toBe(201);
        expect(approve.json.data.approval).toMatchObject({ identifier: `license:${LIC_OFF}`, playerName: 'bob#1' });
        expect(requests).toHaveLength(0);
        expect(lastEvent('whitelistRequest')).toMatchObject({ action: 'approved', requestId: 'R0001' });
        expect((await call('POST', '/api/v1/whitelist/requests/R0001/approve')).status).toBe(404);

        requests.push({ id: 'R0002', license: LIC_NEW, playerDisplayName: 'Zed', playerPureName: 'zed', tsLastAttempt: nowSec() });
        const deny = await call('POST', '/api/v1/whitelist/requests/R0002/deny');
        expect(deny.status).toBe(200);
        expect(lastEvent('whitelistRequest')).toMatchObject({ action: 'denied', requestId: 'R0002' });

        requests.push(
            { id: 'R0003', license: LIC_NEW, playerDisplayName: 'Old', playerPureName: 'old', tsLastAttempt: nowSec() - 100 },
            { id: 'R0004', license: LIC_NEW, playerDisplayName: 'New', playerPureName: 'new', tsLastAttempt: nowSec() + 100 },
        );
        const all = await call('POST', '/api/v1/whitelist/requests/deny-all', {});
        expect(all.status).toBe(200);
        expect(all.json.data.removed).toBe(1);
        expect(requests.map((r) => r.id)).toEqual(['R0004']);
    });
});


describe('server control and commands', () => {
    it('restarts, stops and starts', async () => {
        const restart = await call('POST', '/api/v1/server/restart');
        expect(restart.status).toBe(200);
        expect(restart.json.data).toMatchObject({ action: 'restart', result: 'restarting' });
        expect(txCore.fxRunner.restartServer).toHaveBeenCalledWith('admin request', expect.stringMatching(/^api:root\d+$/));
        expect(adminLog.some((l) => l.endsWith(': RESTART SERVER'))).toBe(true);

        runnerState.restartDelayMs = 30_000;
        const delayed = await call('POST', '/api/v1/server/restart');
        expect(delayed.json.data.result).toBe('scheduled');

        const stop = await call('POST', '/api/v1/server/stop');
        expect(stop.json.data.result).toBe('stopped');
        expect((await call('POST', '/api/v1/server/stop')).json.data.result).toBe('noop');

        const start = await call('POST', '/api/v1/server/start');
        expect(start.json.data.result).toBe('started');
        expect((await call('POST', '/api/v1/server/start')).json.data.result).toBe('noop');

        expect((await call('POST', '/api/v1/server/reboot')).status).toBe(400);
        expect((await call('POST', '/api/v1/server/restart', undefined, kickOnlyToken)).status).toBe(403);
    });

    it('announces, kicks everyone and runs console commands', async () => {
        const ann = await call('POST', '/api/v1/server/announce', { message: 'restart in 5' });
        expect(ann.status).toBe(200);
        expect(lastEvent('announcement')).toMatchObject({ message: 'restart in 5' });
        expect(txCore.discordBot.sendAnnouncement).toHaveBeenCalled();

        const kick = await call('POST', '/api/v1/server/kick-all', { reason: 'maintenance' });
        expect(kick.status).toBe(200);
        expect(lastEvent('playerKicked')).toMatchObject({ target: -1, reason: 'maintenance' });

        const cmd = await call('POST', '/api/v1/server/command', { command: 'say hello' });
        expect(cmd.status).toBe(200);
        expect(rawCommands).toEqual(['say hello']);
        expect(adminLog.some((l) => l.endsWith(': say hello'))).toBe(true);
        expect((await call('POST', '/api/v1/server/command', { command: 'x' }, kickOnlyToken)).status).toBe(403);

        runnerState.alive = false;
        expect((await call('POST', '/api/v1/server/command', { command: 'x' })).status).toBe(503);
        expect((await call('POST', '/api/v1/server/announce', { message: 'x' })).status).toBe(503);
    });

    it('controls resources and blocks runcode', async () => {
        const r = await call('POST', '/api/v1/resources/ef-core/restart');
        expect(r.status).toBe(200);
        expect(commands.at(-1)).toMatchObject({ cmd: 'restart', args: ['ef-core'] });
        expect(adminLog.some((l) => l.endsWith(': Restarted resource "ef-core"'))).toBe(true);

        expect((await call('POST', '/api/v1/resources/runcode/start')).status).toBe(403);
        expect((await call('POST', '/api/v1/resources/runcode/stop')).status).toBe(200);
        expect((await call('POST', '/api/v1/resources/ef-core/reload')).status).toBe(400);
        expect((await call('POST', '/api/v1/resources/bad%20name/start')).status).toBe(400);

        const refresh = await call('POST', '/api/v1/resources/refresh');
        expect(refresh.status).toBe(200);
        expect(commands.at(-1)).toMatchObject({ cmd: 'refresh', args: [] });
        expect((await call('POST', '/api/v1/resources/refresh', undefined, kickOnlyToken)).status).toBe(403);
    });

    it('applies the heavy rate limit bucket to server control', async () => {
        const { token } = await apiServer.keyStore.create({ name: 'spam', permissions: ['control.server'] }, 'test');
        let limited = null;
        for (let i = 0; i < 15; i++) {
            const r = await call('POST', '/api/v1/server/stop', undefined, token);
            if (r.status === 429) { limited = r; break; }
        }
        expect(limited).not.toBeNull();
    });
});
