import { useState } from "react";
import type { DatabaseActionType } from "../../../../core/modules/Database/databaseTypes";
import { Button } from "@/components/ui/button";
import { GenericApiOkResp } from "@shared/genericApiTypes";
import { useAdminPerms } from "@/hooks/auth";
import { Loader2Icon } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useBackendApi } from "@/hooks/fetch";
import type { ApiRevokeActionReqSchema } from "../../../../core/routes/history/actions";
import ActionBanLengthForm from "./ActionBanLengthForm";
import ActionBanAppealForm from "./ActionBanAppealForm";


type ActionModifyTabProps = {
    action: DatabaseActionType;
    refreshModalData: () => void;
}

export default function ActionModifyTab({ action, refreshModalData }: ActionModifyTabProps) {
    const [isRevoking, setIsRevoking] = useState(false);
    const [reason, setReason] = useState('');
    const { hasPerm } = useAdminPerms();
    const revokeActionApi = useBackendApi<GenericApiOkResp, ApiRevokeActionReqSchema>({
        method: 'POST',
        path: `/history/revokeAction`,
    });

    const upperCasedType = action.type.charAt(0).toUpperCase() + action.type.slice(1);
    const doRevokeAction = () => {
        setIsRevoking(true);
        revokeActionApi({
            data: { actionId: action.id, reason: reason.trim() || undefined },
            toastLoadingMessage: `Revoking ${action.type}...`,
            genericHandler: {
                successMsg: `${upperCasedType} revoked.`,
            },
            success: (data) => {
                setIsRevoking(false);
                if ('success' in data) {
                    refreshModalData();
                }
            },
        });
    }

    const isAlreadyRevoked = !!action.revocation.timestamp;
    const hasRevokePerm = hasPerm(action.type === 'warn' ? 'players.warn' : 'players.ban');
    const revokeBtnLabel = isAlreadyRevoked
        ? `${action.type} revoked`
        : hasRevokePerm
            ? `Revoke ${upperCasedType}`
            : 'Revoke (no permission)';
    return (
        <div className="flex flex-col gap-6 px-1 mb-1 md:mb-4">
            {action.type === 'ban' && hasRevokePerm && (
                <ActionBanAppealForm ban={action} refreshModalData={refreshModalData} />
            )}
            {action.type === 'ban' && !isAlreadyRevoked && hasRevokePerm && (
                <ActionBanLengthForm ban={action} refreshModalData={refreshModalData} />
            )}
            <div className="space-y-2">
                <h3 className="text-xl">Revoke {upperCasedType}</h3>
                <p className="text-muted-foreground text-sm">
                    This is generally done when the player successfully appeals the {action.type} or the admin regrets issuing it.
                    <ul className="list-disc list-inside pt-1">
                        {action.type === 'ban' && <li>The player will be able to rejoin the server.</li>}
                        <li>The player will not be notified of the revocation.</li>
                        <li>This {action.type} will not be removed from the player history.</li>
                        <li>The revocation cannot be undone!</li>
                    </ul>
                </p>

                {!isAlreadyRevoked && hasRevokePerm && <div className="flex flex-col gap-1 pt-2">
                    <Label htmlFor="revokeReason">Revoke Reason (Staff Only)</Label>
                    <Textarea
                        id="revokeReason"
                        className="w-full min-h-[3.25rem] resize-y"
                        rows={2}
                        maxLength={2048}
                        disabled={isRevoking}
                        value={reason}
                        onChange={(e) => setReason(e.currentTarget.value)}
                        placeholder="Optional, for example: appeal accepted in ticket #1234."
                    />
                </div>}

                <Button
                    variant="destructive"
                    size='xs'
                    className="col-start-1 col-span-full xs:col-span-3 xs:col-start-2"
                    type="submit"
                    disabled={isAlreadyRevoked || !hasRevokePerm || isRevoking}
                    onClick={doRevokeAction}
                >
                    {isRevoking ? (
                        <span className="flex items-center leading-relaxed">
                            <Loader2Icon className="inline animate-spin h-4" /> Revoking...
                        </span>
                    ) : revokeBtnLabel}
                </Button>
            </div>
        </div>
    );
}
