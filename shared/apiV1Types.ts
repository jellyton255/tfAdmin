/**
 * Types for the Everfall public API (/api/v1) and its key management.
 * Shared between core (routes + ApiServer module) and the panel (API Keys page).
 */

//Error codes returned inside the `error.code` field of the envelope
export const API_ERROR_CODES = [
    'UNAUTHORIZED',
    'FORBIDDEN',
    'NOT_FOUND',
    'VALIDATION_ERROR',
    'RATE_LIMITED',
    'CONFLICT',
    'INTERNAL_ERROR',
] as const;
export type ApiErrorCode = typeof API_ERROR_CODES[number];

export type ApiErrorBody = {
    error: {
        code: ApiErrorCode;
        message: string;
        details?: unknown;
    };
};
export type ApiDataBody<T, M = undefined> = M extends undefined
    ? { data: T }
    : { data: T; meta: M };
export type ApiResp<T, M = undefined> = ApiDataBody<T, M> | ApiErrorBody;


/**
 * API key records
 */
export const API_KEY_PREFIX = 'txk';
export const API_KEY_NAME_MAX_LENGTH = 48;
export const API_KEY_ALLOWED_IPS_MAX = 32;

//As stored on disk (secret is hashed) and as returned to clients (no hash)
export type ApiKeyPublicRecord = {
    id: string;
    name: string;
    permissions: string[];
    createdBy: string;
    createdAt: number; //epoch ms
    lastUsedAt: number | null; //epoch ms
    expiresAt: number | null; //epoch ms
    allowedIps: string[]; //CIDR or plain IPs, empty = any
    revokedAt: number | null; //epoch ms
    revokedBy: string | null;
};

export type ApiKeyCreateReq = {
    name: string;
    permissions: string[];
    expiresAt?: number | null;
    allowedIps?: string[];
};

export type ApiKeyCreateResp = ApiResp<{
    key: ApiKeyPublicRecord;
    /** Plaintext token, shown exactly once. */
    token: string;
}>;

export type ApiKeyListResp = ApiResp<{
    keys: ApiKeyPublicRecord[];
    /** Permission id -> human description, for the panel checkboxes. */
    permissions: Record<string, string>;
}>;

export type ApiKeyRevokeResp = ApiResp<{ key: ApiKeyPublicRecord }>;

export type ApiMeResp = ApiResp<{
    key: ApiKeyPublicRecord;
    txAdminVersion: string;
    serverTime: number;
}>;
