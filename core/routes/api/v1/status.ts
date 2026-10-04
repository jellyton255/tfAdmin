import { txEnv } from '@core/globalData';
import { DiscordBotStatus } from '@shared/enums';
import { sendData } from '@modules/ApiServer/envelope';
import type { ApiKeyCtx } from '@modules/ApiServer/apiKeyAuthMw';
import type { ApiStatusResp } from '@shared/apiV1Types';

const DISCORD_STATUS_NAMES = {
    [DiscordBotStatus.Disabled]: 'disabled',
    [DiscordBotStatus.Starting]: 'starting',
    [DiscordBotStatus.Ready]: 'ready',
    [DiscordBotStatus.Error]: 'error',
} as const;


/**
 * GET /api/v1/status - txAdmin and FXServer status, same data the panel header shows
 */
export default async function ApiStatus(ctx: ApiKeyCtx) {
    const global = txManager.globalStatus;
    const host = txManager.hostStatus;
    const now = Date.now();
    const data: Extract<ApiStatusResp, { data: any }>['data'] = {
        txAdmin: {
            version: txEnv.txaVersion,
            configState: global.configState,
            serverTime: now,
        },
        server: {
            name: global.server.name,
            health: global.server.health,
            healthReason: global.server.healthReason,
            uptime: global.server.uptime,
            isProcessAlive: global.runner.isChildAlive,
            isRunnerIdle: global.runner.isIdle,
            whitelistMode: global.server.whitelist,
            playerCount: host.playerCount,
            playerSlots: host.playerSlots,
            projectName: host.projectName,
            projectDesc: host.projectDesc,
            gameName: host.gameName,
            cfxId: host.cfxId,
            joinLink: host.joinLink,
        },
        scheduler: {
            nextRestartAt: global.scheduler.nextRelativeMs === false ? null : now + global.scheduler.nextRelativeMs,
            nextSkip: global.scheduler.nextSkip,
            nextIsTemp: global.scheduler.nextIsTemp,
        },
        discord: {
            status: DISCORD_STATUS_NAMES[global.discord] ?? 'error',
        },
    };
    return sendData(ctx, data);
};
