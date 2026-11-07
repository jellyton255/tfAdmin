import useSWR from "swr";
import { useAuthedFetcher } from "@/hooks/fetch";
import type { EverfallResp, EverfallStaffPermissions } from "@shared/everfallApiTypes";

/**
 * Everfall: runs ef_administration operations as the logged-in admin (POST /everfall/request).
 * Resolves the operation's data, or throws with the message the game gave.
 */
export function useEverfallRequest() {
    const authedFetcher = useAuthedFetcher();
    return async function everfallRequest<Data = Record<string, unknown>>(
        operation: string,
        payload: Record<string, unknown> = {},
    ): Promise<Data> {
        const resp = await authedFetcher<EverfallResp<Data>>('/everfall/request', {
            method: 'POST',
            body: { operation, payload },
        });
        if (!('ok' in resp)) throw new Error(resp.error);
        if (!resp.ok) throw new Error(resp.error);
        return resp.data;
    };
}

/**
 * Everfall: read operations as SWR, keyed by operation and payload. Pass null to skip.
 */
export function useEverfallQuery<Data>(operation: string | null, payload: Record<string, unknown> = {}) {
    const everfallRequest = useEverfallRequest();
    return useSWR(
        operation ? { operation, payload } : null,
        (key: { operation: string; payload: Record<string, unknown> }) => everfallRequest<Data>(key.operation, key.payload),
        { revalidateOnFocus: false, shouldRetryOnError: false },
    );
}

/**
 * The Everfall staff rank of the logged-in admin and every action it grants, so pages offer only
 * what ef_administration will accept.
 */
export function useEverfallPermissions() {
    const query = useEverfallQuery<EverfallStaffPermissions>('staff.permissions');
    const permissions = query.data?.permissions ?? [];
    return {
        ...query,
        can: (permission: string) => permissions.includes(permission),
    };
}
