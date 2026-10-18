import { z } from 'zod';
import Fuse from 'fuse.js';
import cleanPlayerName from '@shared/cleanPlayerName';
import { parseLaxIdsArrayInput } from '@lib/player/idUtils';
import { lookupCharacters } from '@routes/player/characters';
import type { AuthedCtx } from '@modules/WebServer/ctxTypes';
import type { DatabasePlayerType } from '@modules/Database/databaseTypes';
import type { QuickSearchPlayer, QuickSearchResp } from '@shared/quickSearchApiTypes';

const RESULT_LIMIT = 8;
const querySchema = z.object({ q: z.string().trim().min(1).max(128) });
//the first 4 characters of an action id or more, such as B1AB or B1AB-2C
const actionIdRegex = /^[BWKS][1-9A-HJ-NP-Z]{3}(-[1-9A-HJ-NP-Z]{0,4})?$/;
//QBox citizen IDs are short and alphanumeric, with letters and digits
const citizenIdRegex = /^(?=.*\d)(?=.*[a-z])[a-z\d]{6,12}$/i;


/**
 * Panel quick search (Ctrl+K): finds players by name, identifier or citizen ID, and actions by id.
 */
export default async function QuickSearch(ctx: AuthedCtx) {
    const sendTypedResp = (data: QuickSearchResp) => ctx.send(data);
    const parsed = querySchema.safeParse(ctx.request.query);
    if (!parsed.success) {
        return sendTypedResp({ error: 'Type something to search for.' });
    }
    const q = parsed.data.q;
    const upperQ = q.toUpperCase();
    const dbo = txCore.database.getDboRef();
    const allPlayers = dbo.chain.get('players').value();

    //Actions by id, such as B1AB-2CD3 or a prefix of one
    const actions = actionIdRegex.test(upperQ)
        ? dbo.chain.get('actions').value()
            .filter((a) => a.id.startsWith(upperQ))
            .slice(0, RESULT_LIMIT)
            .map((a) => ({ id: a.id, type: a.type, playerName: a.playerName, reason: a.reason }))
        : [];

    //Exact matches (identifiers, citizen IDs) come before name matches
    const exact: [DatabasePlayerType, string][] = [];
    const { validIds, validHwids, invalids } = parseLaxIdsArrayInput(q);
    const isIdSearch = !invalids.length && (validIds.length > 0 || validHwids.length > 0);
    if (isIdSearch) {
        for (const p of allPlayers) {
            const matched = validIds.find((id) => p.ids.includes(id)) ?? validHwids.find((hwid) => p.hwids.includes(hwid));
            if (matched) exact.push([p, matched]);
        }
    }

    let citizenIdNotice: string | null = null;
    if (citizenIdRegex.test(q)) {
        const result = await lookupCharacters({ citizenIds: [upperQ] });
        if (result.status === 'unavailable') {
            citizenIdNotice = result.reason;
        } else {
            for (const character of result.characters) {
                const licenses = [character.license, character.license2].filter((id): id is string => !!id);
                const player = allPlayers.find((p) => licenses.some((id) => p.ids.includes(id)));
                if (player) exact.push([player, `Citizen ID ${character.citizenId} (${character.fullName})`]);
            }
        }
    }

    const { pureName } = cleanPlayerName(q);
    const byName = pureName === 'emptyname' || isIdSearch
        ? []
        : new Fuse(allPlayers, { keys: ['pureName'], threshold: 0.3 })
            .search(pureName, { limit: RESULT_LIMIT })
            .map(({ item }): [DatabasePlayerType, null] => [item, null]);

    const onlineLicenses = txCore.fxPlayerlist.getOnlinePlayersLicenses();
    const players = new Map<string, QuickSearchPlayer>();
    for (const [p, matched] of [...exact, ...byName]) {
        if (players.has(p.license)) continue;
        players.set(p.license, {
            license: p.license,
            displayName: p.displayName,
            isOnline: onlineLicenses.has(p.license),
            matched,
        });
    }

    return sendTypedResp({
        players: [...players.values()].slice(0, RESULT_LIMIT),
        actions,
        citizenIdNotice,
    });
};
