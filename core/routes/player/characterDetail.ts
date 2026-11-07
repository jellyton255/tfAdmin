const modulename = 'WebServer:PlayerCharacterDetail';
import { z } from 'zod';
import got from '@lib/got';
import consoleFactory from '@lib/console';
import { AuthedCtx } from '@modules/WebServer/ctxTypes';
import type { PlayerCharacterDetailResp } from '@shared/playerApiTypes';
const console = consoleFactory(modulename);

const LOOKUP_TIMEOUT_MS = 5_000;
const querySchema = z.object({ citizenId: z.string().regex(/^[A-Za-z0-9]{1,16}$/) });

const nullableString = z.string().nullable().default(null);
const nullableNumber = z.number().nullable().default(null);
// Lua encodes an empty table as an object, so empty lists arrive as {}
const luaList = <T extends z.ZodTypeAny>(item: T) => z.union([z.array(item), z.object({}).strict().transform(() => [])]);
const detailRespSchema = z.object({
    inventory: luaList(z.object({
        slot: nullableNumber,
        name: z.string(),
        label: nullableString,
        count: z.number(),
    })),
    vehicles: luaList(z.object({
        plate: z.string(),
        model: nullableString,
        garage: nullableString,
        state: nullableNumber,
        mileage: nullableNumber,
    })),
});
const errorRespSchema = z.object({ error: z.string() });


/**
 * Returns one QBox character's saved inventory and owned vehicles through the monitor resource
 * (resource/sv_characters.lua), for the player modal's Characters tab.
 */
export default async function PlayerCharacterDetail(ctx: AuthedCtx) {
    const sendTypedResp = (data: PlayerCharacterDetailResp) => ctx.send(data);
    const query = querySchema.safeParse(ctx.query);
    if (!query.success) {
        return sendTypedResp({ error: 'Invalid Request' });
    }

    const child = txCore.fxRunner.child;
    if (!child?.isAlive || !child.netEndpoint) {
        return sendTypedResp({ status: 'unavailable', reason: 'The game server is not running.' });
    }

    let resp;
    try {
        resp = await got.post({
            url: `http://${child.netEndpoint}/monitor/characters/detail`,
            json: {
                txAdminToken: txCore.webServer.luaComToken,
                citizenId: query.data.citizenId,
            },
            maxRedirects: 0,
            timeout: { request: LOOKUP_TIMEOUT_MS },
            retry: { limit: 0 },
            throwHttpErrors: false,
        }).json<unknown>();
    } catch (error) {
        console.verbose.warn(`Character detail request failed: ${(error as Error).message}`);
        return sendTypedResp({ status: 'unavailable', reason: 'The game server did not answer.' });
    }

    const parsed = detailRespSchema.safeParse(resp);
    if (parsed.success) {
        return sendTypedResp({ status: 'ok', ...parsed.data });
    }
    const gameError = errorRespSchema.safeParse(resp);
    if (gameError.success && gameError.data.error === 'route not found') {
        return sendTypedResp({ status: 'unavailable', reason: 'The game server needs a restart to load character details.' });
    }
    if (gameError.success) {
        return sendTypedResp({ status: 'unavailable', reason: `Character details failed: ${gameError.data.error}.` });
    }
    console.verbose.warn('Character detail lookup returned an invalid response.');
    return sendTypedResp({ status: 'unavailable', reason: 'The game server returned an invalid response.' });
};
