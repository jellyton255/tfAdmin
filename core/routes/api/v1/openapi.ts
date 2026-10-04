import type { InitializedCtx } from '@modules/WebServer/ctxTypes';
import { buildOpenApiDocument } from '@modules/ApiServer/openapi';

let cached: object | null = null;

/**
 * GET /api/v1/openapi.json
 * Unauthenticated: the spec describes the public contract and contains no server data.
 */
export default async function openapi(ctx: InitializedCtx) {
    cached ??= buildOpenApiDocument();
    ctx.set('Cache-Control', 'public, max-age=300');
    ctx.status = 200;
    ctx.body = cached;
};
