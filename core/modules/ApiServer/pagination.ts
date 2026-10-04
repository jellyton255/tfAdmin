import { z } from 'zod';
import { API_PAGE_DEFAULT_LIMIT, API_PAGE_MAX_LIMIT, type ApiPageMeta } from '@shared/apiV1Types';
import { ApiError } from './envelope';

/**
 * Cursor pagination helpers for the list endpoints.
 * A cursor is the base64url of `<sortValue>|<uniqueKey>` of the last item on the previous page,
 * so pages stay stable while the underlying array changes.
 */
export type ApiCursor = { sortValue: number; key: string };

export const limitSchema = z.coerce.number().int().min(1).max(API_PAGE_MAX_LIMIT).default(API_PAGE_DEFAULT_LIMIT);

export const encodeCursor = (cursor: ApiCursor) => {
    return Buffer.from(`${cursor.sortValue}|${cursor.key}`, 'utf8').toString('base64url');
};

export const decodeCursor = (raw: unknown): ApiCursor | null => {
    if (raw === undefined || raw === null || raw === '') return null;
    if (typeof raw !== 'string' || raw.length > 256) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid cursor.');
    }
    const decoded = Buffer.from(raw, 'base64url').toString('utf8');
    const sep = decoded.indexOf('|');
    const sortValue = Number(decoded.slice(0, sep));
    const key = decoded.slice(sep + 1);
    if (sep <= 0 || !Number.isFinite(sortValue) || !key.length) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid cursor.');
    }
    return { sortValue, key };
};

/**
 * Takes a list that is already sorted by `sortValue` (asc or desc), skips everything up to and
 * including the cursor item, then takes `limit` items and builds the page meta.
 */
export const paginate = <T>(
    sorted: T[],
    limit: number,
    cursor: ApiCursor | null,
    getSortValue: (item: T) => number,
    getKey: (item: T) => string,
    desc: boolean,
): { items: T[]; meta: ApiPageMeta } => {
    let startIndex = 0;
    if (cursor) {
        const exactIndex = sorted.findIndex((item) => getKey(item) === cursor.key && getSortValue(item) === cursor.sortValue);
        if (exactIndex >= 0) {
            startIndex = exactIndex + 1;
        } else {
            //cursor item is gone: resume at the first item past its sort value
            startIndex = sorted.findIndex((item) => {
                const v = getSortValue(item);
                return desc ? v < cursor.sortValue : v > cursor.sortValue;
            });
            if (startIndex < 0) startIndex = sorted.length;
        }
    }
    const items = sorted.slice(startIndex, startIndex + limit);
    const last = items.at(-1);
    const hasMore = startIndex + limit < sorted.length;
    return {
        items,
        meta: {
            limit,
            nextCursor: hasMore && last ? encodeCursor({ sortValue: getSortValue(last), key: getKey(last) }) : null,
        },
    };
};

/** Database timestamps are epoch seconds; the API speaks epoch milliseconds. */
export const secToMs = (sec: number | null | undefined | false): number | null => {
    return typeof sec === 'number' && Number.isFinite(sec) ? sec * 1000 : null;
};
