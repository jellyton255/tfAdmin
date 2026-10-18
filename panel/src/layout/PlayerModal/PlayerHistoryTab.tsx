import { cn } from "@/lib/utils";
import { tsToLocaleDateTimeString } from "@/lib/dateTime";
import { PlayerHistoryItem } from "@shared/playerApiTypes";
import InlineCode from "@/components/InlineCode";
import { useOpenActionModal } from "@/hooks/actionModal";
import { ModalTabInner, ModalTabMessage } from "@/components/modal-tabs";
import { StickyNoteIcon } from "lucide-react";
import type { BanTemplatesDataType } from "@shared/otherTypes";
import { presetLabel } from "@shared/offenseLadder";


type HistoryItemProps = {
    action: PlayerHistoryItem,
    serverTime: number,
    preset?: BanTemplatesDataType,
    modalOpener: (actionId: string) => void,
}

function HistoryItem({ action, serverTime, preset, modalOpener }: HistoryItemProps) {
    let footerNote, borderColorClass, actionMessage;
    if (action.type === 'ban') {
        borderColorClass = 'border-destructive';
        actionMessage = `BANNED by ${action.author}`;
    } else if (action.type === 'warn') {
        borderColorClass = 'border-warning';
        actionMessage = `WARNED by ${action.author}`;
    } else if (action.type === 'kick') {
        borderColorClass = 'border-muted-foreground/40';
        actionMessage = `KICKED by ${action.author}`;
    } else if (action.type === 'sanction') {
        borderColorClass = 'border-muted-foreground/40';
        actionMessage = `${action.sanction?.toUpperCase()} by ${action.author}`;
    }
    if (action.revokedBy) {
        borderColorClass = '';
        const revocationDate = tsToLocaleDateTimeString(action.revokedAt ?? 0, 'medium', 'short');
        footerNote = `Revoked by ${action.revokedBy} on ${revocationDate}.`;
    } else if (typeof action.exp === 'number') {
        const expirationDate = tsToLocaleDateTimeString(action.exp, 'medium', 'short');
        footerNote = (action.exp < serverTime) ? `Expired on ${expirationDate}.` : `Expires in ${expirationDate}.`;
    }
    //Preset offenses count toward the ladder for a while, then stay here without counting
    let offenseNote;
    if (action.offenseUntil && !action.revokedBy) {
        offenseNote = action.offenseUntil > serverTime
            ? `Counts as an offense until ${tsToLocaleDateTimeString(action.offenseUntil, 'medium', 'short')}.`
            : 'No longer counts as an offense.';
    }

    return (
        <div
            onClick={() => { modalOpener(action.id) }}
            className={cn(
                'pl-2 border-l-4 hover:bg-muted rounded-r-sm bg-muted/30 cursor-pointer',
                borderColorClass
            )}
        >
            <div className="flex w-full justify-between">
                <strong className="text-sm text-muted-foreground">{actionMessage}</strong>
                <small className="text-right text-2xs space-x-1">
                    {action.noteCount ? (
                        <span
                            className="inline-flex items-center gap-0.5 text-muted-foreground"
                            title={action.noteCount === 1 ? '1 staff note' : `${action.noteCount} staff notes`}
                        >
                            <StickyNoteIcon className="size-3" />{action.noteCount}
                        </span>
                    ) : null}
                    <InlineCode className="tracking-widest">{action.id}</InlineCode>
                    <span
                        className="opacity-75 cursor-help"
                        title={tsToLocaleDateTimeString(action.ts, 'long', 'long')}
                    >
                        {tsToLocaleDateTimeString(action.ts, 'medium', 'short')}
                    </span>
                </small>
            </div>
            <span className="text-sm">
                {preset && <strong className="pr-1">[{presetLabel(preset)}]</strong>}
                {action.reason}
            </span>
            {(footerNote || offenseNote) && <small className="block text-xs opacity-75">{footerNote} {offenseNote}</small>}
        </div>
    );
}


type PlayerHistoryTabProps = {
    actionHistory: PlayerHistoryItem[],
    banTemplates: BanTemplatesDataType[],
    serverTime: number,
    refreshModalData: () => void,
}

export default function PlayerHistoryTab({ actionHistory, banTemplates, serverTime, refreshModalData }: PlayerHistoryTabProps) {
    const openActionModal = useOpenActionModal();

    if (!actionHistory.length) {
        return <ModalTabMessage>
            No bans, warns, kicks or game sanctions found.
        </ModalTabMessage>;
    }

    const doOpenActionModal = (actionId: string) => {
        openActionModal(actionId);
    }

    const reversedActionHistory = [...actionHistory].reverse();
    return (
        <ModalTabInner className="flex flex-col gap-1">
            {reversedActionHistory.map((action) => (
                <HistoryItem
                    key={action.id}
                    action={action}
                    serverTime={serverTime}
                    preset={banTemplates.find((template) => template.id === action.presetId)}
                    modalOpener={doOpenActionModal}
                />
            ))}
        </ModalTabInner>
    );
}
