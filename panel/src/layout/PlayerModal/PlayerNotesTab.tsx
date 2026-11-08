import { useState } from "react";
import { CornerDownRightIcon, Trash2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
    DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import StaffNoteText, { formatNoteAge } from "@/components/StaffNoteText";
import { useAdminPerms, useAuth } from "@/hooks/auth";
import { useBackendApi } from "@/hooks/fetch";
import { useOpenConfirmDialog } from "@/hooks/dialogs";
import type { PlayerModalRefType } from "@/hooks/playerModal";
import { tsToLocaleDateTimeString } from "@/lib/dateTime";
import { isNoteAuthor } from "@shared/noteAuthor";
import type { GenericApiOkResp } from "@shared/genericApiTypes";
import type { PlayerModalPlayerData, PlayerNoteItem } from "@shared/playerApiTypes";
import { EmptyRow, Panel, PanelHeader } from "./parts";


/** One note, as a card. The overview shows the newest ones read-only. */
export function NoteCard({ note, serverTime, children }: { note: PlayerNoteItem; serverTime: number; children?: React.ReactNode }) {
    return (
        <Panel className="flex gap-2 px-4 py-3">
            <div className="min-w-0 grow">
                <StaffNoteText text={note.text} />
                <small
                    className="mt-1 block text-xs text-muted-foreground"
                    title={tsToLocaleDateTimeString(note.ts, 'long', 'short')}
                >
                    {note.author} · {formatNoteAge(serverTime - note.ts)}
                </small>
            </div>
            {children}
        </Panel>
    );
}

type PlayerNotesTabProps = {
    playerRef: PlayerModalRefType;
    player: PlayerModalPlayerData;
    serverTime: number;
    refreshModalData: () => void;
};

export default function PlayerNotesTab({ playerRef, player, serverTime, refreshModalData }: PlayerNotesTabProps) {
    const [draft, setDraft] = useState('');
    const [isSaving, setIsSaving] = useState(false);
    const openConfirmDialog = useOpenConfirmDialog();
    const saveNoteApi = useBackendApi<GenericApiOkResp>({ method: 'POST', path: `/player/save_note` });
    const deleteNoteApi = useBackendApi<GenericApiOkResp>({ method: 'POST', path: `/player/delete_note` });
    const moveNoteApi = useBackendApi<GenericApiOkResp>({ method: 'POST', path: `/player/move_note` });
    const { authData } = useAuth();
    const { hasPerm } = useAdminPerms();
    const notes = player.noteHistory ?? [];
    const sanctions = [...player.actionHistory].reverse();
    const canMove = (note: PlayerNoteItem) => sanctions.length > 0
        && (hasPerm('manage.admins') || (!!authData && isNoteAuthor(note, authData.name)));

    const handleMove = (note: PlayerNoteItem, actionId: string) => {
        moveNoteApi({
            queryParams: playerRef,
            data: { noteId: note.id, actionId },
            toastLoadingMessage: 'Moving note...',
            genericHandler: { successMsg: `Note moved to ${actionId}.` },
            success: (data) => {
                if ('success' in data) refreshModalData();
            },
        });
    };

    const doSaveNote = () => {
        const note = draft.trim();
        if (!note.length || isSaving) return;
        setIsSaving(true);
        saveNoteApi({
            queryParams: playerRef,
            data: { note },
            toastLoadingMessage: 'Adding note...',
            genericHandler: { successMsg: 'Note added.' },
            success: (data) => {
                setIsSaving(false);
                if ('success' in data) {
                    setDraft('');
                    refreshModalData();
                }
            },
            error: () => setIsSaving(false),
        });
    };

    const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (event.key === 'Enter' && !event.shiftKey && !window.txIsMobile) {
            event.preventDefault();
            doSaveNote();
        }
    };

    const handleDelete = (note: PlayerNoteItem) => {
        openConfirmDialog({
            title: 'Delete Note',
            message: `Delete the note ${note.author} added ${tsToLocaleDateTimeString(note.ts, 'medium', 'short')}?`,
            actionLabel: 'Delete',
            confirmBtnVariant: 'destructive',
            onConfirm: () => {
                deleteNoteApi({
                    queryParams: playerRef,
                    data: { noteId: note.id },
                    toastLoadingMessage: 'Deleting note...',
                    genericHandler: { successMsg: 'Note deleted.' },
                    success: (data) => {
                        if ('success' in data) refreshModalData();
                    },
                });
            },
        });
    };

    return (
        <div className="flex flex-col gap-3">
            <Panel>
                <PanelHeader title="Add Note" />
                <div className="flex flex-col gap-2 p-4 sm:flex-row sm:items-end">
                    <Textarea
                        id="playerNotes"
                        className="min-h-[3.25rem] w-full resize-y"
                        rows={2}
                        maxLength={4096}
                        disabled={!player.isRegistered || isSaving}
                        value={draft}
                        onChange={(e) => setDraft(e.currentTarget.value)}
                        onKeyDown={handleKeyDown}
                        placeholder={player.isRegistered
                            ? 'Add a note about this player.'
                            : 'Cannot add notes to players that are not registered.'}
                    />
                    <Button
                        variant="outline"
                        size="sm"
                        className="shrink-0"
                        onClick={doSaveNote}
                        disabled={!player.isRegistered || isSaving || !draft.trim().length}
                    >Add Note</Button>
                </div>
            </Panel>
            {!notes.length && <Panel><EmptyRow>No notes yet.</EmptyRow></Panel>}
            {notes.map((note) => (
                <NoteCard key={note.id} note={note} serverTime={serverTime}>
                    {canMove(note) && <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button size="icon" variant="ghost-muted" className="size-7 shrink-0" title="Move to a Sanction">
                                <CornerDownRightIcon className="size-4" />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="max-w-sm">
                            <DropdownMenuLabel>Move to a Sanction</DropdownMenuLabel>
                            {sanctions.map((action) => (
                                <DropdownMenuItem
                                    key={action.id}
                                    className="cursor-pointer flex-col items-start gap-0"
                                    onClick={() => handleMove(note, action.id)}
                                >
                                    <span className="text-xs text-muted-foreground">
                                        <span className="font-mono">{action.id}</span> · {action.type} · {tsToLocaleDateTimeString(action.ts, 'medium', 'short')}
                                    </span>
                                    <span className="line-clamp-1">{action.reason}</span>
                                </DropdownMenuItem>
                            ))}
                        </DropdownMenuContent>
                    </DropdownMenu>}
                    <Button
                        size="icon"
                        variant="ghost-muted"
                        className="size-7 shrink-0 hover:text-destructive"
                        title="Delete Note"
                        onClick={() => handleDelete(note)}
                    >
                        <Trash2Icon className="size-4" />
                    </Button>
                </NoteCard>
            ))}
        </div>
    );
}
