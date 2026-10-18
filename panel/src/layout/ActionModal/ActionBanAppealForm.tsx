import { useState } from "react";
import type { DatabaseActionBanType } from "../../../../core/modules/Database/databaseTypes";
import type { ApiBanAppealReqSchema } from "../../../../core/routes/history/actions";
import { GenericApiOkResp } from "@shared/genericApiTypes";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useBackendApi } from "@/hooks/fetch";
import { Loader2Icon } from "lucide-react";

const NO_APPEAL = 'none';


type ActionBanAppealFormProps = {
    ban: DatabaseActionBanType;
    refreshModalData: () => void;
};

/**
 * everfall: records where a ban's appeal stands. Accepting it does not lift the ban.
 */
export default function ActionBanAppealForm({ ban, refreshModalData }: ActionBanAppealFormProps) {
    const [status, setStatus] = useState<string>(ban.appeal?.status ?? NO_APPEAL);
    const [ticket, setTicket] = useState(ban.appeal?.ticket ?? '');
    const [isSaving, setIsSaving] = useState(false);
    const appealApi = useBackendApi<GenericApiOkResp, ApiBanAppealReqSchema>({
        method: 'POST',
        path: `/history/banAppeal`,
    });

    const isUnchanged = status === (ban.appeal?.status ?? NO_APPEAL) && ticket.trim() === (ban.appeal?.ticket ?? '');
    const doSaveAppeal = () => {
        const nextStatus = status === 'open' || status === 'denied' || status === 'accepted' ? status : null;
        setIsSaving(true);
        appealApi({
            data: { actionId: ban.id, status: nextStatus, ticket: ticket.trim() || undefined },
            toastLoadingMessage: 'Saving the appeal...',
            genericHandler: { successMsg: 'Appeal saved.' },
            success: (data) => {
                setIsSaving(false);
                if ('success' in data) refreshModalData();
            },
        });
    };

    return (
        <div className="space-y-2">
            <h3 className="text-xl">Appeal</h3>
            <div className="flex flex-col xs:flex-row gap-2">
                <div className="grid gap-1 xs:w-44 shrink-0">
                    <Label htmlFor="banAppealStatus">Status</Label>
                    <Select value={status} onValueChange={setStatus} disabled={isSaving}>
                        <SelectTrigger id="banAppealStatus">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value={NO_APPEAL}>No Appeal</SelectItem>
                            <SelectItem value="open">Open</SelectItem>
                            <SelectItem value="denied">Denied</SelectItem>
                            <SelectItem value="accepted">Accepted</SelectItem>
                        </SelectContent>
                    </Select>
                </div>
                <div className="grid gap-1 grow">
                    <Label htmlFor="banAppealTicket">Ticket</Label>
                    <Input
                        id="banAppealTicket"
                        maxLength={256}
                        value={ticket}
                        onChange={(e) => setTicket(e.currentTarget.value)}
                        placeholder="Ticket link or number"
                        disabled={isSaving || status === NO_APPEAL}
                    />
                </div>
            </div>
            {status === 'accepted' && (
                <p className="text-sm text-muted-foreground">
                    Accepting does not lift the ban. Revoke it or change its length below.
                </p>
            )}
            <Button size="xs" disabled={isSaving || isUnchanged} onClick={doSaveAppeal}>
                {isSaving ? (
                    <span className="flex items-center leading-relaxed">
                        <Loader2Icon className="inline animate-spin h-4" /> Saving...
                    </span>
                ) : 'Save Appeal'}
            </Button>
        </div>
    );
}
