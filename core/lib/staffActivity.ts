import type { DatabaseActionType, DatabasePlayerType, DatabaseStaffPlayDayType } from '@modules/Database/databaseTypes';
import type { StaffActivityCounts, StaffActivityData, StaffActivityMember } from '@shared/staffActivityApiTypes';
import { fetchDiscordActivity, fetchTicketActivity, SOURCE_COUNT_KEYS, type SourceActivityRow } from '@lib/staffActivitySources';

/*
    Staff activity: what each admin did per week, for promotions and spotting inactive staff.
    Weeks are UTC and start on Monday. Action, revocation and note timestamps are in seconds.
    Time online comes from `staffPlayDays`, which players only collect while they are admins.
    Game sanctions (jail, community service) are left out: game scripts record them under their own
    author label, never an admin's name.
    Ticket and Discord counts come from the ticket API and EF Bot, matched by each admin's Discord ID.
*/

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;
export const STAFF_ACTIVITY_MAX_WEEKS = 26;
//a little over the longest range the page can ask for
const STAFF_PLAY_DAYS_KEPT = STAFF_ACTIVITY_MAX_WEEKS * 7 + 7;


/**
 * Returns the play days with one more minute on the current UTC day, dropping days too old to show.
 */
export function addStaffMinute(days: DatabaseStaffPlayDayType[] | undefined, nowMs: number): DatabaseStaffPlayDayType[] {
    const today = new Date(nowMs).toISOString().slice(0, 10);
    const cutoff = new Date(nowMs - STAFF_PLAY_DAYS_KEPT * DAY_MS).toISOString().slice(0, 10);
    const kept = (days ?? []).filter(([day]) => day >= cutoff);
    const last = kept.at(-1);
    if (last && last[0] === today) {
        return [...kept.slice(0, -1), [today, last[1] + 1]];
    }
    return [...kept, [today, 1]];
}


/**
 * Start of the UTC week (Monday 00:00) that contains the timestamp.
 */
export function utcWeekStart(tsMs: number) {
    const date = new Date(tsMs);
    const daysSinceMonday = (date.getUTCDay() + 6) % 7;
    return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - daysSinceMonday);
}

const emptyCounts = (): StaffActivityCounts => ({
    bans: 0,
    warns: 0,
    kicks: 0,
    revokes: 0,
    notes: 0,
    minutesOnline: 0,
    ticketReplies: 0,
    ticketNotes: 0,
    staffThreadMessages: 0,
    ticketsClosed: 0,
    discordMessages: 0,
    voiceMinutes: 0,
});

const actionCountKey = {
    ban: 'bans',
    warn: 'warns',
    kick: 'kicks',
} as const satisfies Partial<Record<DatabaseActionType['type'], keyof StaffActivityCounts>>;

export type StaffActivityAdmin = {
    name: string;
    identifiers: string[];
};


/**
 * Counts each admin's actions, revocations, notes and time in game per week, for the last `weeks` weeks.
 * Only admins on the roster are listed; other authors (API keys, game scripts) are left out.
 */
export function buildStaffActivity(opts: {
    admins: StaffActivityAdmin[];
    actions: DatabaseActionType[];
    players: DatabasePlayerType[];
    weeks: number;
    nowMs: number;
}) {
    const { admins, actions, players, weeks, nowMs } = opts;
    const firstWeek = utcWeekStart(nowMs) - (weeks - 1) * WEEK_MS;
    const weekStarts = Array.from({ length: weeks }, (_, i) => firstWeek + i * WEEK_MS);

    const members = admins.map((admin): StaffActivityMember => ({
        name: admin.name,
        weeks: weekStarts.map(emptyCounts),
        total: emptyCounts(),
        lastActionTs: null,
        lastInGameTs: null,
    }));
    const byName = new Map(members.map((member) => [member.name.toLowerCase(), member]));
    const byIdentifier = new Map<string, StaffActivityMember>();
    admins.forEach((admin, i) => {
        for (const id of admin.identifiers) byIdentifier.set(id.toLowerCase(), members[i]);
    });

    const add = (member: StaffActivityMember, key: keyof StaffActivityCounts, tsMs: number, amount = 1) => {
        const week = Math.floor((tsMs - firstWeek) / WEEK_MS);
        if (week < 0 || week >= weeks) return;
        member.weeks[week][key] += amount;
        member.total[key] += amount;
    };
    const record = (author: string | null | undefined, key: keyof StaffActivityCounts, tsSec: number) => {
        const member = author ? byName.get(author.toLowerCase()) : undefined;
        if (!member) return;
        const tsMs = tsSec * 1000;
        member.lastActionTs = Math.max(member.lastActionTs ?? 0, tsMs);
        add(member, key, tsMs);
    };

    for (const action of actions) {
        if (action.type !== 'sanction') record(action.author, actionCountKey[action.type], action.timestamp);
        if (action.revocation.timestamp) {
            record(action.revocation.author, 'revokes', action.revocation.timestamp);
        }
        for (const note of action.notes ?? []) {
            if (!note.deleted) record(note.author, 'notes', note.ts);
        }
    }

    for (const player of players) {
        for (const note of player.noteHistory ?? []) {
            record(note.author, 'notes', note.ts);
        }

        const linked = new Set<StaffActivityMember>();
        for (const id of player.ids) {
            const member = byIdentifier.get(id.toLowerCase());
            if (member) linked.add(member);
        }
        for (const member of linked) {
            member.lastInGameTs = Math.max(member.lastInGameTs ?? 0, player.tsLastConnection * 1000);
            for (const [day, minutes] of player.staffPlayDays ?? []) {
                add(member, 'minutesOnline', Date.parse(day), minutes);
            }
        }
    }

    return { weekStarts, staff: members };
}


/**
 * The Discord user ids of an admin's identifiers, without the `discord:` prefix.
 */
export const discordIdsOf = (admin: StaffActivityAdmin) => admin.identifiers
    .map((id) => /^discord:(\d{17,20})$/i.exec(id)?.[1])
    .filter((id): id is string => !!id);


/**
 * Adds an outside source's weekly counts to the members built from `admins` (same order).
 * Rows are matched by Discord ID; weeks are in the same order as the members' weeks.
 */
export function addSourceRows(
    admins: StaffActivityAdmin[],
    members: StaffActivityMember[],
    rows: SourceActivityRow[],
) {
    const byDiscordId = new Map(rows.map((row) => [row.discordId, row]));
    admins.forEach((admin, i) => {
        const member = members[i];
        for (const discordId of discordIdsOf(admin)) {
            const row = byDiscordId.get(discordId);
            if (!row) continue;
            row.weeks.forEach((counts, week) => {
                if (!member.weeks[week]) return;
                for (const key of SOURCE_COUNT_KEYS) {
                    const value = counts[key] ?? 0;
                    member.weeks[week][key] += value;
                    member.total[key] += value;
                }
            });
        }
    });
}


type VaultAdmin = {
    name: string;
    providers: Record<string, { identifier?: string } | undefined>;
};

/**
 * Staff activity of the current admin roster from the live database, the ticket API and EF Bot.
 */
export async function getStaffActivity(weeks: number) {
    const admins = (txCore.adminStore.getAdminsList() as VaultAdmin[]).map((admin) => ({
        name: admin.name,
        identifiers: Object.values(admin.providers ?? {})
            .map((provider) => provider?.identifier)
            .filter((id): id is string => typeof id === 'string' && id.length > 0),
    }));
    const dbo = txCore.database.getDboRef();
    const { weekStarts, staff } = buildStaffActivity({
        admins,
        actions: dbo.chain.get('actions').value(),
        players: dbo.chain.get('players').value(),
        weeks,
        nowMs: Date.now(),
    });

    const discordIds = [...new Set(admins.flatMap(discordIdsOf))];
    const [tickets, discord] = await Promise.all([
        fetchTicketActivity(discordIds, weekStarts),
        fetchDiscordActivity(discordIds, weekStarts),
    ]);
    if (tickets.state === 'ok') addSourceRows(admins, staff, tickets.rows);
    if (discord.state === 'ok') addSourceRows(admins, staff, discord.rows);

    return {
        weekStarts,
        staff,
        sources: {
            tickets: tickets.state === 'ok' ? { state: 'ok' as const } : tickets,
            discord: discord.state === 'ok' ? { state: 'ok' as const } : discord,
        },
    } satisfies StaffActivityData;
}
