import useSWR, { useSWRConfig } from "swr";
import { Trash2Icon } from "lucide-react";
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
import AllowlistSection from "./AllowlistSection";

const acceptedIdTypes = Object.keys(consts.validIdentifiers);

function isValidIdentifier(identifier: string) {
    return Object.values(consts.validIdentifiers).some((regex) => regex.test(identifier));
}

function useApprovalAction() {
    const { mutate } = useSWRConfig();
    const actionApi = useBackendApi<GenericApiOkResp>({
        method: 'POST',
        path: '/whitelist/approvals/:action',
    });
    return async (action: 'add' | 'remove', identifier: string, successMsg: string) => {
        await actionApi({
            pathParams: { action },
            data: { identifier },
            toastLoadingMessage: 'Processing...',
            genericHandler: { successMsg },
        });
        mutate(APPROVALS_SWR_KEY);
    };
}


/**
 * Opens the prompt to approve an identifier that has not joined yet.
 */
export function useAddApproval() {
    const openPromptDialog = useOpenPromptDialog();
    const runAction = useApprovalAction();
    return () => openPromptDialog({
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
}


export default function AllowlistApprovalsCard({ canManage }: { canManage: boolean }) {
    const runAction = useApprovalAction();
    const listApi = useBackendApi<WhitelistApprovalsResp>({
        method: 'GET',
        path: APPROVALS_SWR_KEY,
    });

    const swr = useSWR(APPROVALS_SWR_KEY, async () => {
        const resp = await listApi({});
        if (!resp) throw new Error('No data returned.');
        if ('error' in resp) throw new Error(resp.error);
        return resp;
    });

    return (
        <AllowlistSection
            title="Approved, Not Joined Yet"
            count={swr.data?.length.toString()}
            error={swr.error}
            isLoading={!swr.data}
            emptyMessage={swr.data && !swr.data.length ? 'No pending approvals.' : null}
        >
            {swr.data?.map((approval) => (
                <div
                    key={approval.identifier}
                    className="grid grid-cols-[minmax(0,1fr)_auto] md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_9rem_auto] items-center gap-x-4 gap-y-1 px-4 py-2.5"
                >
                    <div className="flex items-center gap-2 min-w-0" title={`${approval.playerName}\n${approval.identifier}`}>
                        <Avatar
                            className="size-5 text-[0.6rem] shrink-0"
                            username={approval.playerName}
                            profilePicture={approval.playerAvatar ?? undefined}
                        />
                        <span className="font-medium truncate">{approval.playerName}</span>
                    </div>
                    <span className="row-start-2 md:row-start-auto text-sm text-muted-foreground truncate">
                        By {approval.approvedBy}
                    </span>
                    <span
                        className="row-start-3 md:row-start-auto text-sm text-muted-foreground whitespace-nowrap"
                        title={tsToLocaleDateTimeString(approval.tsApproved, 'long', 'long')}
                    >
                        {tsToLocaleDateTimeString(approval.tsApproved, 'short', 'short')}
                    </span>
                    {canManage && (
                        <Button
                            size="icon"
                            variant="ghost-destructive"
                            className="size-8 col-start-2 row-start-1 row-span-3 md:col-start-auto md:row-start-auto md:row-span-1 justify-self-end"
                            title="Remove Approval"
                            onClick={() => runAction('remove', approval.identifier, 'Approval removed.')}
                        >
                            <Trash2Icon className="size-4" />
                        </Button>
                    )}
                </div>
            ))}
        </AllowlistSection>
    );
}
