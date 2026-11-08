import { StickyNoteIcon } from "lucide-react";
import { tsToLocaleDateTimeString } from "@/lib/dateTime";
import { useOpenActionModal } from "@/hooks/actionModal";
import type { PlayerHistoryItem } from "@shared/playerApiTypes";
import type { BanTemplatesDataType } from "@shared/otherTypes";
import { presetLabel } from "@shared/offenseLadder";
import { actionStatus, actionTypeTone, dateFormatter, EmptyRow, Panel, PanelHeader, Pill } from "./parts";


function actionLabel(action: PlayerHistoryItem) {
    // Game sanctions read like "Jail (30 months)"; the badge keeps the kind, the detail line the rest
    if (action.type === 'sanction') return action.sanction?.split(' (')[0] ?? 'Sanction';
    return action.type.charAt(0).toUpperCase() + action.type.slice(1);
}

/** The line under the reason: the action ID, then when it ends or stopped counting. */
function actionDetail(action: PlayerHistoryItem, serverTime: number) {
    const parts = [action.id];
    if (action.type === 'sanction' && action.sanction?.includes(' (')) parts.push(action.sanction);
    if (action.historical) {
        if (action.type === 'ban') {
            parts.push(!action.historical.expirationKnown
                ? 'Original expiration unknown'
                : typeof action.exp === 'number'
                    ? `Originally ended ${tsToLocaleDateTimeString(action.exp, 'medium', 'short')}`
                    : 'Originally permanent');
        }
    } else if (action.revokedBy) {
        parts.push(`Revoked by ${action.revokedBy} ${tsToLocaleDateTimeString(action.revokedAt ?? 0, 'medium', 'short')}`);
    } else if (typeof action.exp === 'number') {
        parts.push(`${action.exp < serverTime ? 'Ended' : 'Ends'} ${tsToLocaleDateTimeString(action.exp, 'medium', 'short')}`);
    } else if (action.type === 'ban') {
        parts.push('Permanent');
    }
    if (action.offenseUntil && !action.revokedBy && !action.historical) {
        parts.push(action.offenseUntil > serverTime
            ? `Counts as an offense until ${tsToLocaleDateTimeString(action.offenseUntil, 'medium', 'short')}`
            : 'No longer counts as an offense');
    }
    return parts.join(' · ');
}

type HistoryTableProps = {
    actions: PlayerHistoryItem[];
    banTemplates: BanTemplatesDataType[];
    serverTime: number;
};

/** Sanctions newest first; a row opens the action window, where it can be revoked or noted. */
export function HistoryTable({ actions, banTemplates, serverTime }: HistoryTableProps) {
    const openActionModal = useOpenActionModal();
    if (!actions.length) {
        return <EmptyRow>No bans, warns, kicks or game sanctions.</EmptyRow>;
    }

    return (
        <ul>
            {actions.map((action) => {
                const preset = banTemplates.find((template) => template.id === action.presetId);
                const status = actionStatus(action, serverTime);
                const isInactive = !!action.revokedBy || !!action.historical;
                return (
                    <li key={action.id} className="border-t first:border-t-0">
                        <button
                            type="button"
                            onClick={() => openActionModal(action.id)}
                            className="grid w-full grid-cols-[5.5rem_minmax(0,1fr)_auto] items-start gap-x-3 gap-y-1 px-4 py-2.5 text-left transition-colors hover:bg-muted/40 md:grid-cols-[5.5rem_minmax(0,1fr)_9rem_8rem_6.5rem]"
                        >
                            <span className={isInactive ? 'opacity-60' : undefined}>
                                <Pill tone={actionTypeTone[action.type]} className="max-w-full truncate">{actionLabel(action)}</Pill>
                            </span>
                            <span className={isInactive ? 'min-w-0 opacity-60' : 'min-w-0'}>
                                <span className="block truncate text-sm font-medium" title={action.reason}>
                                    {preset && <span className="mr-1 text-muted-foreground">[{presetLabel(preset)}]</span>}
                                    {action.reason || 'No reason given'}
                                </span>
                                <span className="block truncate font-mono text-xs text-muted-foreground">
                                    {actionDetail(action, serverTime)}
                                </span>
                            </span>
                            <span className="hidden truncate text-sm text-muted-foreground md:block">{action.author}</span>
                            <span
                                className="hidden text-sm tabular-nums text-muted-foreground md:block"
                                title={tsToLocaleDateTimeString(action.ts, 'long', 'long')}
                            >
                                {dateFormatter.format(action.ts * 1000)}
                            </span>
                            <span className="flex items-center justify-end gap-1.5">
                                {action.noteCount ? (
                                    <span
                                        className="inline-flex items-center gap-0.5 text-xs text-muted-foreground"
                                        title={action.noteCount === 1 ? '1 staff note' : `${action.noteCount} staff notes`}
                                    >
                                        <StickyNoteIcon className="size-3" />{action.noteCount}
                                    </span>
                                ) : null}
                                {status && <Pill tone={status.tone}>{status.label}</Pill>}
                            </span>
                        </button>
                    </li>
                );
            })}
        </ul>
    );
}

export default function PlayerHistoryTab(props: HistoryTableProps) {
    return (
        <Panel>
            <PanelHeader title="History" />
            <HistoryTable {...props} actions={[...props.actions].reverse()} />
        </Panel>
    );
}
