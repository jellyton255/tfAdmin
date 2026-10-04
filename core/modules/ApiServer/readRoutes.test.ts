/**
 * Tests for the /api/v1 read endpoints on a real Koa app with a stubbed txCore/txManager/txConfig.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import Koa from 'koa';
import KoaBodyParser from 'koa-bodyparser';
import { chain as lodashChain } from 'lodash-es';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import ApiServer from './index';
import apiV1Router from './router';
import type { DatabaseActionType, DatabasePlayerType } from '@modules/Database/databaseTypes';
import { ServerPlayer } from '@lib/player/playerClasses';

let tmpDir: string;
let server: ReturnType<Koa['listen']>;
let baseUrl: string;
let apiServer: ApiServer;
let token: string;
let limitedToken: string;

const nowSec = Math.round(Date.now() / 1000);
const LIC_A = 'a'.repeat(40);
const LIC_B = 'b'.repeat(40);
const LIC_C = 'c'.repeat(40);

const players: DatabasePlayerType[] = [
    {
        license: LIC_A, ids: [`license:${LIC_A}`, 'discord:11111111111111111', 'fivem:1001'], hwids: ['hwid1'],
        displayName: 'Alice', pureName: 'alice', playTime: 500,
        tsLastConnection: nowSec - 100, tsJoined: nowSec - 100_000, tsWhitelisted: nowSec - 50_000,
        notes: { text: 'nice player', lastAdmin: 'julian', tsLastEdit: nowSec - 10 },
    },
    {
        license: LIC_B, ids: [`license:${LIC_B}`, 'fivem:1002'], hwids: [],
        displayName: 'Bob', pureName: 'bob', playTime: 20,
        tsLastConnection: nowSec - 5000, tsJoined: nowSec - 6000,
    },
    {
        license: LIC_C, ids: [`license:${LIC_C}`, 'discord:33333333333333333'], hwids: [],
        displayName: 'Carol', pureName: 'carol', playTime: 90,
        tsLastConnection: nowSec - 200, tsJoined: nowSec - 300,
    },
];

const actions: DatabaseActionType[] = [
    {
        id: 'BAN1-AAAA', type: 'ban', ids: [`license:${LIC_A}`], hwids: ['hwid1'], playerName: 'Alice',
        reason: 'cheating', author: 'julian', timestamp: nowSec - 1000, expiration: false,
        revocation: { timestamp: null, author: null },
    },
    {
        id: 'WARN-BBBB', type: 'warn', ids: [`license:${LIC_B}`], playerName: 'Bob',
        reason: 'language', author: 'casey', timestamp: nowSec - 2000, expiration: false, acked: true,
        revocation: { timestamp: null, author: null },
    },
    {
        id: 'BAN2-CCCC', type: 'ban', ids: [`license:${LIC_C}`], playerName: 'Carol',
        reason: 'rdm', author: 'julian', timestamp: nowSec - 3000, expiration: nowSec - 100,
        revocation: { timestamp: nowSec - 500, author: 'mecauz' },
    },
];

const dbData = {
    players,
    actions,
    whitelistApprovals: [
        { identifier: 'discord:11111111111111111', playerName: 'Alice', playerAvatar: null, tsApproved: nowSec - 10, approvedBy: 'julian' },
        { identifier: `license:${LIC_B}`, playerName: 'Bob', playerAvatar: null, tsApproved: nowSec - 20, approvedBy: 'casey' },
    ],
    whitelistRequests: [
        { id: 'R0001', license: LIC_C, playerDisplayName: 'Carol', playerPureName: 'carol', discordTag: 'carol#1', tsLastAttempt: nowSec - 5 },
    ],
};

//A connected player, built on the real prototype so instanceof/getHistory/getDbData work
const onlinePlayer = Object.assign(Object.create(ServerPlayer.prototype), {
    netid: 7,
    displayName: 'Alice',
    pureName: 'alice',
    license: LIC_A,
    isConnected: true,
    isRegistered: true,
    tsConnected: nowSec - 60,
    idsOnline: [`license:${LIC_A}`, 'fivem:1001'],
    hwidsOnline: ['hwid1'],
    dbData: players[0],
}) as ServerPlayer;

const matchesFilter = <T>(list: T[], filter: object | Function | undefined) => {
    if (!filter) return list;
    if (typeof filter === 'function') return list.filter(filter as any);
    return list.filter((item: any) => Object.entries(filter).every(([k, v]) => item[k] === v));
};

beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'txapiread-'));
    apiServer = new ApiServer({ keysFilePath: path.join(tmpDir, 'apiKeys.json'), webhooksFilePath: path.join(tmpDir, 'webhooks.json') });
    token = (await apiServer.keyStore.create({ name: 'root', permissions: ['all_permissions'] }, 'test')).token;
    limitedToken = (await apiServer.keyStore.create({ name: 'reader', permissions: ['players.kick'] }, 'test')).token;

    const resourceReport = { ts: new Date(0), resources: [] as any[] };
    const fxRunner = {
        child: { isAlive: true, mutex: 'mtx1' },
        isIdle: false,
        sendCommand: vi.fn((cmd: string) => {
            if (cmd === 'txaReportResources') {
                setTimeout(() => {
                    resourceReport.ts = new Date();
                    resourceReport.resources = [
                        { name: 'ef-core', status: 'started', path: '/srv/data/resources/[ef]/ef-core', version: ' 1.2.0 ', author: 'Everfall' },
                        { name: 'broken', status: 'stopped', path: '' },
                        { name: 'monitor', status: 'started', path: '/opt/fx/citizen/system_resources/monitor' },
                    ];
                }, 20);
            }
            return true;
        }),
    };

    vi.stubGlobal('txConfig', {
        general: { serverName: 'Everfall Dev2' },
        whitelist: { mode: 'disabled' },
        banlist: { requiredHwidMatches: 1, templates: [] },
        server: { dataPath: '/srv/data' },
    });
    vi.stubGlobal('txManager', {
        globalStatus: {
            configState: 'ready',
            discord: 2,
            runner: { isIdle: false, isChildAlive: true },
            server: { name: 'Everfall Dev2', uptime: 12345, health: 'ONLINE', healthReason: 'all good', whitelist: 'disabled' },
            scheduler: { nextRelativeMs: 60_000, nextSkip: false, nextIsTemp: false },
        },
        hostStatus: {
            playerCount: 1, playerSlots: 64, projectName: 'Everfall', projectDesc: 'RP', gameName: 'fivem',
            cfxId: 'abc123', joinLink: 'https://cfx.re/join/abc123',
        },
    });
    vi.stubGlobal('txCore', {
        apiServer,
        adminStore: {
            getPermissionsList: () => ({ 'all_permissions': 'All', 'manage.admins': 'Manage Admins', 'players.kick': 'Kick' }),
            getAdminsIdentifiers: () => ['discord:11111111111111111'],
            getAdminsList: () => [
                { name: 'julian', master: true, permissions: [], providers: { discord: { identifier: 'discord:11111111111111111', data: {} }, citizenfx: { identifier: 'fivem:1001', data: { secret: 'x' } } } },
                { name: 'casey', master: false, permissions: ['players.ban'], providers: {} },
            ],
        },
        cacheStore: { get: () => undefined },
        logger: { admin: { write: () => { } } },
        fxRunner,
        fxResources: { resourceReport },
        fxPlayerlist: {
            onlineCount: 1,
            licenseCache: [],
            getPlayerList: () => [{ netid: 7, displayName: 'Alice', pureName: 'alice', license: LIC_A }],
            getOnlinePlayersLicenses: () => new Set([LIC_A]),
            getOnlinePlayersByLicense: (lic: string) => (lic === LIC_A ? [onlinePlayer] : []),
            getPlayerById: () => undefined,
        },
        database: {
            isReady: true,
            getDboRef: () => ({ chain: lodashChain(dbData) }),
            players: {
                findOne: (lic: string) => players.find((p) => p.license === lic) ?? null,
                findMany: (filter: any) => matchesFilter(players, filter),
            },
            actions: {
                findOne: (id: string) => actions.find((a) => a.id === id) ?? null,
                findMany: (ids: string[], hwids?: string[]) => actions.filter((a) =>
                    ids.some((id) => a.ids.includes(id))
                    || (hwids?.length && 'hwids' in a && a.hwids?.some((h) => hwids.includes(h)))),
            },
            whitelist: {
                findManyApprovals: () => [...dbData.whitelistApprovals],
                findManyRequests: () => [...dbData.whitelistRequests],
            },
            stats: {
                getPlayersStats: () => ({ total: 3, playedLast24h: 3, joinedLast24h: 2, joinedLast7d: 2 }),
                getActionStats: () => ({ totalWarns: 1, warnsLast7d: 1, totalBans: 2, bansLast7d: 2, groupedByAdmins: { julian: 2, casey: 1 } }),
            },
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

const get = async (route: string, bearer = token) => {
    const resp = await fetch(baseUrl + route, { headers: { Authorization: `Bearer ${bearer}` } });
    return { status: resp.status, json: await resp.json().catch(() => null) };
};


describe('GET /api/v1/status', () => {
    it('reports server, scheduler and discord state', async () => {
        const r = await get('/api/v1/status');
        expect(r.status).toBe(200);
        expect(r.json.data.server.health).toBe('ONLINE');
        expect(r.json.data.server.playerCount).toBe(1);
        expect(r.json.data.server.joinLink).toContain('abc123');
        expect(r.json.data.scheduler.nextRestartAt).toBeGreaterThan(Date.now());
        expect(r.json.data.discord.status).toBe('ready');
        expect(r.json.data.txAdmin.version).toBeTypeOf('string');
    });
});


describe('players', () => {
    it('lists online players', async () => {
        const r = await get('/api/v1/players/online');
        expect(r.status).toBe(200);
        expect(r.json.data.players).toEqual([{ netid: 7, displayName: 'Alice', pureName: 'alice', license: LIC_A }]);
    });

    it('returns stats with the online count', async () => {
        const r = await get('/api/v1/players/stats');
        expect(r.json.data).toEqual({ total: 3, playedLast24h: 3, joinedLast24h: 2, joinedLast7d: 2, onlineNow: 1 });
    });

    it('searches and paginates with a cursor', async () => {
        const first = await get('/api/v1/players?sort=playTime&order=desc&limit=2');
        expect(first.status).toBe(200);
        expect(first.json.data.players.map((p: any) => p.displayName)).toEqual(['Alice', 'Carol']);
        expect(first.json.meta.nextCursor).toBeTypeOf('string');
        expect(first.json.data.players[0]).toMatchObject({
            isAdmin: true, isOnline: true, notes: 'nice player', whitelistedAt: (nowSec - 50_000) * 1000,
        });

        const second = await get(`/api/v1/players?sort=playTime&order=desc&limit=2&cursor=${first.json.meta.nextCursor}`);
        expect(second.json.data.players.map((p: any) => p.displayName)).toEqual(['Bob']);
        expect(second.json.meta.nextCursor).toBeNull();
    });

    it('filters and searches by name, ids and notes', async () => {
        expect((await get('/api/v1/players?filter=isOnline')).json.data.players).toHaveLength(1);
        expect((await get('/api/v1/players?filter=isWhitelisted,isAdmin')).json.data.players[0].license).toBe(LIC_A);
        expect((await get('/api/v1/players?q=bob')).json.data.players[0].displayName).toBe('Bob');
        expect((await get('/api/v1/players?q=discord:33333333333333333&type=ids')).json.data.players[0].displayName).toBe('Carol');
        expect((await get('/api/v1/players?q=nice&type=notes')).json.data.players[0].displayName).toBe('Alice');

        const badFilter = await get('/api/v1/players?filter=isBanned');
        expect(badFilter.status).toBe(400);
        const badIds = await get('/api/v1/players?q=zzz:123&type=ids');
        expect(badIds.status).toBe(400);
        const badCursor = await get('/api/v1/players?cursor=%%%');
        expect(badCursor.status).toBe(400);
        const badLimit = await get('/api/v1/players?limit=9999');
        expect(badLimit.status).toBe(400);
    });

    it('returns a player with its session and history, or 404', async () => {
        const online = await get(`/api/v1/players/${LIC_A}`);
        expect(online.status).toBe(200);
        expect(online.json.data.player.session.netid).toBe(7);
        expect(online.json.data.player.ids).toContain('discord:11111111111111111');
        expect(online.json.data.player.notesLastEditedBy).toBe('julian');
        expect(online.json.data.player.actions.map((a: any) => a.id)).toEqual(['BAN1-AAAA']);
        expect(online.json.data.player.actions[0].banStatus).toBe('permanent');

        const offline = await get(`/api/v1/players/${LIC_B}`);
        expect(offline.json.data.player.session).toBeNull();
        expect(offline.json.data.player.actions[0].type).toBe('warn');

        expect((await get(`/api/v1/players/${'f'.repeat(40)}`)).status).toBe(404);
        expect((await get('/api/v1/players/not-a-license')).status).toBe(400);
    });
});


describe('actions', () => {
    it('lists newest first with ban status and revocation', async () => {
        const r = await get('/api/v1/actions');
        expect(r.status).toBe(200);
        expect(r.json.data.actions.map((a: any) => a.id)).toEqual(['BAN1-AAAA', 'WARN-BBBB', 'BAN2-CCCC']);
        const expired = r.json.data.actions[2];
        expect(expired).toMatchObject({ banStatus: 'expired', revokedBy: 'mecauz', expiresAt: (nowSec - 100) * 1000 });
        expect(r.json.data.actions[1]).toMatchObject({ type: 'warn', acked: true, banStatus: null });
    });

    it('filters by kind, author, status and search', async () => {
        expect((await get('/api/v1/actions?kind=warn')).json.data.actions).toHaveLength(1);
        expect((await get('/api/v1/actions?author=julian')).json.data.actions).toHaveLength(2);
        expect((await get('/api/v1/actions?status=revoked')).json.data.actions[0].id).toBe('BAN2-CCCC');
        expect((await get('/api/v1/actions?q=cheat&type=reason')).json.data.actions[0].id).toBe('BAN1-AAAA');
        expect((await get('/api/v1/actions?q=ban2&type=id')).json.data.actions[0].id).toBe('BAN2-CCCC');
        expect((await get(`/api/v1/actions?q=license:${LIC_B}`)).json.data.actions[0].id).toBe('WARN-BBBB');
    });

    it('paginates ascending with a cursor', async () => {
        const first = await get('/api/v1/actions?order=asc&limit=1');
        expect(first.json.data.actions[0].id).toBe('BAN2-CCCC');
        const second = await get(`/api/v1/actions?order=asc&limit=1&cursor=${first.json.meta.nextCursor}`);
        expect(second.json.data.actions[0].id).toBe('WARN-BBBB');
    });

    it('returns stats and single actions', async () => {
        const stats = await get('/api/v1/actions/stats');
        expect(stats.json.data.totalBans).toBe(2);
        expect(stats.json.data.byAdmin).toEqual([{ name: 'casey', actions: 1 }, { name: 'julian', actions: 2 }]);

        expect((await get('/api/v1/actions/warn-bbbb')).json.data.action.id).toBe('WARN-BBBB');
        expect((await get('/api/v1/actions/NOPE')).status).toBe(404);
    });
});


describe('whitelist', () => {
    it('lists approvals and requests in epoch ms', async () => {
        const approvals = await get('/api/v1/whitelist/approvals');
        expect(approvals.json.data.approvals.map((a: any) => a.identifier)).toEqual(['discord:11111111111111111', `license:${LIC_B}`]);
        expect(approvals.json.data.approvals[0].approvedAt).toBe((nowSec - 10) * 1000);
        expect((await get('/api/v1/whitelist/approvals?q=bob')).json.data.approvals[0].playerName).toBe('Bob');

        const requests = await get('/api/v1/whitelist/requests');
        expect(requests.json.data.requests[0]).toMatchObject({ id: 'R0001', discordTag: 'carol#1' });
        expect((await get('/api/v1/whitelist/requests?q=nobody')).json.data.requests).toHaveLength(0);
    });
});


describe('admins and resources', () => {
    it('lists admins without secrets, only for manage.admins', async () => {
        const r = await get('/api/v1/admins');
        expect(r.status).toBe(200);
        expect(r.json.data.admins[0]).toEqual({ name: 'julian', master: true, permissions: [], identifiers: ['discord:11111111111111111', 'fivem:1001'] });
        expect(JSON.stringify(r.json)).not.toContain('secret');
        expect((await get('/api/v1/admins', limitedToken)).status).toBe(403);
    });

    it('other reads work with any valid key', async () => {
        expect((await get('/api/v1/status', limitedToken)).status).toBe(200);
        expect((await get('/api/v1/players/online', limitedToken)).status).toBe(200);
    });

    it('returns the resource report relative to the data path', async () => {
        const r = await get('/api/v1/resources');
        expect(r.status).toBe(200);
        expect(r.json.data.resources).toEqual([
            { name: 'ef-core', status: 'started', path: 'resources/[ef]/ef-core', version: '1.2.0', author: 'Everfall', description: null },
            { name: 'monitor', status: 'started', path: '/opt/fx/citizen/system_resources/monitor', version: null, author: null, description: null },
        ]);
    });

    it('returns 503 when the server is offline', async () => {
        const alive = (txCore.fxRunner.child as any).isAlive;
        (txCore.fxRunner.child as any).isAlive = false;
        const r = await get('/api/v1/resources');
        (txCore.fxRunner.child as any).isAlive = alive;
        expect(r.status).toBe(503);
        expect(r.json.error.code).toBe('SERVER_OFFLINE');
    });
});
