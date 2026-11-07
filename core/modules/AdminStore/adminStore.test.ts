import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import AdminStore from '@modules/AdminStore';

const HASH = '$2a$11$abcdefghijklmnopqrstuuK2Qx2b0Zp9V6Ew1H3lTjv3l5r2V8bW.';
let tmpDir: string;
let store: AdminStore;

//The constructor needs the real host config, so the fields it sets are filled in here
const makeStore = () => {
    const instance = Object.create(AdminStore.prototype);
    Object.assign(instance, {
        adminsFile: path.join(tmpDir, 'admins.json'),
        groupsFile: path.join(tmpDir, 'adminGroups.json'),
        admins: null,
        groups: [],
        providers: { discord: false, citizenfx: {} },
        registeredPermissions: {
            'all_permissions': 'All', 'manage.admins': 'Manage Admins', 'console.view': 'Console',
            'players.warn': 'Warn', 'players.kick': 'Kick', 'players.ban': 'Ban',
        },
    });
    return instance as AdminStore;
};

const writeAdmins = (admins: object[]) => fs.writeFileSync(path.join(tmpDir, 'admins.json'), JSON.stringify(admins));
const readJson = (file: string) => JSON.parse(fs.readFileSync(path.join(tmpDir, file), 'utf8'));
const admin = (name: string, permissions: string[], extra = {}) => ({
    $schema: 1, name, master: false, password_hash: HASH, providers: {}, permissions, ...extra,
});

beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'txtest-admins-'));
    store = makeStore();
    vi.stubGlobal('txCore', {
        webServer: { webSocket: { reCheckAdminAuths: vi.fn().mockResolvedValue(undefined) } },
        fxRunner: { sendEvent: vi.fn() },
        fxPlayerlist: { getAssociatedOnlineNetIds: () => ({ idsFound: [] }), getPlayerList: () => [] },
    });
});
afterEach(() => {
    vi.unstubAllGlobals();
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('AdminStore groups', () => {
    it('moves existing permissions into groups on first load without changing anyone\'s access', async () => {
        writeAdmins([
            admin('owner', [], { master: true }),
            admin('modA', ['players.ban', 'players.kick']),
            admin('modB', ['players.kick', 'players.ban']),
            admin('helper', ['players.warn']),
        ]);
        await store.loadAdminsFile();

        const groups = readJson('adminGroups.json').groups;
        expect(groups.map((g: any) => g.name)).toEqual(['Moderator', 'Support']);
        expect(store.getAdminByName('modA').permissions).toEqual(['players.kick', 'players.ban']);
        expect(store.getAdminByName('modA').groups).toEqual(store.getAdminByName('modB').groups);
        expect(store.getAdminByName('helper').permissions).toEqual(['players.warn']);

        //admins.json keeps the resolved permissions for older builds, plus the groups
        const saved = readJson('admins.json');
        expect(saved[1].groups).toEqual([groups[0].id]);
        expect(saved[1].permissions).toEqual(['players.kick', 'players.ban']);
    });

    it('changes members\' permissions when their group changes, and drops deleted groups', async () => {
        writeAdmins([admin('owner', [], { master: true }), admin('mod', ['players.ban'])]);
        await store.loadAdminsFile();
        const [group] = store.getGroupsList();
        expect(group.members).toEqual(['mod']);

        await store.editGroup(group.id, { name: 'Moderator', description: '', permissions: ['players.ban', 'players.warn', 'bogus'] });
        expect(store.getAdminByName('mod').permissions).toEqual(['players.warn', 'players.ban']);
        expect(readJson('admins.json')[1].permissions).toEqual(['players.warn', 'players.ban']);

        const support = await store.addGroup({ name: 'Support', permissions: ['console.view'] });
        await store.setGroupMembers(support.id, ['MOD', 'owner']);
        expect(store.getAdminByName('mod').permissions.sort()).toEqual(['console.view', 'players.ban', 'players.warn']);
        expect(store.getAdminByName('owner').groups).toEqual([]);

        await expect(store.addGroup({ name: 'support', permissions: [] })).rejects.toThrow('already a group');

        await store.deleteGroup(group.id);
        expect(store.getAdminByName('mod').permissions).toEqual(['console.view']);
        expect(readJson('admins.json')[1].groups).toEqual([support.id]);
    });

    it('puts admins without groups into matching groups when the groups file already exists', async () => {
        fs.writeFileSync(path.join(tmpDir, 'adminGroups.json'), JSON.stringify({
            $schema: 1, groups: [{ id: 'mod', name: 'Moderator', description: '', permissions: ['players.ban'] }],
        }));
        writeAdmins([admin('owner', [], { master: true }), admin('restored', ['players.ban']), admin('other', ['players.warn'])]);
        await store.loadAdminsFile();
        expect(store.getAdminByName('restored').groups).toEqual(['mod']);
        expect(store.getAdminByName('other').permissions).toEqual(['players.warn']);
        expect(store.getGroupsList().map((g) => g.name)).toEqual(['Moderator', 'Support']);
    });
});
