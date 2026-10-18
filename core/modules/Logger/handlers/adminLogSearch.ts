import { ADMIN_LOG_CATEGORIES, type AdminLogCategory, type AdminLogEntry } from '@shared/adminLogApiTypes';
import { LogClock, listLogFiles, readLines, takeNewestPage, type LogFileInfo } from './serverLogSearch';

/*
    Admin log (audit log) search over the admin log files on disk.

    AdminLogger writes `[HH:MM:ss][author] message` lines with the same dividers as the
    server log, so the date comes from LogClock. Messages can span lines (announcements,
    DMs): a line without the time prefix continues the previous entry.
    The category is inferred from the message text (see inferAdminLogCategory).
*/

export const ADMIN_LOG_RESULT_CAP = 500;

export type AdminLogSearchQuery = {
    text?: string;
    admin?: string;
    categories?: AdminLogCategory[];
    from?: number;
    to?: number;
};

const lineRegex = /^\[(\d{1,2}):(\d{2}):(\d{2})\]\[([^\]]*)\] ?(.*)$/;
//game resources log moderation as `[resource] message`
const resourcePrefixRegex = /^\[[^\]]*\] /;
const systemAuthors = new Set(['MONITOR', 'SYSTEM', 'SCHEDULER']);
const serverCommandRegex = /^executed "(RESTART|STOP|START) SERVER"$/;

const categoryRules: [AdminLogCategory, RegExp][] = [
    ['login', /^(logged in from |Changing own |Modified own identifiers)/],
    ['ban', /^(Banned |Imported ban |Changed the length of ban |Set the appeal of ban )/],
    ['warn', /^Warned /],
    ['server', /^(Kicking all players|Sending announcement|Scheduling server restart|Restarting server|Exiting to load)|next scheduled restart/],
    ['kick', /^Kicked /],
    ['revoke', /^Revoked \w+ id /],
    //game scripts: exports.monitor:RecordSanction
    ['sanction', /^Recorded .+ for "/],
    ['note', /^(Added a note to |Edited note |Deleted note |Moved note |Set notes for )/],
    ['whitelist', /whitelist/i],
    ['player', /^(DM to |Deleted IDs|Set tags for )| the watchlist/],
    ['resource', /^(Restarted|Started|Ensured|Stopped|Refreshed) resource/],
    ['admins', /^(Adding|Editing|Deleting) (user|admin) /],
    ['api', /API key|webhook/],
    ['settings', /^(Config changes|Changing )/],
];

/**
 * Infers the category of an admin log entry from its author and message.
 */
export function inferAdminLogCategory(author: string, msg: string): AdminLogCategory {
    const text = msg.replace(resourcePrefixRegex, '');
    if (serverCommandRegex.test(text)) return 'server';
    if (text.startsWith('executed "')) return 'command';
    for (const [category, regex] of categoryRules) {
        if (regex.test(text)) return category;
    }
    return systemAuthors.has(author) ? 'system' : 'other';
}

const validCategories = new Set<string>(ADMIN_LOG_CATEGORIES.map((c) => c.key));
export const isAdminLogCategory = (value: string): value is AdminLogCategory => validCategories.has(value);


/**
 * Reads the entries of one admin log file, in order.
 */
async function* readEntries(file: LogFileInfo) {
    const clock = new LogClock(new Date(file.startTs || file.mtimeTs));
    let pending: { ts: number; author: string; msg: string } | null = null;
    for await (const line of readLines(file.filePath)) {
        if (clock.readDivider(line)) continue;
        const match = lineRegex.exec(line);
        const ts = match && clock.stamp(match[1], match[2], match[3], undefined);
        if (match && ts !== null) {
            if (pending) yield pending;
            pending = { ts, author: match[4], msg: match[5] };
        } else if (pending && line && !line.startsWith('====')) {
            pending.msg += `\n${line}`;
        }
    }
    if (pending) yield pending;
}


/**
 * Searches the admin log files, newest first, and returns the newest page of matches.
 * `admin` and `text` match case-insensitive substrings.
 */
export async function searchAdminLog(basePath: string, query: AdminLogSearchQuery, cap = ADMIN_LOG_RESULT_CAP) {
    const text = query.text?.trim().toLowerCase() || undefined;
    const admin = query.admin?.trim().toLowerCase() || undefined;
    const categories = query.categories?.length ? new Set(query.categories) : undefined;
    const from = query.from ?? -Infinity;
    const to = query.to ?? Infinity;

    //newest file first, each chunk chronological
    const chunks: AdminLogEntry[][] = [];
    let collected = 0;
    for (const file of await listLogFiles(basePath, 'admin')) {
        if (collected > cap) break;
        if (file.mtimeTs < from || file.startTs > to) continue;
        const found: AdminLogEntry[] = [];
        for await (const entry of readEntries(file)) {
            if (entry.ts > to) break;
            if (entry.ts < from) continue;
            if (admin && !entry.author.toLowerCase().includes(admin)) continue;
            if (text && !entry.msg.toLowerCase().includes(text)) continue;
            const category = inferAdminLogCategory(entry.author, entry.msg);
            if (categories && !categories.has(category)) continue;
            found.push({ ...entry, category });
        }
        chunks.push(found);
        collected += found.length;
    }

    return takeNewestPage(chunks.reverse().flat(), cap);
}
