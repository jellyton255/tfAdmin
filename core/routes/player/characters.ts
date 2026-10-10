const modulename = 'WebServer:PlayerCharacters';
import { z } from 'zod';
import got from '@lib/got';
import playerResolver from '@lib/player/playerResolver';
import consoleFactory from '@lib/console';
import { AuthedCtx } from '@modules/WebServer/ctxTypes';
import { SYM_CURRENT_MUTEX } from '@lib/symbols';
import type { PlayerCharacter, PlayerCharactersResp } from '@shared/playerApiTypes';
const console = consoleFactory(modulename);

const LOOKUP_TIMEOUT_MS = 5_000;
const LICENSE_REGEX = /^license2?:[0-9a-f]+$/i;

const nullableString = z.string().nullable().default(null);
const nullableNumber = z.number().nullable().default(null);
const charactersRespSchema = z.object({
    characters: z.array(z.object({
        citizenId: z.string(),
        slot: nullableNumber,
        fullName: z.string(),
        jobLabel: nullableString,
        jobGrade: nullableString,
        gangName: nullableString,
        gangLabel: nullableString,
        gangGrade: nullableString,
        cash: nullableNumber,
        bank: nullableNumber,
        tsLastUpdated: nullableNumber,
        tsLastLoggedOut: nullableNumber,
        online: z.boolean(),
    })),
});
const errorRespSchema = z.object({ error: z.string() });


/**
 * Asks the monitor resource (resource/sv_characters.lua) for the QBox characters of these licenses.
 * The lookup runs in FXServer through oxmysql, so tfAdmin needs no database credentials.
 */
async function fetchCharacters(netEndpoint: string, licenses: string[]): Promise<PlayerCharactersResp> {
    let resp;
    try {
        resp = await got.post({
            url: `http://${netEndpoint}/monitor/characters`,
            json: {
                txAdminToken: txCore.webServer.luaComToken,
                licenses,
            },
            maxRedirects: 0,
            timeout: { request: LOOKUP_TIMEOUT_MS },
            retry: { limit: 0 },
            throwHttpErrors: false,
        }).json<unknown>();
    } catch (error) {
        console.verbose.warn(`Character lookup request failed: ${(error as Error).message}`);
        return { status: 'unavailable', reason: 'The game server did not answer the character lookup.' };
    }

    const parsed = charactersRespSchema.safeParse(resp);
    if (parsed.success) {
        const characters: PlayerCharacter[] = parsed.data.characters;
        return { status: 'ok', characters };
    }

    const gameError = errorRespSchema.safeParse(resp);
    if (gameError.success && gameError.data.error === 'route not found') {
        return { status: 'unavailable', reason: 'The game server needs a restart to load the character lookup.' };
    }
    if (gameError.success) {
        return { status: 'unavailable', reason: `Character lookup failed: ${gameError.data.error}.` };
    }
    console.verbose.warn('Character lookup returned an invalid response.');
    return { status: 'unavailable', reason: 'The game server returned an invalid character lookup response.' };
}


/**
 * Returns the QBox characters linked to the player's license identifiers.
 * Kept apart from /player so a slow or offline game server never delays the stock modal.
 */
export default async function PlayerCharacters(ctx: AuthedCtx) {
    const sendTypedResp = (data: PlayerCharactersResp) => ctx.send(data);
    if (typeof ctx.query === 'undefined') {
        return sendTypedResp({ error: 'Invalid Request' });
    }
    const { mutex, netid, license } = ctx.query;

    let player;
    try {
        const refMutex = mutex === 'current' ? SYM_CURRENT_MUTEX : mutex;
        player = playerResolver(refMutex, parseInt((netid as string)), license);
    } catch (error) {
        return sendTypedResp({ error: (error as Error).message });
    }

    const licenses = player.allIdentifiers.filter((id) => LICENSE_REGEX.test(id));
    if (!licenses.length) {
        return sendTypedResp({ status: 'ok', characters: [] });
    }

    const child = txCore.fxRunner.child;
    if (!child?.isAlive || !child.netEndpoint) {
        return sendTypedResp({ status: 'unavailable', reason: 'The game server is not running.' });
    }

    return sendTypedResp(await fetchCharacters(child.netEndpoint, licenses.slice(0, 16)));
};
