import { customAlphabet } from 'nanoid';
import dict49 from 'nanoid-dictionary/nolookalikes';

/**
 * Admin groups: admins are assigned to groups, and groups carry the permissions.
 * An admin's permissions are the union of their groups' permissions (the master account has all).
 */
export const ADMIN_GROUPS_SCHEMA_VERSION = 1;
export const GROUP_NAME_MAX_LENGTH = 32;
export const GROUP_DESC_MAX_LENGTH = 120;

export type AdminGroup = {
    id: string;
    name: string;
    description: string;
    permissions: string[];
};

export type AdminGroupsFile = {
    $schema: number;
    groups: AdminGroup[];
};

type AdminLike = {
    name: string;
    master: boolean;
    permissions: string[];
    groups?: string[];
};

export const genGroupId = customAlphabet(dict49, 10);


/**
 * Keeps only known permissions, deduplicated and in registration order.
 * A set with all_permissions collapses to just all_permissions.
 */
export const normalizePermissions = (perms: string[], registered: string[]) => {
    const wanted = new Set(perms);
    if (wanted.has('all_permissions')) return ['all_permissions'];
    return registered.filter((p) => wanted.has(p));
};


/**
 * Validates the parsed groups file, returning the groups or an error string.
 */
export const parseGroupsFile = (data: unknown): AdminGroup[] | string => {
    if (typeof data !== 'object' || data === null || Array.isArray(data)) return 'not an object';
    const groups = (data as Partial<AdminGroupsFile>).groups;
    if (!Array.isArray(groups)) return 'missing groups array';
    const seenIds = new Set<string>();
    for (const group of groups) {
        if (typeof group !== 'object' || group === null) return 'invalid group';
        if (typeof group.id !== 'string' || !group.id.length) return 'group without id';
        if (seenIds.has(group.id)) return `duplicated group id ${group.id}`;
        seenIds.add(group.id);
        if (typeof group.name !== 'string' || !group.name.trim().length) return `group ${group.id} without name`;
        if (!Array.isArray(group.permissions) || group.permissions.some((p) => typeof p !== 'string')) {
            return `group ${group.id} with invalid permissions`;
        }
        if (typeof group.description !== 'string') group.description = '';
    }
    return groups;
};


/**
 * Returns the permissions an admin has through their groups.
 */
export const getEffectivePermissions = (admin: AdminLike, groupsById: Map<string, AdminGroup>) => {
    if (admin.master) return ['all_permissions'];
    const perms = new Set<string>();
    for (const groupId of admin.groups ?? []) {
        const group = groupsById.get(groupId);
        if (!group) continue;
        for (const perm of group.permissions) perms.add(perm);
    }
    if (perms.has('all_permissions')) return ['all_permissions'];
    return [...perms];
};


/**
 * Picks a name for a group created from an existing permission set.
 */
const suggestGroupName = (perms: string[]) => {
    if (perms.includes('all_permissions')) return 'Administrator';
    if (perms.some((p) => ['manage.admins', 'settings.write', 'console.write'].includes(p))) return 'Management';
    if (perms.includes('players.ban')) return 'Moderator';
    return 'Support';
};


/**
 * Turns the old per-admin permissions into groups.
 * Admins with the exact same permissions share a group, so nobody gains or loses access.
 * Mutates the admins (sets `groups`) and returns the new groups.
 */
export const migratePermissionsToGroups = (
    admins: AdminLike[],
    registered: string[],
    genId: () => string = genGroupId,
) => {
    const bySet = new Map<string, { perms: string[], members: AdminLike[] }>();
    for (const admin of admins) {
        if (!Array.isArray(admin.groups)) admin.groups = [];
        if (admin.master) continue;
        //unknown permissions are kept, so a newer build's permissions survive a rollback
        const known = normalizePermissions(admin.permissions, registered);
        const unknown = admin.permissions.filter((p) => !registered.includes(p));
        const perms = known.includes('all_permissions') ? known : [...known, ...[...new Set(unknown)].sort()];
        if (!perms.length) continue;
        const key = perms.join(',');
        const entry = bySet.get(key) ?? { perms, members: [] };
        entry.members.push(admin);
        bySet.set(key, entry);
    }

    //Biggest permission sets first, so "Management" is the most powerful one and "Management 2" the next
    const sets = [...bySet.values()].sort((a, b) => {
        const aAll = a.perms.includes('all_permissions') ? 1 : 0;
        const bAll = b.perms.includes('all_permissions') ? 1 : 0;
        return (bAll - aAll) || (b.perms.length - a.perms.length) || (b.members.length - a.members.length);
    });

    const groups: AdminGroup[] = [];
    const nameCounts = new Map<string, number>();
    for (const { perms, members } of sets) {
        const baseName = suggestGroupName(perms);
        const count = (nameCounts.get(baseName) ?? 0) + 1;
        nameCounts.set(baseName, count);
        const memberNames = members.map((m) => m.name).join(', ');
        const group: AdminGroup = {
            id: genId(),
            name: count === 1 ? baseName : `${baseName} ${count}`,
            description: `Made from the permissions ${memberNames} had before groups.`.slice(0, GROUP_DESC_MAX_LENGTH),
            permissions: perms,
        };
        groups.push(group);
        for (const member of members) member.groups!.push(group.id);
    }
    return groups;
};


/**
 * Adds groups made by migratePermissionsToGroups to an existing list.
 * A new group with the same permissions as an existing one is replaced by it on its members.
 * Mutates both the groups list and the members. Returns how many groups were added.
 */
export const mergeMigratedGroups = (
    groups: AdminGroup[],
    newGroups: AdminGroup[],
    members: AdminLike[],
) => {
    const permsKey = (g: AdminGroup) => [...g.permissions].sort().join(',');
    let added = 0;
    for (const newGroup of newGroups) {
        const existing = groups.find((g) => permsKey(g) === permsKey(newGroup));
        if (existing) {
            for (const member of members) {
                member.groups = member.groups!.map((id) => id === newGroup.id ? existing.id : id);
            }
            continue;
        }
        let name = newGroup.name;
        for (let i = 2; groups.some((g) => g.name.toLowerCase() === name.toLowerCase()); i++) {
            name = `${newGroup.name} ${i}`;
        }
        groups.push({ ...newGroup, name });
        added++;
    }
    return added;
};
