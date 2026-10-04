import { useMemo, useState } from "react";
import useSWR from "swr";
import { KeyRoundIcon, Loader2Icon, PlusIcon, Trash2Icon } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { txToast } from "@/components/TxToaster";
import { useBackendApi } from "@/hooks/fetch";
import { useAdminPerms } from "@/hooks/auth";
import { useOpenConfirmDialog } from "@/hooks/dialogs";
import { tsToLocaleDateTimeString } from "@/lib/dateTime";
import { cn } from "@/lib/utils";
import type { ApiKeyListResp, ApiKeyPublicRecord, ApiKeyRevokeResp } from "@shared/apiV1Types";
import ApiKeyCreateDialog from "./ApiKeyCreateDialog";
import ApiKeyTokenDialog from "./ApiKeyTokenDialog";


type KeyStatus = 'active' | 'expired' | 'revoked';
const getKeyStatus = (key: ApiKeyPublicRecord, now: number): KeyStatus => {
    if (key.revokedAt) return 'revoked';
    if (key.expiresAt && key.expiresAt <= now) return 'expired';
    return 'active';
};
const statusBadgeClass: Record<KeyStatus, string> = {
    active: 'bg-success/15 text-success border-success/30',
    expired: 'bg-warning/15 text-warning border-warning/30',
    revoked: 'bg-destructive/15 text-destructive border-destructive/30',
};


function ApiKeyRow({ apiKey, onRevoke, canManage }: {
    apiKey: ApiKeyPublicRecord;
    onRevoke: (key: ApiKeyPublicRecord) => void;
    canManage: boolean;
}) {
    const status = getKeyStatus(apiKey, Date.now());
    return (
        <TableRow className={cn(status !== 'active' && 'opacity-60')}>
            <TableCell>
                <div className="font-semibold">{apiKey.name}</div>
                <div className="font-mono text-xs text-muted-foreground">txk_{apiKey.id}.&hellip;</div>
            </TableCell>
            <TableCell>
                <Badge variant="outline" className={statusBadgeClass[status]}>{status}</Badge>
            </TableCell>
            <TableCell className="max-w-[18rem]">
                <div className="flex flex-wrap gap-1">
                    {apiKey.permissions.map((perm) => (
                        <Badge key={perm} variant="secondary" className="font-mono text-xs font-normal">{perm}</Badge>
                    ))}
                </div>
            </TableCell>
            <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                <div>{tsToLocaleDateTimeString(apiKey.createdAt, 'medium', 'short')}</div>
                <div>by {apiKey.createdBy}</div>
            </TableCell>
            <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                {apiKey.lastUsedAt ? tsToLocaleDateTimeString(apiKey.lastUsedAt, 'medium', 'short') : 'never'}
            </TableCell>
            <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                {apiKey.expiresAt ? tsToLocaleDateTimeString(apiKey.expiresAt, 'medium', 'short') : 'never'}
                {apiKey.allowedIps.length ? (
                    <div title={apiKey.allowedIps.join(', ')}>{apiKey.allowedIps.length} IP rule(s)</div>
                ) : null}
            </TableCell>
            <TableCell className="text-right">
                {status !== 'revoked' && (
                    <Button
                        size="sm"
                        variant="ghost"
                        className="text-destructive hover:text-destructive"
                        disabled={!canManage}
                        onClick={() => onRevoke(apiKey)}
                        title="Revoke this key"
                    >
                        <Trash2Icon className="size-4" />
                    </Button>
                )}
            </TableCell>
        </TableRow>
    );
}


export default function ApiKeysPage() {
    const { hasPerm } = useAdminPerms();
    const canManage = hasPerm('manage.admins');
    const openConfirmDialog = useOpenConfirmDialog();
    const [isCreateOpen, setIsCreateOpen] = useState(false);
    const [newToken, setNewToken] = useState<{ name: string; token: string } | null>(null);

    const listApi = useBackendApi<ApiKeyListResp>({
        method: 'GET',
        path: '/apiKeys',
    });
    const revokeApi = useBackendApi<ApiKeyRevokeResp, { id: string }>({
        method: 'POST',
        path: '/apiKeys/revoke',
    });

    const swr = useSWR('/apiKeys', async () => {
        const resp = await listApi({});
        if (!resp) throw new Error('No data returned');
        if ('error' in resp) throw new Error(resp.error.message);
        return resp.data;
    }, {
        isPaused: () => isCreateOpen || !!newToken,
    });

    const sortedKeys = useMemo(() => {
        if (!swr.data) return [];
        const now = Date.now();
        //active first, then expired, then revoked; newest first within each
        const rank: Record<KeyStatus, number> = { active: 0, expired: 1, revoked: 2 };
        return [...swr.data.keys].sort((a, b) => {
            const diff = rank[getKeyStatus(a, now)] - rank[getKeyStatus(b, now)];
            return diff !== 0 ? diff : b.createdAt - a.createdAt;
        });
    }, [swr.data]);

    const handleRevoke = (key: ApiKeyPublicRecord) => {
        openConfirmDialog({
            title: `Revoke API key "${key.name}"?`,
            message: 'Any integration using this key will stop working immediately. This cannot be undone.',
            actionLabel: 'Revoke',
            confirmBtnVariant: 'destructive',
            onConfirm: async () => {
                const resp = await revokeApi({
                    data: { id: key.id },
                    toastLoadingMessage: 'Revoking key...',
                });
                if (!resp) return;
                if ('error' in resp) {
                    txToast.error({ title: 'Failed to revoke key', msg: resp.error.message });
                } else {
                    txToast.success('API key revoked.');
                    swr.mutate();
                }
            },
        });
    };

    const handleCreated = (name: string, token: string) => {
        setIsCreateOpen(false);
        setNewToken({ name, token });
        swr.mutate();
    };

    return (
        <div className="flex flex-col h-full w-full gap-4 max-w-screen-xl mx-auto">
            <PageHeader title="API Keys" icon={<KeyRoundIcon />}>
                <Button size="sm" disabled={!canManage || !swr.data} onClick={() => setIsCreateOpen(true)}>
                    <PlusIcon className="size-4 mr-1" /> New key
                </Button>
            </PageHeader>

            <p className="text-sm text-muted-foreground px-2 -mt-2">
                API keys let external tools (bots, websites, scripts) call the <code className="font-mono">/api/v1</code> endpoints
                with a <code className="font-mono">Authorization: Bearer</code> header. Each key only carries the permissions you
                give it, and every action it takes is logged under <code className="font-mono">api:&lt;key name&gt;</code>.
            </p>

            {swr.error ? (
                <Alert variant="destructive" className="mx-2">
                    <AlertTitle>Failed to load API keys</AlertTitle>
                    <AlertDescription>{(swr.error as Error).message}</AlertDescription>
                </Alert>
            ) : !swr.data ? (
                <div className="flex items-center justify-center py-16 text-muted-foreground">
                    <Loader2Icon className="animate-spin size-6 mr-2" /> Loading...
                </div>
            ) : !sortedKeys.length ? (
                <div className="text-center py-16 text-muted-foreground border rounded-lg mx-2 border-dashed">
                    No API keys yet. {canManage ? 'Create one to get started.' : 'Ask an admin with the Manage Admins permission to create one.'}
                </div>
            ) : (
                <div className="border rounded-lg mx-2 overflow-x-auto">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Key</TableHead>
                                <TableHead>Status</TableHead>
                                <TableHead>Permissions</TableHead>
                                <TableHead>Created</TableHead>
                                <TableHead>Last used</TableHead>
                                <TableHead>Expires</TableHead>
                                <TableHead></TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {sortedKeys.map((key) => (
                                <ApiKeyRow key={key.id} apiKey={key} onRevoke={handleRevoke} canManage={canManage} />
                            ))}
                        </TableBody>
                    </Table>
                </div>
            )}

            {swr.data && (
                <ApiKeyCreateDialog
                    isOpen={isCreateOpen}
                    onClose={() => setIsCreateOpen(false)}
                    onCreated={handleCreated}
                    availablePermissions={swr.data.permissions}
                />
            )}
            <ApiKeyTokenDialog
                data={newToken}
                onClose={() => setNewToken(null)}
            />
        </div>
    );
}
