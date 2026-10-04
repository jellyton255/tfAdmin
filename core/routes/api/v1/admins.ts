import { sendData } from '@modules/ApiServer/envelope';
import type { ApiKeyCtx } from '@modules/ApiServer/apiKeyAuthMw';
import type { ApiAdminRecord } from '@shared/apiV1Types';

type VaultAdmin = {
    name: string;
    master: boolean;
    permissions: string[];
    providers: Record<string, { identifier?: string } | undefined>;
};


/**
 * GET /api/v1/admins - txAdmin admins with their permissions and provider identifiers.
 * No password hashes or provider tokens are ever included.
 */
export default async function ApiAdmins(ctx: ApiKeyCtx) {
    const admins = (txCore.adminStore.getAdminsList() as VaultAdmin[]).map((a): ApiAdminRecord => ({
        name: a.name,
        master: !!a.master,
        permissions: a.permissions ?? [],
        identifiers: Object.values(a.providers ?? {})
            .map((p) => p?.identifier)
            .filter((id): id is string => typeof id === 'string' && id.length > 0),
    }));
    return sendData(ctx, { admins });
};
