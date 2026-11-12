import { z } from 'zod';
import Fuse from 'fuse.js';
import cleanPlayerName from '@shared/cleanPlayerName';
import { parseLaxIdsArrayInput } from '@lib/player/idUtils';
import { lookupCharacters } from '@routes/player/characters';
import type { AuthedCtx } from '@modules/WebServer/ctxTypes';
import type { DatabasePlayerType } from '@modules/Database/databaseTypes';
import type { QuickSearchPlayer, QuickSearchResp, QuickSearchVehicle } from '@shared/quickSearchApiTypes';

const RESULT_LIMIT = 8;
//shorter identifier fragments match too many players to be useful
const MIN_ID_FRAGMENT = 3;
const querySchema = z.object({ q: z.string().trim().min(1).max(128) });
//the first 4 characters of an action id or more, such as B1AB or B1AB-2C
const actionIdRegex = /^[BWKS][1-9A-HJ-NP-Z]{3}(-[1-9A-HJ-NP-Z]{0,4})?$/;
//what sv_characters.lua accepts for a citizen ID or character name search
const characterSearchRegex = /^[a-z\d][a-z\d '-]{1,63}$/i;

type Match = [DatabasePlayerType, string | null];

/**
 * Identifiers that start with or contain the query. Without a type prefix ("discord:")
 * the query is matched against the value after the colon.
 */
function matchIdFragments(players: DatabasePlayerType[], q: string) {
    const prefix: Match[] = [];
    const contains: Match[] = [];
    const lowerQ = q.toLowerCase();
    const hasType = lowerQ.includes(':');
    const fragmentLength = hasType ? lowerQ.length - lowerQ.indexOf(':') - 1 : lowerQ.length;
    if (fragmentLength < MIN_ID_FRAGMENT || /\s/.test(lowerQ)) return { prefix, contains };

    for (const p of players) {
        let containsId: string | undefined;
        for (const id of p.ids) {
            const target = hasType ? id : id.slice(id.indexOf(':') + 1);
            const index = target.indexOf(lowerQ);
            if (index === 0) {
                prefix.push([p, id]);
                containsId = undefined;
                break;
            }
            if (index > 0) containsId ??= id;
        }
        if (containsId) contains.push([p, containsId]);
    }
    return { prefix, contains };
}


/**
 * Panel quick search (Ctrl+K): finds players by name, identifier, citizen ID or character name,
 * vehicles by plate, VIN, model or nickname, and actions by id. Identifiers and citizen IDs match on any part, names match fuzzily.
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

    //Whole identifiers
    const exact: Match[] = [];
    const { validIds, validHwids, invalids } = parseLaxIdsArrayInput(q);
    if (!invalids.length && (validIds.length > 0 || validHwids.length > 0)) {
        for (const p of allPlayers) {
            const matched = validIds.find((id) => p.ids.includes(id)) ?? validHwids.find((hwid) => p.hwids.includes(hwid));
            if (matched) exact.push([p, matched]);
        }
    }
    const idFragments = matchIdFragments(allPlayers, q);

    //Citizen IDs, character names and vehicles, from the game database
    const findPlayer = (licenses: (string | null)[]) => allPlayers.find((p) => licenses.some((id) => id && p.ids.includes(id)));
    const characters: Match[] = [];
    const vehicles: QuickSearchVehicle[] = [];
    let citizenIdNotice: string | null = null;
    if (characterSearchRegex.test(q)) {
        const result = await lookupCharacters({ search: q });
        if (result.status === 'unavailable') {
            //a failed lookup only matters when the query could be a citizen ID
            if (/\d/.test(q) && !/\s/.test(q)) citizenIdNotice = result.reason;
        } else {
            for (const character of result.characters) {
                const player = findPlayer([character.license, character.license2]);
                if (player) characters.push([player, `Citizen ID ${character.citizenId} (${character.fullName})`]);
            }
            const lowerQ = q.toLowerCase();
            for (const vehicle of result.vehicles.slice(0, RESULT_LIMIT)) {
                const player = findPlayer([vehicle.license, vehicle.license2]);
                let detail = vehicle.vin && `VIN ${vehicle.vin}`;
                if (vehicle.fakePlate?.toLowerCase().includes(lowerQ)) detail = `Fake Plate ${vehicle.fakePlate}`;
                else if (vehicle.nickname?.toLowerCase().includes(lowerQ)) detail = vehicle.nickname;
                vehicles.push({
                    plate: vehicle.plate,
                    model: vehicle.model,
                    detail,
                    owner: player
                        ? { license: player.license, displayName: player.displayName, characterName: vehicle.ownerName }
                        : null,
                });
            }
        }
    }

    //Player names, fuzzy and anywhere in the name
    const { pureName } = cleanPlayerName(q);
    const byName: Match[] = pureName === 'emptyname' || !/[a-z]/i.test(q)
        ? []
        : new Fuse(allPlayers, { keys: ['pureName'], threshold: 0.35, ignoreLocation: true })
            .search(pureName, { limit: RESULT_LIMIT })
            .map(({ item }) => [item, null]);

    const onlineLicenses = txCore.fxPlayerlist.getOnlinePlayersLicenses();
    const players = new Map<string, QuickSearchPlayer>();
    const ranked = [...exact, ...idFragments.prefix, ...characters, ...byName, ...idFragments.contains];
    for (const [p, matched] of ranked) {
        if (players.size >= RESULT_LIMIT) break;
        if (players.has(p.license)) continue;
        players.set(p.license, {
            license: p.license,
            displayName: p.displayName,
            isOnline: onlineLicenses.has(p.license),
            matched,
        });
    }

    return sendTypedResp({
        players: [...players.values()],
        vehicles,
        actions,
        citizenIdNotice,
    });
};
