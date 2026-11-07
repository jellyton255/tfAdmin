import type { GenericApiErrorResp } from './genericApiTypes';

/**
 * Everfall: one request the panel sends to ef_administration through the monitor resource
 * (POST /everfall/request). ef_administration owns each operation and checks the admin's Everfall
 * staff rank, read from the Discord account linked to their tfAdmin login.
 */
export type EverfallRequest = {
    operation: string;
    payload?: Record<string, unknown>;
};

export type EverfallResp<Data = Record<string, unknown>> = {
    ok: true;
    data: Data;
} | {
    ok: false;
    error: string;
} | GenericApiErrorResp;

/** Answer of the `staff.permissions` operation. */
export type EverfallStaffPermissions = {
    rank: string | null;
    permissions: string[];
};
