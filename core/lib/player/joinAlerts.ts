const modulename = 'JoinAlerts';
import { now } from '@lib/misc';
import { getLinkedAccounts } from '@lib/player/linkedAccounts';
import type { ServerPlayer } from '@lib/player/playerClasses';
import consoleFactory from '@lib/console';
const console = consoleFactory(modulename);

/** Banned linked accounts sent per alert; the Linked Accounts tab has the full list. */
const EVASION_LINK_LIMIT = 5;


/**
 * Alerts staff when a watched player joins, or one whose linked accounts have an active ban.
 * The join already passed the ban check, so a banned link means a ban it did not match: a partial
 * HWID match below requiredHwidMatches, or an identifier the ban was never recorded with.
 * Each alert is a txAdmin event: ef_hud shows it to staffNetIds in game, webhooks post it to Discord.
 */
export function sendJoinAlerts(player: ServerPlayer) {
    const dbData = player.getDbData();
    if (!dbData) return;
    const watch = dbData.watch;
    const bannedLinks = getLinkedAccounts({
        license: player.license,
        ids: player.allIdentifiers,
        hwids: player.allHardwareIdentifiers,
    }, now()).matches.filter((match) => match.isBanned);
    if (!watch && !bannedLinks.length) return;

    const target = {
        staffNetIds: txCore.adminStore.getOnlineAdminNetIds(),
        netid: player.netid,
        displayName: player.displayName,
        license: player.license,
    };
    if (watch) {
        console.warn(`Watched player ${player.displayName} joined (#${player.netid}): ${watch.reason}`);
        txCore.fxRunner.sendEvent('playerWatchJoined', {
            ...target,
            reason: watch.reason,
            watchedBy: watch.author,
            watchedAt: watch.ts * 1000,
        });
    }
    if (bannedLinks.length) {
        console.warn(`Possible ban evasion: ${player.displayName} (#${player.netid}) is linked to ${bannedLinks.length} banned account(s).`);
        txCore.fxRunner.sendEvent('playerPossibleBanEvasion', {
            ...target,
            bannedLinkCount: bannedLinks.length,
            bannedLinks: bannedLinks.slice(0, EVASION_LINK_LIMIT).map((match) => ({
                license: match.player.license,
                displayName: match.player.displayName,
                matchedIdTypes: [...new Set(match.matchedIds.map((id) => id.split(':', 1)[0]))],
                matchedHwidCount: match.matchedHwids.length,
            })),
        });
    }
}
