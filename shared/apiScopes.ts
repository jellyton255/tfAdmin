/**
 * Scopes an API key can carry. These are what the key creation UI shows and what POST /keys accepts.
 *
 * Every valid key can read (status, players, actions, whitelist, resources, events). A key with no
 * scopes is read-only. Each scope unlocks a group of write routes; the id doubles as the permission
 * string the routes check, so the auth middleware and action log work unchanged.
 *
 * `grantRequires` is the txAdmin admin permission the *issuer* must hold to hand out the scope
 * (no privilege escalation); null means any key manager can grant it.
 */
export type ApiScopeInfo = {
    id: string;
    label: string;
    description: string;
    grantRequires: string | null;
};

export const API_SCOPE_ALL = 'all_permissions';

export const API_SCOPES: readonly ApiScopeInfo[] = [
    {
        id: 'players.ban',
        label: 'Ban players',
        description: 'Ban players or raw identifiers, and revoke bans.',
        grantRequires: 'players.ban',
    },
    {
        id: 'players.warn',
        label: 'Warn players',
        description: 'Warn players and revoke warnings.',
        grantRequires: 'players.warn',
    },
    {
        id: 'players.kick',
        label: 'Kick players',
        description: 'Kick an online player.',
        grantRequires: 'players.kick',
    },
    {
        id: 'players.direct_message',
        label: 'Message players',
        description: 'Send a direct message to an online player.',
        grantRequires: 'players.direct_message',
    },
    {
        id: 'players.note',
        label: 'Edit player notes',
        description: 'Set the admin note on a player.',
        grantRequires: null,
    },
    {
        id: 'players.whitelist',
        label: 'Manage whitelist',
        description: 'Whitelist players, approve or deny requests, add or remove approvals.',
        grantRequires: 'players.whitelist',
    },
    {
        id: 'api.actor',
        label: 'Act for staff members',
        description: 'Name the staff member behind each write with the X-TxAdmin-Actor header; the action log then reads "<staff> (via api:<key>)".',
        grantRequires: null,
    },
    {
        id: 'announcement',
        label: 'Send announcements',
        description: 'Broadcast an announcement to everyone online.',
        grantRequires: 'announcement',
    },
    {
        id: 'control.server',
        label: 'Control the server',
        description: 'Start, stop or restart the server and kick everyone.',
        grantRequires: 'control.server',
    },
    {
        id: 'console.write',
        label: 'Run console commands',
        description: 'Execute arbitrary commands in the server console.',
        grantRequires: 'console.write',
    },
    {
        id: 'commands.resources',
        label: 'Manage resources',
        description: 'Refresh, start, stop, restart or ensure resources.',
        grantRequires: 'commands.resources',
    },
    {
        id: 'manage.admins',
        label: 'Manage API keys and webhooks',
        description: 'Create and revoke keys, manage webhooks, and list the admin roster.',
        grantRequires: 'manage.admins',
    },
    {
        id: API_SCOPE_ALL,
        label: 'Full access',
        description: 'Every scope, including ones added in future versions.',
        grantRequires: API_SCOPE_ALL,
    },
];

export const API_SCOPE_IDS = new Set(API_SCOPES.map((s) => s.id));

export const getApiScope = (id: string) => API_SCOPES.find((s) => s.id === id) ?? null;
