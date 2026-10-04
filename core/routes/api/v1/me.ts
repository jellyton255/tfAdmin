import { txEnv } from '@core/globalData';
import { sendData } from '@modules/ApiServer/envelope';
import { toPublicRecord } from '@modules/ApiServer/ApiKeyStore';
import type { ApiKeyCtx } from '@modules/ApiServer/apiKeyAuthMw';
import type { ApiMeResp } from '@shared/apiV1Types';


/**
 * GET /api/v1/me - describes the calling key
 */
export default async function ApiMe(ctx: ApiKeyCtx) {
    const data: Extract<ApiMeResp, { data: any }>['data'] = {
        key: toPublicRecord(ctx.apiKey),
        txAdminVersion: txEnv.txaVersion,
        serverTime: Date.now(),
    };
    return sendData(ctx, data);
};
