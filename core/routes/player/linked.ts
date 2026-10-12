import playerResolver from '@lib/player/playerResolver';
import { getLinkedAccounts } from '@lib/player/linkedAccounts';
import { AuthedCtx } from '@modules/WebServer/ctxTypes';
import { SYM_CURRENT_MUTEX } from '@lib/symbols';
import { now } from '@lib/misc';
import type { PlayerLinkedAccountsResp } from '@shared/playerApiTypes';


/**
 * Returns the other players that share an identifier or HWID with this player (Linked Accounts tab)
 */
export default async function PlayerLinked(ctx: AuthedCtx) {
    const { mutex, netid, license } = ctx.query;
    const sendTypedResp = (data: PlayerLinkedAccountsResp) => ctx.send(data);

    let player;
    try {
        const refMutex = mutex === 'current' ? SYM_CURRENT_MUTEX : mutex;
        player = playerResolver(refMutex, parseInt((netid as string)), license);
    } catch (error) {
        return sendTypedResp({ error: (error as Error).message });
    }

    const onlineLicenses = txCore.fxPlayerlist.getOnlinePlayersLicenses();
    const linked = getLinkedAccounts({
        license: player.license,
        ids: player.allIdentifiers,
        hwids: player.allHardwareIdentifiers,
    }, now());
    return sendTypedResp({
        accounts: linked.matches.map(({ player: p, ...match }) => ({
            license: p.license,
            displayName: p.displayName,
            playTime: p.playTime,
            tsLastConnection: p.tsLastConnection,
            isOnline: onlineLicenses.has(p.license),
            matchedIds: match.matchedIds,
            matchedHwids: match.matchedHwids,
            isBanned: match.isBanned,
            banCount: match.banCount,
            warnCount: match.warnCount,
        })),
        ignoredHwids: linked.ignoredHwids,
        truncated: linked.truncated,
    });
};
