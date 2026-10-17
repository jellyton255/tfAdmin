import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { msToDuration } from "@/lib/dateTime";
import { useRef, useState } from "react";
import type { DatabaseActionType } from "../../../../core/modules/Database/databaseTypes";
import { useOpenPlayerModal } from "@/hooks/playerModal";
import DateTimeCorrected from "@/components/DateTimeCorrected";
import { ModalTabInner } from "@/components/modal-tabs";
import StaffNoteText, { formatNoteAge } from "@/components/StaffNoteText";


const calcTextAreaLines = (text?: string) => {
    if (!text) return 3;
    const lines = text.trim().split('\n').length + 1;
    return Math.min(Math.max(lines, 3), 16);
}

function ActionReasonBox({ actionReason }: { actionReason: string }) {
    const textAreaRef = useRef<HTMLTextAreaElement>(null);
    const [textAreaLines, setTextAreaLines] = useState(calcTextAreaLines(actionReason));

    return <>
        <Label htmlFor="actionReason">
            Reason:
        </Label>
        <Textarea
            ref={textAreaRef}
            id="actionReason"
            className="w-full mt-1"
            readOnly={true}
            value={actionReason}
            //1rem of padding + 1.25rem per line
            style={{ height: `${1 + 1.25 * textAreaLines}rem` }}
        />
    </>
}


type ActionInfoTabProps = {
    action: DatabaseActionType;
    serverTime: number;
    tsFetch: number;
    setSelectedTab: (tab: string) => void;
}

export default function ActionInfoTab({ action, serverTime, tsFetch, setSelectedTab }: ActionInfoTabProps) {
    const openPlayerModal = useOpenPlayerModal();

    let banExpirationText: React.ReactNode;
    if (action.type === 'ban') {
        if (action.expiration === false) {
            banExpirationText = <span className="text-destructive-inline">Never</span>;
        } else if (action.expiration > serverTime) {
            const distance = msToDuration(
                (serverTime - action.expiration) * 1000,
                { units: ['mo', 'w', 'd', 'h', 'm'] }
            )
            banExpirationText = <span className="text-warning-inline">In {distance}</span>;
        } else {
            banExpirationText = <DateTimeCorrected
                className="opacity-75 cursor-help"
                serverTime={serverTime}
                tsObject={action.expiration}
                tsFetch={tsFetch}
            />;
        }
    }

    let warnAckedText: React.ReactNode;
    if (action.type === 'warn' && action.acked) {
        warnAckedText = <span className="opacity-75">Yes</span>;
    } else {
        warnAckedText = <span className="text-warning-inline">Not yet</span>;
    }

    let revokedText: React.ReactNode;
    if (action.revocation.timestamp) {
        revokedText = <span className="text-warning-inline">
            By {action.revocation.author} on <DateTimeCorrected
                isDateOnly
                className="cursor-help"
                serverTime={serverTime}
                tsObject={action.revocation.timestamp}
                tsFetch={tsFetch}
            />
        </span>;
    } else {
        revokedText = <span className="opacity-75">No</span>;
    }

    const visibleNotes = (action.notes ?? []).filter((note) => !note.deleted);
    const newestNote = [...visibleNotes].reverse().sort((a, b) => b.ts - a.ts)[0];

    //Player stuff
    const playerDisplayName = action.playerName !== false
        ? <span>{action.playerName}</span>
        : <span className="italic opacity-75">unknown player</span>;
    const targetLicenses = action.ids.filter(id => id.startsWith('license:'));
    const linkedPlayer = targetLicenses.length === 1 ? targetLicenses[0].split(':')[1] : false;
    const handleViewPlayerClick = () => {
        if (!linkedPlayer) return;
        openPlayerModal({ license: linkedPlayer });
    }

    return (
        <ModalTabInner>
            <dl className="pb-2">
                <div className="py-0.5 grid grid-cols-3 gap-4 px-0">
                    <dt className="text-sm font-medium leading-6 text-muted-foreground">Date/Time</dt>
                    <dd className="text-sm leading-6 col-span-2 mt-0">
                        <DateTimeCorrected
                            className="opacity-75 cursor-help"
                            serverTime={serverTime}
                            tsObject={action.timestamp}
                            tsFetch={tsFetch}
                        />
                    </dd>
                </div>
                {action.type === 'ban' && (
                    <div className="py-0.5 grid grid-cols-3 gap-4 px-0">
                        <dt className="text-sm font-medium leading-6 text-muted-foreground">Expiration</dt>
                        <dd className="text-sm leading-6 col-span-2 mt-0">{banExpirationText}</dd>
                    </div>
                )}
                {action.type === 'warn' && (
                    <div className="py-0.5 grid grid-cols-3 gap-4 px-0">
                        <dt className="text-sm font-medium leading-6 text-muted-foreground">Player Accepted</dt>
                        <dd className="text-sm leading-6 col-span-2 mt-0">{warnAckedText}</dd>
                    </div>
                )}
                {action.type !== 'kick' && (
                    <div className="py-0.5 grid grid-cols-3 gap-4 px-0">
                        <dt className="text-sm font-medium leading-6 text-muted-foreground">Revoked</dt>
                        <dd className="text-sm leading-6 col-span-2 mt-0">{revokedText}</dd>
                    </div>
                )}
                {action.revocation.reason && (
                    <div className="py-0.5 grid grid-cols-3 gap-4 px-0">
                        <dt className="text-sm font-medium leading-6 text-muted-foreground">Revoke Reason</dt>
                        <dd className="text-sm leading-6 col-span-2 mt-0 whitespace-pre-wrap break-words">{action.revocation.reason}</dd>
                    </div>
                )}

                <div className="py-0.5 grid grid-cols-3 gap-4 px-0">
                    <dt className="text-sm font-medium leading-6 text-muted-foreground">Admin</dt>
                    <dd className="text-sm leading-6 col-span-2 mt-0">{action.author}</dd>
                </div>
                <div className="py-0.5 grid grid-cols-3 gap-4 px-0">
                    <dt className="text-sm font-medium leading-6 text-muted-foreground">Player</dt>
                    <dd className="text-sm leading-6 col-span-2x mt-0">{playerDisplayName}</dd>
                    <dd className="text-right">
                        <Button
                            variant="outline"
                            size='inline'
                            style={{ minWidth: '8.25ch' }}
                            onClick={handleViewPlayerClick}
                            disabled={!linkedPlayer}
                        >View</Button>
                    </dd>
                </div>
            </dl>

            <ActionReasonBox actionReason={action.reason} />

            <div className="mt-3 flex items-center justify-between">
                <span className="text-sm font-medium">Newest Staff Note</span>
                <Button
                    variant="outline"
                    size="inline"
                    style={{ minWidth: '8.25ch' }}
                    onClick={() => setSelectedTab('Notes')}
                >{visibleNotes.length ? `All (${visibleNotes.length})` : 'Add'}</Button>
            </div>
            {newestNote ? (
                <div className="mt-1 px-2 py-1 border-l-4 border-muted rounded-r-sm bg-muted/30">
                    <StaffNoteText text={newestNote.text} />
                    <small className="block text-xs text-muted-foreground">
                        {newestNote.author} · {formatNoteAge(serverTime - newestNote.ts)}
                    </small>
                </div>
            ) : (
                <p className="mt-1 text-sm text-muted-foreground italic">No notes yet.</p>
            )}
        </ModalTabInner>
    );
}
