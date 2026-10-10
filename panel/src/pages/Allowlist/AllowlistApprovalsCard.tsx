import useSWR from "swr";
import { Loader2Icon, PlusIcon, Trash2Icon } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import Avatar from "@/components/Avatar";
import InlineCode from "@/components/InlineCode";
import { txToast } from "@/components/TxToaster";
import { useBackendApi } from "@/hooks/fetch";
import { useOpenPromptDialog } from "@/hooks/dialogs";
import { tsToLocaleDateTimeString } from "@/lib/dateTime";
import consts from "@shared/consts";
import type { GenericApiOkResp } from "@shared/genericApiTypes";
import type { WhitelistApprovalsResp } from "@shared/whitelistApiTypes";
import { APPROVALS_SWR_KEY } from "./AllowlistRequestsCard";

const acceptedIdTypes = Object.keys(consts.validIdentifiers);

function isValidIdentifier(identifier: string) {
    return Object.values(consts.validIdentifiers).some((regex) => regex.test(identifier));
}


export default function AllowlistApprovalsCard({ canManage }: { canManage: boolean }) {
    const openPromptDialog = useOpenPromptDialog();

    const listApi = useBackendApi<WhitelistApprovalsResp>({
        method: 'GET',
        path: APPROVALS_SWR_KEY,
    });
    const actionApi = useBackendApi<GenericApiOkResp>({
        method: 'POST',
        path: '/whitelist/approvals/:action',
    });

    const swr = useSWR(APPROVALS_SWR_KEY, async () => {
        const resp = await listApi({});
        if (!resp) throw new Error('No data returned.');
        if ('error' in resp) throw new Error(resp.error);
        return resp;
    });

    const runAction = async (action: 'add' | 'remove', identifier: string, successMsg: string) => {
        await actionApi({
            pathParams: { action },
            data: { identifier },
            toastLoadingMessage: 'Processing...',
            genericHandler: { successMsg },
        });
        swr.mutate();
    };

    const handleAdd = () => {
        openPromptDialog({
            title: 'Add Allowlist Approval',
            message: <p>
                Enter the player identifier to allowlist. Accepted types: <InlineCode>{acceptedIdTypes.join(', ')}</InlineCode>
            </p>,
            placeholder: 'discord:272800190639898628',
            submitLabel: 'Approve',
            required: true,
            onSubmit: (input) => {
                const identifier = input.trim();
                if (!isValidIdentifier(identifier)) {
                    txToast.error('The provided identifier is not valid.');
                    return;
                }
                runAction('add', identifier, 'Approval added.');
            },
        });
    };

    return (
        <Card className="flex flex-col">
            <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 space-y-0">
                <div className="space-y-1.5">
                    <CardTitle className="text-lg">
                        Approved, Pending Join {swr.data && <span className="text-muted-foreground font-normal">({swr.data.length})</span>}
                    </CardTitle>
                    <CardDescription>Approved players who have not joined the server yet.</CardDescription>
                </div>
                <Button size="sm" disabled={!canManage} onClick={handleAdd}>
                    <PlusIcon className="size-4 mr-1" /> Add Approval
                </Button>
            </CardHeader>

            <CardContent>
                {swr.error ? (
                    <div className="text-center py-10 text-destructive">
                        {(swr.error as Error).message}
                    </div>
                ) : !swr.data ? (
                    <div className="flex items-center justify-center py-10 text-muted-foreground">
                        <Loader2Icon className="animate-spin size-6 mr-2" /> Loading...
                    </div>
                ) : !swr.data.length ? (
                    <div className="text-center py-10 text-muted-foreground border rounded-lg border-dashed">
                        No pending approvals.
                    </div>
                ) : (
                    <div className="border rounded-lg overflow-x-auto">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Player</TableHead>
                                    <TableHead>Approved By</TableHead>
                                    <TableHead>Approved</TableHead>
                                    <TableHead className="text-right">Actions</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {swr.data.map((approval) => (
                                    <TableRow key={approval.identifier}>
                                        <TableCell className="max-w-[14rem]" title={`${approval.playerName}\n${approval.identifier}`}>
                                            <div className="flex items-center gap-2 min-w-0">
                                                <Avatar
                                                    className="size-6 text-xs shrink-0"
                                                    username={approval.playerName}
                                                    profilePicture={approval.playerAvatar ?? undefined}
                                                />
                                                <span className="truncate">{approval.playerName}</span>
                                            </div>
                                        </TableCell>
                                        <TableCell>{approval.approvedBy}</TableCell>
                                        <TableCell
                                            className="whitespace-nowrap text-muted-foreground"
                                            title={tsToLocaleDateTimeString(approval.tsApproved, 'long', 'long')}
                                        >
                                            {tsToLocaleDateTimeString(approval.tsApproved, 'short', 'short')}
                                        </TableCell>
                                        <TableCell className="text-right">
                                            <Button
                                                size="icon"
                                                variant="ghost"
                                                className="size-8 text-destructive hover:text-destructive"
                                                disabled={!canManage}
                                                title={canManage ? 'Remove Approval' : 'You do not have this permission.'}
                                                onClick={() => runAction('remove', approval.identifier, 'Approval removed.')}
                                            >
                                                <Trash2Icon className="size-4" />
                                            </Button>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
