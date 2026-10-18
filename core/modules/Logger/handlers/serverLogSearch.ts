import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { shortenId } from '@shared/utils';
import type { ServerLogEventType } from '@shared/serverLogApiTypes';

/*
    Server log search over the in-memory buffer and the log files on disk.

    The file lines are written by ServerLogger.processEvent() as `[localeTime] src: msg`.
    They carry neither the date nor the event type, so:
    - the date comes from the `========` dividers (written on boot and on every rotation),
      falling back to the file name, and moves forward one day when the time of day wraps;
    - the type is inferred from the message text (see inferEventType).
    Player identifiers only appear (shortened) in the join lines, so an identifier search
    follows the `mutex#netid` session of every matching join.
*/

export const SEARCH_RESULT_CAP = 500;
export const SEARCH_BYTE_BUDGET = 128 * 1024 * 1024;

export type ServerLogSearchQuery = {
    text?: string;
    player?: string;
    types?: string[];
    from?: number;
    to?: number;
};

export type ServerLogSearchResult = {
    //chronological order, oldest first
    log: ServerLogEventType[];
    truncated: boolean;
    //pass as `to` to load the next older page
    cursor: number | null;
};


//MARK: Line parsing
const timeRegex = /^\[(\d{1,2}):(\d{2}):(\d{2})(?:[\s  ]?([AaPp])\.?\s?[Mm]\.?)?\] (.*)$/;
const playerSrcRegex = /^\[([^\]\s#]+#\d+)\] (.*?): (.*)$/;
const otherSrcRegex = /^(.*?): (.*)$/;
const dividerRegex = /^======== .* - (\d{1,2})\/(\d{1,2})\/(\d{4}), (\d{1,2}):(\d{2}):(\d{2})(?:[\s  ]?([AaPp])[Mm])?\s*$/;
const DAY_SECONDS = 24 * 60 * 60;
//A time going backwards by less than this is a clock change, not a new day
const ROLLOVER_THRESHOLD_SECONDS = 2 * 60 * 60;

function toSecondOfDay(hours: string, minutes: string, seconds: string, meridiem: string | undefined) {
    let h = parseInt(hours);
    if (meridiem) {
        const isPm = meridiem.toLowerCase() === 'p';
        if (h === 12) h = 0;
        if (isPm) h += 12;
    }
    return h * 3600 + parseInt(minutes) * 60 + parseInt(seconds);
}

/**
 * Infers the event type from a message, mirroring ServerLogger.processEvent()
 */
export function inferEventType(isPlayer: boolean, msg: string) {
    if (msg.startsWith('joined with identifiers ')) return 'playerJoining';
    if (msg.startsWith('player join denied due to ')) return 'playerJoinDenied';
    if (msg.startsWith('disconnected (')) return 'playerDropped';
    if (msg.startsWith('said "') || /^\(.*\): said "/.test(msg)) return 'ChatMessage';
    if (msg.startsWith('died from ')) return 'DeathNotice';
    if (msg.startsWith('caused an explosion (')) return 'explosionEvent';
    if (msg.startsWith('executed: /')) return 'CommandExecuted';
    if (msg === 'Logger started') return 'LoggerStarted';
    if (msg.startsWith('Debug Message: ')) return 'DebugMessage';
    return isPlayer ? 'MenuEvent' : 'Unknown';
}

/**
 * Tracks the date while reading the lines of one log file from the start.
 * Shared by every log written with `[time]` prefixes and getLogDivider() dividers.
 */
export class LogClock {
    private dayStart: Date;
    private lastSecond: number | null = null;

    constructor(fallbackDayStart: Date) {
        this.dayStart = new Date(fallbackDayStart.getFullYear(), fallbackDayStart.getMonth(), fallbackDayStart.getDate());
    }

    /**
     * Returns true when the line is a divider, which sets the date.
     */
    readDivider(line: string) {
        const divider = dividerRegex.exec(line);
        if (!divider) return false;
        const [, month, day, year, h, m, s, meridiem] = divider;
        this.dayStart = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
        this.lastSecond = toSecondOfDay(h, m, s, meridiem);
        return true;
    }

    /**
     * Returns the timestamp of a line's time of day, or null when it is not a valid time.
     */
    stamp(hours: string, minutes: string, seconds: string, meridiem: string | undefined) {
        const secondOfDay = toSecondOfDay(hours, minutes, seconds, meridiem);
        if (secondOfDay >= DAY_SECONDS) return null;
        if (this.lastSecond !== null && secondOfDay < this.lastSecond - ROLLOVER_THRESHOLD_SECONDS) {
            this.dayStart = new Date(this.dayStart.getFullYear(), this.dayStart.getMonth(), this.dayStart.getDate() + 1);
        }
        this.lastSecond = secondOfDay;
        return new Date(
            this.dayStart.getFullYear(),
            this.dayStart.getMonth(),
            this.dayStart.getDate(),
            0,
            0,
            secondOfDay,
        ).getTime();
    }
}

/**
 * Stateful parser for the lines of one log file, read from the start.
 */
export class LogFileLineParser {
    private clock: LogClock;

    constructor(fallbackDayStart: Date) {
        this.clock = new LogClock(fallbackDayStart);
    }

    /**
     * Returns the event of a line, or null for dividers, blank and unparseable lines.
     */
    parse(line: string): ServerLogEventType | null {
        if (this.clock.readDivider(line)) return null;

        const timeMatch = timeRegex.exec(line);
        if (!timeMatch) return null;
        const [, h, m, s, meridiem, rest] = timeMatch;
        const ts = this.clock.stamp(h, m, s, meridiem);
        if (ts === null) return null;

        const playerMatch = playerSrcRegex.exec(rest);
        if (playerMatch) {
            const [, id, name, msg] = playerMatch;
            return { ts, type: inferEventType(true, msg), src: { id, name }, msg };
        }
        const otherMatch = otherSrcRegex.exec(rest);
        if (!otherMatch) return null;
        const [, name, msg] = otherMatch;
        return { ts, type: inferEventType(false, msg), src: { id: false, name }, msg };
    }
}


//MARK: Matching
/**
 * Returns the lowercased identifier if the player query is one.
 * A bare 40 hex string is taken as a license.
 */
export function playerQueryToId(player: string) {
    const lower = player.trim().toLowerCase();
    if (/^[0-9a-f]{40}$/.test(lower)) return `license:${lower}`;
    const [idType, idValue] = lower.split(':', 2);
    if (!idType || !idValue || /\s/.test(lower)) return null;
    return lower;
}

function joinedIdsContain(msg: string, shortId: string) {
    const listMatch = /^joined with identifiers \[(.*)\]$/.exec(msg);
    if (!listMatch) return false;
    return listMatch[1].toLowerCase().split(', ').includes(shortId);
}

/**
 * Creates a stateful matcher. Events must be fed in chronological order, so a player
 * identifier match on a join line also matches the later events of that session.
 */
export function createEventMatcher(query: ServerLogSearchQuery, seedSessionIds: string[] = []) {
    const text = query.text?.trim().toLowerCase() || undefined;
    const types = query.types?.length ? new Set(query.types) : undefined;
    const player = query.player?.trim().toLowerCase() || undefined;
    const playerId = player ? playerQueryToId(player) : null;
    //join lines only contain shortened identifiers
    const shortId = playerId ? shortenId(playerId) : null;
    const sessions = new Set(seedSessionIds);
    const from = query.from ?? -Infinity;
    const to = query.to ?? Infinity;

    function matchesPlayer(event: ServerLogEventType) {
        if (!player) return true;
        const srcId = event.src.id;
        if (shortId && srcId && event.type === 'playerJoining' && joinedIdsContain(event.msg, shortId)) {
            sessions.add(srcId);
        }
        if (srcId && (sessions.has(srcId) || srcId.toLowerCase() === player)) return true;
        return !shortId && event.src.name.toLowerCase().includes(player);
    }

    return function matches(event: ServerLogEventType) {
        //session tracking must see every event, even the ones outside the other filters
        const playerOk = matchesPlayer(event);
        if (!playerOk) return false;
        if (event.ts < from || event.ts > to) return false;
        if (types && !types.has(event.type)) return false;
        if (text && !event.msg.toLowerCase().includes(text)) return false;
        return true;
    };
}


//MARK: Collection
/**
 * Keeps the newest `capacity` items pushed in chronological order.
 */
class NewestItems {
    items: ServerLogEventType[] = [];
    overflowed = false;
    constructor(private readonly capacity: number) { }
    push(item: ServerLogEventType) {
        this.items.push(item);
        if (this.items.length > this.capacity) {
            this.items.shift();
            this.overflowed = true;
        }
    }
}

/**
 * Searches an in-memory chronological event list.
 */
export function searchEventList(
    events: ServerLogEventType[],
    query: ServerLogSearchQuery,
    capacity: number,
    seedSessionIds: string[] = [],
) {
    const matches = createEventMatcher(query, seedSessionIds);
    const found = new NewestItems(capacity);
    for (const event of events) {
        if (event.ts > (query.to ?? Infinity)) break;
        if (matches(event)) found.push(event);
    }
    return found;
}


//MARK: Files
export type LogFileInfo = {
    filePath: string;
    //start of the file's time span, from its name (0 for the active file)
    startTs: number;
    mtimeTs: number;
    size: number;
    sortKey: [number, number];
};

/**
 * Lists the files of a log (active and rotated, such as `server.log` and
 * `server_2026-10-10_00-00-00_1.log`), newest first.
 */
export async function listLogFiles(basePath: string, logName: string) {
    const rotatedNameRegex = new RegExp(`^${logName}_(\\d{4})-(\\d{2})-(\\d{2})_(\\d{2})-(\\d{2})-(\\d{2})(?:_(\\d+))?\\.log$`);
    //persistent logging may be disabled, leaving no folder
    const entries = await fsp.readdir(basePath, { withFileTypes: true }).catch((error: unknown) => {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return [];
        throw error;
    });
    const files: LogFileInfo[] = [];
    for (const entry of entries) {
        if (!entry.isFile()) continue;
        const isActive = entry.name === `${logName}.log`;
        const nameMatch = rotatedNameRegex.exec(entry.name);
        if (!isActive && !nameMatch) continue;
        const filePath = path.join(basePath, entry.name);
        const stat = await fsp.stat(filePath).catch(() => null);
        if (!stat) continue;
        let startTs = 0;
        let index = 0;
        if (nameMatch) {
            const [, y, mo, d, h, mi, s, idx] = nameMatch;
            startTs = new Date(+y, +mo - 1, +d, +h, +mi, +s).getTime();
            index = idx ? parseInt(idx) : 0;
        }
        files.push({
            filePath,
            startTs,
            mtimeTs: stat.mtimeMs,
            size: stat.size,
            sortKey: isActive ? [Infinity, Infinity] : [startTs, index],
        });
    }
    return files.sort((a, b) => b.sortKey[0] - a.sortKey[0] || b.sortKey[1] - a.sortKey[1]);
}

/**
 * Yields the lines of a file without loading it whole. Breaking out of the loop
 * destroys the stream.
 */
export async function* readLines(filePath: string) {
    const stream = fs.createReadStream(filePath, { encoding: 'utf8', highWaterMark: 64 * 1024 });
    let partial = '';
    try {
        for await (const chunk of stream) {
            const lines = (partial + chunk).split('\n');
            partial = lines.pop() ?? '';
            yield* lines;
        }
        if (partial) yield partial;
    } finally {
        stream.destroy();
    }
}

/**
 * Streams one log file line by line and returns its newest matches, and whether
 * any line was inside the `to` bound (a file that is entirely newer is not charged
 * against the byte budget).
 */
export async function searchLogFile(
    file: LogFileInfo,
    query: ServerLogSearchQuery,
    capacity: number,
    seedSessionIds: string[] = [],
) {
    const parser = new LogFileLineParser(new Date(file.startTs || file.mtimeTs));
    const matches = createEventMatcher(query, seedSessionIds);
    const found = new NewestItems(capacity);
    const to = query.to ?? Infinity;
    let inRange = false;
    for await (const line of readLines(file.filePath)) {
        const event = parser.parse(line);
        if (!event) continue;
        if (event.ts > to) break;
        inRange = true;
        if (matches(event)) found.push(event);
    }
    return { items: found.items, inRange };
}


//MARK: Search
/**
 * Searches the recent buffer, then the log files for anything older than the buffer.
 * Stops at the result cap or at the byte budget, and returns a cursor for older pages.
 */
export async function searchServerLog(opts: {
    buffer: ServerLogEventType[];
    basePath: string;
    query: ServerLogSearchQuery;
    seedSessionIds?: string[];
    cap?: number;
    byteBudget?: number;
}): Promise<ServerLogSearchResult> {
    const { buffer, basePath, query, seedSessionIds = [] } = opts;
    const cap = opts.cap ?? SEARCH_RESULT_CAP;
    const byteBudget = opts.byteBudget ?? SEARCH_BYTE_BUDGET;
    const from = query.from ?? -Infinity;

    //newest source first, each chunk chronological
    const chunks: ServerLogEventType[][] = [];
    let collected = 0;
    let budgetCursor: number | null = null;

    const bufferFound = searchEventList(buffer, query, cap + 1, seedSessionIds);
    chunks.push(bufferFound.items);
    collected += bufferFound.items.length;

    //files only cover what is older than the buffer (second precision on disk)
    const oldestBufferTs = buffer.at(0)?.ts;
    const fileCutoff = oldestBufferTs === undefined
        ? Infinity
        : Math.floor(oldestBufferTs / 1000) * 1000 - 1;
    const fileTo = Math.min(query.to ?? Infinity, fileCutoff);
    if (collected <= cap && fileTo >= from) {
        const fileQuery = { ...query, to: fileTo };
        let bytesRead = 0;
        const files = await listLogFiles(basePath, 'server');
        for (const file of files) {
            if (collected > cap) break;
            if (file.mtimeTs < from || file.startTs > fileTo) continue;
            if (bytesRead > 0 && bytesRead + file.size > byteBudget) {
                budgetCursor = Math.min(fileTo, file.mtimeTs);
                break;
            }
            const found = await searchLogFile(file, fileQuery, cap + 1 - collected, seedSessionIds);
            if (found.inRange) bytesRead += file.size;
            chunks.push(found.items);
            collected += found.items.length;
        }
    }

    return takeNewestPage(chunks.reverse().flat(), cap, budgetCursor);
}


/**
 * Turns the chronological matches of a search into its newest page of at most `cap` items.
 * `stopCursor` is where the search stopped early (byte budget), if it did.
 */
export function takeNewestPage<T extends { ts: number }>(all: T[], cap: number, stopCursor: number | null = null) {
    if (all.length <= cap) {
        return {
            log: all,
            truncated: stopCursor !== null,
            cursor: stopCursor,
        };
    }

    //Over the cap: keep the newest. If the page edge splits a same-timestamp group, leave
    // the group out so the next page (to = cursor, inclusive) returns it whole.
    const page = all.slice(-cap);
    const edgeTs = page[0].ts;
    const splitsGroup = all[all.length - cap - 1].ts === edgeTs;
    const withoutEdge = splitsGroup ? page.filter((item) => item.ts !== edgeTs) : [];
    if (withoutEdge.length) {
        return { log: withoutEdge, truncated: true, cursor: edgeTs };
    }
    return { log: page, truncated: true, cursor: edgeTs - 1 };
}
