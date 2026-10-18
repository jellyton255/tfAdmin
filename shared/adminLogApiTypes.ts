import type { GenericApiErrorResp } from "./genericApiTypes";

/**
 * Kinds of admin log entries, inferred from the message (see core/modules/Logger/handlers/adminLogSearch.ts)
 */
export const ADMIN_LOG_CATEGORIES = [
    { key: 'ban', label: 'Bans' },
    { key: 'warn', label: 'Warns' },
    { key: 'kick', label: 'Kicks' },
    { key: 'sanction', label: 'Sanctions' },
    { key: 'revoke', label: 'Revokes' },
    { key: 'note', label: 'Notes' },
    { key: 'player', label: 'Players' },
    { key: 'whitelist', label: 'Allowlist' },
    { key: 'command', label: 'Commands' },
    { key: 'resource', label: 'Resources' },
    { key: 'server', label: 'Server' },
    { key: 'login', label: 'Account' },
    { key: 'admins', label: 'Admins' },
    { key: 'settings', label: 'Settings' },
    { key: 'api', label: 'API Keys' },
    { key: 'system', label: 'System' },
    { key: 'other', label: 'Other' },
] as const;
export type AdminLogCategory = typeof ADMIN_LOG_CATEGORIES[number]['key'];

/**
 * One admin log entry, as written by core/modules/Logger/handlers/admin.js
 */
export type AdminLogEntry = {
    ts: number;
    author: string;
    category: AdminLogCategory;
    msg: string;
};

export type AdminLogSearchResp = {
    //chronological order, oldest first
    log: AdminLogEntry[];
    truncated: boolean;
    //pass as `to` to load the next older page
    cursor: number | null;
} | GenericApiErrorResp;
