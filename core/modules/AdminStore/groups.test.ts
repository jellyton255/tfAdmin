import { suite, it, expect } from 'vitest';
import { getEffectivePermissions, mergeMigratedGroups, migratePermissionsToGroups, normalizePermissions, parseGroupsFile } from './groups';

const registered = ['all_permissions', 'manage.admins', 'console.view', 'players.warn', 'players.kick', 'players.ban'];
let idSeq = 0;
const genId = () => `g${++idSeq}`;

suite('migratePermissionsToGroups', () => {
    it('gives admins with the same permissions one shared group and keeps everyone\'s access', () => {
        idSeq = 0;
        const admins = [
            { name: 'owner', master: true, permissions: [] as string[] },
            { name: 'head', master: false, permissions: ['all_permissions', 'players.ban'] },
            { name: 'mgr', master: false, permissions: ['manage.admins', 'players.ban', 'players.kick', 'players.warn'] },
            { name: 'modA', master: false, permissions: ['players.ban', 'players.kick', 'players.warn'] },
            { name: 'modB', master: false, permissions: ['players.warn', 'players.kick', 'players.ban'] },
            { name: 'helper', master: false, permissions: ['players.warn'] },
            { name: 'nothing', master: false, permissions: [] as string[] },
        ];
        const before = new Map(admins.map((a) => [a.name, normalizePermissions(a.permissions, registered).sort()]));
        const groups = migratePermissionsToGroups(admins, registered, genId);

        expect(groups.map((g) => g.name)).toEqual(['Administrator', 'Management', 'Moderator', 'Support']);
        const byName = Object.fromEntries(admins.map((a) => [a.name, a]));
        expect(byName.modA.groups).toEqual(byName.modB.groups);
        expect(byName.owner.groups).toEqual([]);
        expect(byName.nothing.groups).toEqual([]);

        const groupsById = new Map(groups.map((g) => [g.id, g]));
        for (const admin of admins) {
            if (admin.master) continue;
            expect(getEffectivePermissions(admin, groupsById).sort()).toEqual(before.get(admin.name));
        }
    });

    it('numbers groups that would get the same name', () => {
        idSeq = 0;
        const admins = [
            { name: 'a', master: false, permissions: ['players.ban', 'players.kick'] },
            { name: 'b', master: false, permissions: ['players.ban'] },
        ];
        const groups = migratePermissionsToGroups(admins, registered, genId);
        expect(groups.map((g) => g.name)).toEqual(['Moderator', 'Moderator 2']);
    });

    it('keeps permissions this build does not know', () => {
        idSeq = 0;
        const admins = [{ name: 'a', master: false, permissions: ['players.ban', 'future.perm'] }];
        const [group] = migratePermissionsToGroups(admins, registered, genId);
        expect(group.permissions).toEqual(['players.ban', 'future.perm']);
    });
});

suite('getEffectivePermissions', () => {
    const groups = new Map([
        ['mod', { id: 'mod', name: 'Moderator', description: '', permissions: ['players.ban', 'players.kick'] }],
        ['sup', { id: 'sup', name: 'Support', description: '', permissions: ['players.warn', 'players.kick'] }],
        ['adm', { id: 'adm', name: 'Administrator', description: '', permissions: ['all_permissions'] }],
    ]);
    it('combines the permissions of every group', () => {
        const perms = getEffectivePermissions({ name: 'x', master: false, permissions: [], groups: ['mod', 'sup'] }, groups);
        expect(perms.sort()).toEqual(['players.ban', 'players.kick', 'players.warn']);
    });
    it('ignores the old per-admin permissions and deleted groups', () => {
        const perms = getEffectivePermissions({ name: 'x', master: false, permissions: ['manage.admins'], groups: ['gone'] }, groups);
        expect(perms).toEqual([]);
    });
    it('collapses to all_permissions', () => {
        expect(getEffectivePermissions({ name: 'x', master: false, permissions: [], groups: ['mod', 'adm'] }, groups)).toEqual(['all_permissions']);
    });
});

suite('mergeMigratedGroups', () => {
    it('reuses an existing group with the same permissions', () => {
        const groups = [{ id: 'mod', name: 'Moderator', description: '', permissions: ['players.kick', 'players.ban'] }];
        const admins = [
            { name: 'a', master: false, permissions: ['players.ban', 'players.kick'] },
            { name: 'b', master: false, permissions: ['players.warn'] },
        ];
        idSeq = 0;
        const added = mergeMigratedGroups(groups, migratePermissionsToGroups(admins, registered, genId), admins);
        expect(added).toBe(1);
        expect(admins[0].groups).toEqual(['mod']);
        expect(groups.map((g) => g.name)).toEqual(['Moderator', 'Support']);
    });
});

suite('parseGroupsFile', () => {
    it('rejects broken files', () => {
        expect(parseGroupsFile([])).toBeTypeOf('string');
        expect(parseGroupsFile({ groups: [{ id: 'a', name: '', permissions: [] }] })).toBeTypeOf('string');
        expect(parseGroupsFile({ groups: [{ id: 'a', name: 'A', permissions: [] }, { id: 'a', name: 'B', permissions: [] }] })).toBeTypeOf('string');
    });
    it('fills a missing description', () => {
        expect(parseGroupsFile({ groups: [{ id: 'a', name: 'A', permissions: ['x'] }] })).toEqual([{ id: 'a', name: 'A', description: '', permissions: ['x'] }]);
    });
});
