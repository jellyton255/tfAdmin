import { randomUUID } from 'node:crypto';
import type { Next } from 'koa';
import { ZodError } from 'zod';
import { txEnv } from '@core/globalData';
import type { InitializedCtx } from '@modules/WebServer/ctxTypes';
import type { ApiErrorCode } from '@shared/apiV1Types';

/**
 * Throwable error that the API error middleware turns into an envelope response.
 */
export class ApiError extends Error {
    constructor(
        public readonly status: number,
        public readonly code: ApiErrorCode,
        message: string,
        public readonly details?: unknown,
    ) {
        super(message);
        this.name = 'ApiError';
    }
}

export const sendData = <T>(ctx: InitializedCtx, data: T, status = 200, meta?: object) => {
    ctx.status = status;
    ctx.body = meta ? { data, meta } : { data };
};

export const sendError = (
    ctx: InitializedCtx,
    status: number,
    code: ApiErrorCode,
    message: string,
    details?: unknown,
) => {
    ctx.status = status;
    ctx.body = { error: { code, message, ...(details !== undefined ? { details } : {}) } };
};


/**
 * Middleware for every /api/v1 route:
 * - tags the response with a request id and the txAdmin version
 * - rejects non-JSON bodies on write methods
 * - turns thrown ApiError / ZodError into the error envelope
 */
export const apiEnvelopeMw = async (ctx: InitializedCtx, next: Next) => {
    const requestId = randomUUID();
    (ctx as any).apiRequestId = requestId;
    ctx.set('X-Request-Id', requestId);
    ctx.set('X-TxAdmin-Version', txEnv.txaVersion);
    ctx.set('Cache-Control', 'no-store');

    if (['POST', 'PUT', 'PATCH'].includes(ctx.method) && ctx.request.length) {
        if (!ctx.is('application/json')) {
            return sendError(ctx, 415, 'VALIDATION_ERROR', 'Request body must be application/json.');
        }
    }

    try {
        await next();
    } catch (error) {
        if (error instanceof ApiError) {
            return sendError(ctx, error.status, error.code, error.message, error.details);
        }
        if (error instanceof ZodError) {
            return sendError(ctx, 400, 'VALIDATION_ERROR', 'Invalid request.', error.issues.map((i) => ({
                path: i.path.join('.'),
                message: i.message,
            })));
        }
        //Let the top-level middleware log it, but keep the envelope shape
        console.verbose.error(`[api:${requestId}] ${(error as Error).message}`);
        return sendError(ctx, 500, 'INTERNAL_ERROR', 'Internal error.', { requestId });
    }
};
