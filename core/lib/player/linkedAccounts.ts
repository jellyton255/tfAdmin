import type { DatabaseActionType, DatabasePlayerType } from '@modules/Database/databaseTypes';

/** Identifier types that tie two accounts to the same person. IPs are left out on purpose. */
export const LINKED_ID_TYPES = ['license', 'license2', 'discord', 'fivem', 'steam', 'live', 'xbl'];
export const LINKED_RESULT_LIMIT = 50;
/** A HWID shared by more players than this is treated as noise (cafe or common hardware). */
export const LINKED_HWID_PLAYER_LIMIT = 25;

export type LinkedPlayerMatch = {
    player: DatabasePlayerType;
    matchedIds: string[];
    matchedHwids: string[];
};

export type LinkedPlayersResult = {
    matches: LinkedPlayerMatch[];
    ignoredHwids: string[];
    truncated: boolean;
};

type LinkedTarget = {
    license: string | null;
    ids: string[];
    hwids: string[];
};


/**
 * Finds the other players that share an identifier or a HWID with the target.
 * Strongest links come first: more shared identifiers, then more shared HWIDs, then most recently seen.
 */
export function findLinkedPlayers(
    target: LinkedTarget,
    players: DatabasePlayerType[],
    resultLimit = LINKED_RESULT_LIMIT,
    hwidPlayerLimit = LINKED_HWID_PLAYER_LIMIT,
): LinkedPlayersResult {
    const targetIds = new Set(target.ids.filter((id) => LINKED_ID_TYPES.includes(id.split(':', 1)[0])));
    const targetHwids = new Set(target.hwids);

    const candidates: LinkedPlayerMatch[] = [];
    const hwidPlayerCounts = new Map<string, number>();
    for (const player of players) {
        if (player.license === target.license) continue;
        const matchedIds = player.ids.filter((id) => targetIds.has(id));
        const matchedHwids = player.hwids.filter((hwid) => targetHwids.has(hwid));
        if (!matchedIds.length && !matchedHwids.length) continue;
        for (const hwid of matchedHwids) {
            hwidPlayerCounts.set(hwid, (hwidPlayerCounts.get(hwid) ?? 0) + 1);
        }
        candidates.push({ player, matchedIds, matchedHwids });
    }

    const ignoredHwids = [...hwidPlayerCounts]
        .filter(([, count]) => count > hwidPlayerLimit)
        .map(([hwid]) => hwid);
    const matches = candidates
        .map((match) => ({
            ...match,
            matchedHwids: match.matchedHwids.filter((hwid) => !ignoredHwids.includes(hwid)),
        }))
        .filter((match) => match.matchedIds.length || match.matchedHwids.length)
        .sort((a, b) => (
            b.matchedIds.length - a.matchedIds.length
            || b.matchedHwids.length - a.matchedHwids.length
            || b.player.tsLastConnection - a.player.tsLastConnection
        ));

    return {
        matches: matches.slice(0, resultLimit),
        ignoredHwids,
        truncated: matches.length > resultLimit,
    };
}


/**
 * Summarizes a player's bans and warnings the same way the player window does (revoked ones not counted).
 */
export function summarizeSanctions(actions: DatabaseActionType[], currTs: number) {
    const active = actions.filter((action) => !action.revocation.timestamp);
    return {
        isBanned: active.some((action) => (
            action.type === 'ban' && (action.expiration === false || action.expiration > currTs)
        )),
        banCount: active.filter((action) => action.type === 'ban').length,
        warnCount: active.filter((action) => action.type === 'warn').length,
    };
}


/**
 * Linked players of the target with their sanctions, read from the live database.
 */
export function getLinkedAccounts(target: LinkedTarget, currTs: number) {
    //cheap prefilter so only candidates get deep-cloned out of the database
    const ids = new Set(target.ids.filter((id) => LINKED_ID_TYPES.includes(id.split(':', 1)[0])));
    const hwids = new Set(target.hwids);
    const candidates = txCore.database.players.findMany((p: DatabasePlayerType) => (
        p.ids.some((id) => ids.has(id)) || p.hwids.some((hwid) => hwids.has(hwid))
    ));
    const result = findLinkedPlayers(target, candidates);
    return {
        ...result,
        matches: result.matches.map((match) => ({
            ...match,
            ...summarizeSanctions(
                txCore.database.actions.findMany(match.player.ids, match.player.hwids),
                currTs,
            ),
        })),
    };
}
