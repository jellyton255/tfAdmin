const modulename = 'Everfall';
import { z } from 'zod';
import got from '@lib/got';
import consoleFactory from '@lib/console';
const console = consoleFactory(modulename);

// A screenshot alone can take 15 seconds in game before its upload finishes.
const REQUEST_TIMEOUT_MS = 30_000;
const respSchema = z.union([
    z.object({ ok: z.literal(true), data: z.record(z.string(), z.unknown()) }),
    z.object({ ok: z.literal(false), error: z.string() }),
]);
const errorRespSchema = z.object({ error: z.string() });

export type EverfallActor = { discordId: string; name: string };
export type EverfallResult = { ok: true; data: Record<string, unknown> } | { ok: false; error: string };


/**
 * Runs one ef_administration operation through the monitor resource (resource/sv_everfall.lua),
 * acting as this admin's Discord account. ef_administration checks their Everfall staff rank.
 */
export async function runEverfallOperation(
    actor: EverfallActor,
    operation: string,
    payload: Record<string, unknown>,
): Promise<EverfallResult> {
    const child = txCore.fxRunner.child;
    if (!child?.isAlive || !child.netEndpoint) {
        return { ok: false, error: 'The game server is not running.' };
    }

    let resp;
    try {
        resp = await got.post({
            url: `http://${child.netEndpoint}/monitor/everfall`,
            json: { txAdminToken: txCore.webServer.luaComToken, actor, operation, payload },
            maxRedirects: 0,
            timeout: { request: REQUEST_TIMEOUT_MS },
            retry: { limit: 0 },
            throwHttpErrors: false,
        }).json<unknown>();
    } catch (error) {
        console.verbose.warn(`${operation} request failed: ${(error as Error).message}`);
        return { ok: false, error: 'The game server did not answer. Check the result in game before retrying.' };
    }

    const parsed = respSchema.safeParse(resp);
    if (parsed.success) return parsed.data;

    const gameError = errorRespSchema.safeParse(resp);
    if (gameError.success && gameError.data.error === 'route not found') {
        return { ok: false, error: 'The game server needs a restart to load Everfall actions.' };
    }
    if (gameError.success) {
        return { ok: false, error: `The game server refused the request: ${gameError.data.error}.` };
    }
    return { ok: false, error: 'The game server returned an invalid response.' };
}
