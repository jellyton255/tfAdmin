import { useState } from "react";
import type { DatabaseActionBanType } from "../../../../core/modules/Database/databaseTypes";
import type { ApiChangeBanLengthReqSchema } from "../../../../core/routes/history/actions";
import { GenericApiOkResp } from "@shared/genericApiTypes";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useBackendApi } from "@/hooks/fetch";
import { Loader2Icon } from "lucide-react";


type ActionBanLengthFormProps = {
    ban: DatabaseActionBanType;
    refreshModalData: () => void;
};

/**
 * everfall: changes a ban's length, counted from when it was issued, with a required reason
 */
export default function ActionBanLengthForm({ ban, refreshModalData }: ActionBanLengthFormProps) {
    const [choice, setChoice] = useState('1 day');
    const [customValue, setCustomValue] = useState('');
    const [customUnits, setCustomUnits] = useState('days');
    const [reason, setReason] = useState('');
    const [isSaving, setIsSaving] = useState(false);
    const changeLengthApi = useBackendApi<GenericApiOkResp, ApiChangeBanLengthReqSchema>({
        method: 'POST',
        path: `/history/changeBanLength`,
    });

    const duration = choice === 'custom' ? `${customValue} ${customUnits}` : choice;
    const canSave = !isSaving && reason.trim().length >= 3 && (choice !== 'custom' || parseInt(customValue) > 0);
    const doChangeLength = () => {
        setIsSaving(true);
        changeLengthApi({
            data: { actionId: ban.id, duration, reason: reason.trim() },
            toastLoadingMessage: 'Changing the ban length...',
            genericHandler: { successMsg: 'Ban length changed.' },
            success: (data) => {
                setIsSaving(false);
                if ('success' in data) {
                    setReason('');
                    refreshModalData();
                }
            },
        });
    };

    return (
        <div className="space-y-2">
            <h3 className="text-xl">Change Length</h3>
            <div className="grid gap-1">
                <Label htmlFor="banLengthSelect">New Length (From When the Ban Was Issued)</Label>
                <div className="flex flex-row gap-2">
                    <Select value={choice} onValueChange={setChoice} disabled={isSaving}>
                        <SelectTrigger id="banLengthSelect" className="tracking-wide">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="tracking-wide">
                            <SelectItem value="custom" className="font-bold">Custom</SelectItem>
                            <SelectItem value="2 hours">2 HOURS</SelectItem>
                            <SelectItem value="8 hours">8 HOURS</SelectItem>
                            <SelectItem value="1 day">1 DAY</SelectItem>
                            <SelectItem value="2 days">2 DAYS</SelectItem>
                            <SelectItem value="1 week">1 WEEK</SelectItem>
                            <SelectItem value="2 weeks">2 WEEKS</SelectItem>
                            <SelectItem value="permanent" className="font-bold">Permanent</SelectItem>
                        </SelectContent>
                    </Select>
                    {choice === 'custom' && <>
                        <Input
                            type="number"
                            placeholder="3"
                            className="w-24 shrink-0"
                            min={1}
                            value={customValue}
                            onChange={(e) => setCustomValue(e.currentTarget.value)}
                            disabled={isSaving}
                        />
                        <Select value={customUnits} onValueChange={setCustomUnits} disabled={isSaving}>
                            <SelectTrigger className="tracking-wide w-36 shrink-0">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent className="tracking-wide">
                                <SelectItem value="hours">HOURS</SelectItem>
                                <SelectItem value="days">DAYS</SelectItem>
                                <SelectItem value="weeks">WEEKS</SelectItem>
                                <SelectItem value="months">MONTHS</SelectItem>
                            </SelectContent>
                        </Select>
                    </>}
                </div>
            </div>
            <div className="grid gap-1">
                <Label htmlFor="banLengthReason">Reason (Staff Only)</Label>
                <Input
                    id="banLengthReason"
                    maxLength={2048}
                    value={reason}
                    onChange={(e) => setReason(e.currentTarget.value)}
                    placeholder="Appeal accepted in ticket #1234."
                    disabled={isSaving}
                />
            </div>
            <Button size="xs" disabled={!canSave} onClick={doChangeLength}>
                {isSaving ? (
                    <span className="flex items-center leading-relaxed">
                        <Loader2Icon className="inline animate-spin h-4" /> Saving...
                    </span>
                ) : 'Change Length'}
            </Button>
        </div>
    );
}
