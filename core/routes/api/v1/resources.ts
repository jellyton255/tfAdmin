import path from 'node:path';
import slash from 'slash';
import { requestResourceReport } from '@lib/fxserver/resourceReport';
import { ApiError, sendData } from '@modules/ApiServer/envelope';
import type { ApiKeyCtx } from '@modules/ApiServer/apiKeyAuthMw';
import type { ApiResourceRecord } from '@shared/apiV1Types';


const toRelativePath = (resPath: string) => {
    const normalized = slash(path.normalize(resPath));
    const dataRoot = slash(path.normalize(`${txConfig.server.dataPath ?? ''}/`)).toLowerCase();
    if (dataRoot.length > 1 && normalized.toLowerCase().startsWith(dataRoot)) {
        return normalized.slice(dataRoot.length);
    }
    return normalized;
};


/**
 * GET /api/v1/resources - every resource FXServer knows about, with its state.
 * Only available while the server is running.
 */
export default async function ApiResources(ctx: ApiKeyCtx) {
    if (!txCore.fxRunner.child?.isAlive) {
        throw new ApiError(503, 'SERVER_OFFLINE', 'The resources list is only available while the server is running.');
    }
    const report = await requestResourceReport();
    if (!report) {
        throw new ApiError(503, 'SERVER_OFFLINE', 'FXServer did not answer the resource report in time.');
    }
    const resources = report
        .filter((r) => typeof r?.name === 'string' && typeof r?.status === 'string' && typeof r?.path === 'string' && r.path.length)
        .map((r): ApiResourceRecord => ({
            name: r.name,
            status: r.status,
            path: toRelativePath(r.path),
            version: typeof r.version === 'string' && r.version.trim() ? r.version.trim() : null,
            author: typeof r.author === 'string' && r.author.trim() ? r.author.trim() : null,
            description: typeof r.description === 'string' && r.description.trim() ? r.description.trim() : null,
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
    return sendData(ctx, { resources });
};
