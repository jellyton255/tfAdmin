import { useState } from "react";
import useSWR from "swr";
import { CheckIcon, CopyIcon, Loader2Icon, PlusIcon, SendIcon, Trash2Icon, WebhookIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { txToast } from "@/components/TxToaster";
import { useBackendApi } from "@/hooks/fetch";
import { useOpenConfirmDialog } from "@/hooks/dialogs";
import { tsToLocaleDateTimeString } from "@/lib/dateTime";
import { cn } from "@/lib/utils";
import type { ApiWebhookRecord, ApiWebhookResp, ApiWebhookTestResp, ApiWebhookUpdateReq, ApiWebhooksListResp } from "@shared/apiV1Types";
import WebhookCreateDialog from "./WebhookCreateDialog";


function SecretDialog({ data, onClose }: { data: { name: string; secret: string } | null; onClose: () => void }) {
    const [copied, setCopied] = useState(false);
    const handleCopy = async () => {
        if (!data) return;
        try {
            await navigator.clipboard.writeText(data.secret);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch (error) {
            txToast.error({ title: 'Copy failed', msg: 'Select the secret and copy it manually.' });
        }
    };
    return (
        <Dialog open={!!data} onOpenChange={(open) => { if (!open) { setCopied(false); onClose(); } }}>
            <DialogContent className="max-w-lg">
                <DialogHeader>
                    <DialogTitle>Webhook created</DialogTitle>
                    <DialogDescription>
                        Copy the signing secret for <span className="font-semibold">{data?.name}</span> now. It will not be shown again.
                    </DialogDescription>
                </DialogHeader>
                <div className="flex items-stretch gap-2">
                    <code className="flex-1 font-mono text-xs sm:text-sm break-all rounded-md border bg-muted px-3 py-2 select-all">
                        {data?.secret}
                    </code>
                    <Button variant="outline" size="icon" onClick={handleCopy} title="Copy secret">
                        {copied ? <CheckIcon className="size-4 text-success" /> : <CopyIcon className="size-4" />}
                    </Button>
                </div>
                <Alert>
                    <AlertTitle>Verifying deliveries</AlertTitle>
                    <AlertDescription className="text-xs">
                        Every POST carries <code className="font-mono">X-TxAdmin-Signature: t=&lt;ms&gt;,v1=&lt;hex&gt;</code>.
                        Compute HMAC-SHA256 over <code className="font-mono">{'`${t}.${rawBody}`'}</code> with this secret and compare it to <code className="font-mono">v1</code>.
                        See <code className="font-mono">docs/api.md</code> for a snippet.
                    </AlertDescription>
                </Alert>
                <DialogFooter>
                    <Button onClick={onClose}>Done</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}


function WebhookRow({ webhook, canManage, onToggle, onTest, onDelete, busy }: {
    webhook: ApiWebhookRecord;
    canManage: boolean;
    busy: boolean;
    onToggle: (webhook: ApiWebhookRecord, enabled: boolean) => void;
    onTest: (webhook: ApiWebhookRecord) => void;
    onDelete: (webhook: ApiWebhookRecord) => void;
}) {
    const isAll = webhook.events[0] === '*';
    return (
        <TableRow className={cn(!webhook.enabled && 'opacity-60')}>
            <TableCell>
                <div className="font-semibold">{webhook.name}</div>
                <div className="font-mono text-xs text-muted-foreground break-all max-w-[22rem]" title={webhook.url}>{webhook.url}</div>
            </TableCell>
            <TableCell>
                <Switch
                    checked={webhook.enabled}
                    disabled={!canManage || busy}
                    onCheckedChange={(c) => onToggle(webhook, c)}
                    title={webhook.enabled ? 'Enabled' : 'Disabled'}
                />
            </TableCell>
            <TableCell className="max-w-[18rem]">
                {isAll ? (
                    <Badge variant="secondary" className="font-mono text-xs font-normal">all events</Badge>
                ) : (
                    <div className="flex flex-wrap gap-1">
                        {webhook.events.map((ev) => (
                            <Badge key={ev} variant="secondary" className="font-mono text-xs font-normal">{ev}</Badge>
                        ))}
                    </div>
                )}
            </TableCell>
            <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                {webhook.lastDeliveryAt ? (
                    <>
                        <div className={webhook.lastDeliveryOk ? 'text-success' : 'text-destructive'}>
                            {webhook.lastDeliveryOk ? 'ok' : 'failed'}
                        </div>
                        <div>{tsToLocaleDateTimeString(webhook.lastDeliveryAt, 'medium', 'short')}</div>
                    </>
                ) : 'never'}
                <div>{webhook.deliveredCount} ok / {webhook.failedCount} failed</div>
            </TableCell>
            <TableCell className="text-right whitespace-nowrap">
                <Button size="sm" variant="ghost" disabled={!canManage || busy} onClick={() => onTest(webhook)} title="Send a webhook.test event">
                    <SendIcon className="size-4" />
                </Button>
                <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" disabled={!canManage || busy} onClick={() => onDelete(webhook)} title="Delete this webhook">
                    <Trash2Icon className="size-4" />
                </Button>
            </TableCell>
        </TableRow>
    );
}


export default function WebhooksSection({ canManage }: { canManage: boolean }) {
    const openConfirmDialog = useOpenConfirmDialog();
    const [isCreateOpen, setIsCreateOpen] = useState(false);
    const [newSecret, setNewSecret] = useState<{ name: string; secret: string } | null>(null);
    const [busyId, setBusyId] = useState<string | null>(null);

    const listApi = useBackendApi<ApiWebhooksListResp>({ method: 'GET', path: '/webhooks' });
    const updateApi = useBackendApi<ApiWebhookResp, ApiWebhookUpdateReq & { id: string }>({ method: 'POST', path: '/webhooks/update' });
    const removeApi = useBackendApi<ApiWebhookResp, { id: string }>({ method: 'POST', path: '/webhooks/remove' });
    const testApi = useBackendApi<ApiWebhookTestResp, { id: string }>({ method: 'POST', path: '/webhooks/test' });

    const swr = useSWR('/webhooks', async () => {
        const resp = await listApi({});
        if (!resp) throw new Error('No data returned');
        if ('error' in resp) throw new Error(resp.error.message);
        return resp.data;
    }, {
        isPaused: () => isCreateOpen || !!newSecret,
    });

    const handleToggle = async (webhook: ApiWebhookRecord, enabled: boolean) => {
        setBusyId(webhook.id);
        try {
            const resp = await updateApi({ data: { id: webhook.id, enabled } });
            if (!resp) return;
            if ('error' in resp) {
                txToast.error({ title: 'Failed to update webhook', msg: resp.error.message });
            } else {
                swr.mutate();
            }
        } finally {
            setBusyId(null);
        }
    };

    const handleTest = async (webhook: ApiWebhookRecord) => {
        setBusyId(webhook.id);
        try {
            const resp = await testApi({ data: { id: webhook.id }, toastLoadingMessage: 'Sending test event...' });
            if (!resp) return;
            if ('error' in resp) {
                txToast.error({ title: 'Test failed', msg: resp.error.message });
            } else if (resp.data.delivery.status === 'ok') {
                txToast.success(`Delivered (HTTP ${resp.data.delivery.httpStatus}).`);
            } else {
                txToast.warning({
                    title: 'Not delivered yet',
                    msg: `${resp.data.delivery.error ?? 'No response'}. ${resp.data.delivery.status === 'pending' ? 'txAdmin will retry with backoff.' : ''}`,
                });
            }
            swr.mutate();
        } finally {
            setBusyId(null);
        }
    };

    const handleDelete = (webhook: ApiWebhookRecord) => {
        openConfirmDialog({
            title: `Delete webhook "${webhook.name}"?`,
            message: 'Pending retries are dropped and no further events are sent to this URL.',
            actionLabel: 'Delete',
            confirmBtnVariant: 'destructive',
            onConfirm: async () => {
                const resp = await removeApi({ data: { id: webhook.id }, toastLoadingMessage: 'Deleting webhook...' });
                if (!resp) return;
                if ('error' in resp) {
                    txToast.error({ title: 'Failed to delete webhook', msg: resp.error.message });
                } else {
                    txToast.success('Webhook deleted.');
                    swr.mutate();
                }
            },
        });
    };

    const handleCreated = (name: string, secret: string) => {
        setIsCreateOpen(false);
        setNewSecret({ name, secret });
        swr.mutate();
    };

    return (
        <div className="flex flex-col gap-3 mt-6">
            <div className="flex items-center justify-between px-2">
                <h2 className="text-lg font-semibold flex items-center gap-2">
                    <WebhookIcon className="size-5" /> Webhooks
                </h2>
                <Button size="sm" disabled={!canManage || !swr.data} onClick={() => setIsCreateOpen(true)}>
                    <PlusIcon className="size-4 mr-1" /> New webhook
                </Button>
            </div>
            <p className="text-sm text-muted-foreground px-2">
                Webhooks push events (bans, warns, joins, server status...) to your own services as signed HTTPS POSTs.
                Failed deliveries are retried for about an hour. Consumers that can't receive callbacks can poll <code className="font-mono">GET /api/v1/events</code> instead.
            </p>

            {swr.error ? (
                <Alert variant="destructive" className="mx-2">
                    <AlertTitle>Failed to load webhooks</AlertTitle>
                    <AlertDescription>{(swr.error as Error).message}</AlertDescription>
                </Alert>
            ) : !swr.data ? (
                <div className="flex items-center justify-center py-8 text-muted-foreground">
                    <Loader2Icon className="animate-spin size-6 mr-2" /> Loading...
                </div>
            ) : !swr.data.webhooks.length ? (
                <div className="text-center py-10 text-muted-foreground border rounded-lg mx-2 border-dashed">
                    No webhooks yet.
                </div>
            ) : (
                <div className="border rounded-lg mx-2 overflow-x-auto">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Webhook</TableHead>
                                <TableHead>Enabled</TableHead>
                                <TableHead>Events</TableHead>
                                <TableHead>Last delivery</TableHead>
                                <TableHead></TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {swr.data.webhooks.map((webhook) => (
                                <WebhookRow
                                    key={webhook.id}
                                    webhook={webhook}
                                    canManage={canManage}
                                    busy={busyId === webhook.id}
                                    onToggle={handleToggle}
                                    onTest={handleTest}
                                    onDelete={handleDelete}
                                />
                            ))}
                        </TableBody>
                    </Table>
                </div>
            )}

            {swr.data && (
                <WebhookCreateDialog
                    isOpen={isCreateOpen}
                    onClose={() => setIsCreateOpen(false)}
                    onCreated={handleCreated}
                    eventTypes={swr.data.eventTypes}
                />
            )}
            <SecretDialog data={newSecret} onClose={() => setNewSecret(null)} />
        </div>
    );
}
