const modulename = 'Everfall';
import { z } from 'zod';
import got from '@lib/got';
import consoleFactory from '@lib/console';
import { inferAdminLogCategory } from '@modules/Logger/handlers/adminLogSearch';
import type { AdminLogCategory } from '@shared/adminLogApiTypes';
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


//Account, admin, settings and API key lines stay in the Audit Log only
const staffLogSkippedCategories = new Set<AdminLogCategory>(['login', 'admins', 'settings', 'api', 'system']);

/**
 * Copies an admin's admin log line into ef_administration's Staff Log, which keeps it or drops it
 * by the admin's Everfall rank. Lines by system authors, scripts and admins without a linked Discord
 * account are skipped, and so is everything while the game server is down.
 */
export function recordStaffLog(author: string, message: string) {
    const discordId: unknown = txCore.adminStore.getAdminByName(author)?.providers?.discord?.id;
    if (typeof discordId !== 'string') return;
    const category = inferAdminLogCategory(author, message);
    if (staffLogSkippedCategories.has(category)) return;
    void runEverfallOperation({ discordId, name: author }, 'staffLog.record', { action: category, message });
}
