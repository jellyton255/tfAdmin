import { useState } from "react";
import { PencilIcon, Trash2Icon } from "lucide-react";
import type { DatabaseActionType, DatabaseNoteType } from "../../../../core/modules/Database/databaseTypes";
import type { ApiActionNoteReqSchema } from "../../../../core/routes/history/actions";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { ModalTabInner } from "@/components/modal-tabs";
import StaffNoteText, { formatNoteAge } from "@/components/StaffNoteText";
import { useAdminPerms, useAuth } from "@/hooks/auth";
import { useBackendApi } from "@/hooks/fetch";
import { useOpenConfirmDialog } from "@/hooks/dialogs";
import { tsToLocaleDateTimeString } from "@/lib/dateTime";
import { cn } from "@/lib/utils";
import { GenericApiOkResp } from "@shared/genericApiTypes";
import { isNoteAuthor } from "@shared/noteAuthor";


type NoteItemProps = {
    note: DatabaseNoteType;
    serverTime: number;
    canEdit: boolean;
    canDelete: boolean;
    isBusy: boolean;
    onSaveEdit: (note: DatabaseNoteType, text: string) => void;
    onDelete: (note: DatabaseNoteType) => void;
}

function NoteItem({ note, serverTime, canEdit, canDelete, isBusy, onSaveEdit, onDelete }: NoteItemProps) {
    const [editDraft, setEditDraft] = useState<string | null>(null);

    const saveEdit = () => {
        if (editDraft === null) return;
        const text = editDraft.trim();
        if (!text.length) return;
        if (text !== note.text) onSaveEdit(note, text);
        setEditDraft(null);
    }

    const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (event.key === 'Enter' && !event.shiftKey && !window.txIsMobile) {
            event.preventDefault();
            saveEdit();
        } else if (event.key === 'Escape') {
            event.stopPropagation();
            setEditDraft(null);
        }
    }

    if (editDraft !== null) {
        return <li className="flex flex-col gap-2 px-2 py-1.5 border-l-4 border-primary rounded-r-sm bg-muted/30">
            <Textarea
                autoFocus
                className="w-full min-h-[3.25rem] resize-y"
                rows={2}
                maxLength={4096}
                value={editDraft}
                onChange={(e) => setEditDraft(e.currentTarget.value)}
                onKeyDown={handleKeyDown}
            />
            <div className="flex justify-end gap-2">
                <Button variant="ghost" size="xs" onClick={() => setEditDraft(null)}>Cancel</Button>
                <Button size="xs" onClick={saveEdit} disabled={isBusy || !editDraft.trim().length}>Save</Button>
            </div>
        </li>;
    }

    return <li className={cn(
        "group flex gap-2 px-2 py-1 border-l-4 border-muted rounded-r-sm bg-muted/30",
        note.deleted && "opacity-60",
    )}>
        <div className="min-w-0 grow">
            <div className={cn(note.deleted && "line-through")}>
                <StaffNoteText text={note.text} />
            </div>
            <small
                className="block text-xs text-muted-foreground"
                title={tsToLocaleDateTimeString(note.ts, 'long', 'short')}
            >
                {note.author} · {formatNoteAge(serverTime - note.ts)}
                {note.editedTs && <span title={tsToLocaleDateTimeString(note.editedTs, 'long', 'short')}> · edited</span>}
                {note.deleted && <> · deleted by {note.deleted.author} {formatNoteAge(serverTime - note.deleted.ts)}</>}
            </small>
        </div>
        {!note.deleted && canEdit && <Button
            size="icon"
            variant="ghost"
            className="size-7 shrink-0 text-muted-foreground"
            title="Edit Note"
            disabled={isBusy}
            onClick={() => setEditDraft(note.text)}
        >
            <PencilIcon className="size-4" />
        </Button>}
        {!note.deleted && canDelete && <Button
            size="icon"
            variant="ghost"
            className="size-7 shrink-0 text-muted-foreground hover:text-destructive"
            title="Delete Note"
            disabled={isBusy}
            onClick={() => onDelete(note)}
        >
            <Trash2Icon className="size-4" />
        </Button>}
    </li>;
}


type ActionNotesTabProps = {
    action: DatabaseActionType;
    serverTime: number;
    refreshModalData: () => void;
}

export default function ActionNotesTab({ action, serverTime, refreshModalData }: ActionNotesTabProps) {
    const [draft, setDraft] = useState('');
    const [isBusy, setIsBusy] = useState(false);
    const [showDeleted, setShowDeleted] = useState(false);
    const { authData } = useAuth();
    const { hasPerm } = useAdminPerms();
    const openConfirmDialog = useOpenConfirmDialog();
    const actionNoteApi = useBackendApi<GenericApiOkResp, ApiActionNoteReqSchema>({
        method: 'POST',
        path: `/history/actionNote`,
    });

    //Deleted notes only reach admins with manage.admins
    const canManageAll = hasPerm('manage.admins');
    const adminName = authData ? authData.name : '';
    const allNotes = [...(action.notes ?? [])].reverse().sort((a, b) => b.ts - a.ts);
    const deletedCount = allNotes.filter((note) => note.deleted).length;
    const notes = showDeleted ? allNotes : allNotes.filter((note) => !note.deleted);

    const sendNoteOp = (data: ApiActionNoteReqSchema, loadingMsg: string, successMsg: string, onSuccess?: () => void) => {
        setIsBusy(true);
        actionNoteApi({
            data,
            toastLoadingMessage: loadingMsg,
            genericHandler: { successMsg },
            success: (resp) => {
                setIsBusy(false);
                if ('success' in resp) {
                    onSuccess?.();
                    refreshModalData();
                }
            },
            error: () => setIsBusy(false),
        });
    }

    const doAddNote = () => {
        const text = draft.trim();
        if (!text.length || isBusy) return;
        sendNoteOp({ op: 'add', actionId: action.id, text }, 'Adding note...', 'Note added.', () => setDraft(''));
    }

    const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (event.key === 'Enter' && !event.shiftKey && !window.txIsMobile) {
            event.preventDefault();
            doAddNote();
        }
    }

    const handleSaveEdit = (note: DatabaseNoteType, text: string) => {
        sendNoteOp({ op: 'edit', actionId: action.id, noteId: note.id, text }, 'Saving note...', 'Note saved.');
    }

    const handleDelete = (note: DatabaseNoteType) => {
        openConfirmDialog({
            title: 'Delete Note',
            message: `Delete the note ${note.author} added ${tsToLocaleDateTimeString(note.ts, 'medium', 'short')}?`,
            actionLabel: 'Delete',
            confirmBtnVariant: 'destructive',
            onConfirm: () => {
                sendNoteOp({ op: 'delete', actionId: action.id, noteId: note.id }, 'Deleting note...', 'Note deleted.');
            },
        });
    }

    return (
        <ModalTabInner className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
                <Label htmlFor="actionNoteDraft">Staff Notes</Label>
                {canManageAll && deletedCount > 0 && (
                    <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer">
                        <Switch checked={showDeleted} onCheckedChange={setShowDeleted} />
                        Show Deleted ({deletedCount})
                    </label>
                )}
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                <Textarea
                    id="actionNoteDraft"
                    className="w-full min-h-[3.25rem] resize-y"
                    rows={2}
                    maxLength={4096}
                    disabled={isBusy}
                    value={draft}
                    onChange={(e) => setDraft(e.currentTarget.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Add a note for staff. The player never sees it."
                />
                <Button
                    variant="outline"
                    size="sm"
                    className="shrink-0"
                    onClick={doAddNote}
                    disabled={isBusy || !draft.trim().length}
                >Add Note</Button>
            </div>
            {notes.length > 0 ? <ol className="flex flex-col gap-1">
                {notes.map((note) => {
                    const isOwn = isNoteAuthor(note, adminName);
                    return <NoteItem
                        key={note.id}
                        note={note}
                        serverTime={serverTime}
                        canEdit={isOwn}
                        canDelete={isOwn || canManageAll}
                        isBusy={isBusy}
                        onSaveEdit={handleSaveEdit}
                        onDelete={handleDelete}
                    />;
                })}
            </ol> : (
                <p className="text-sm text-muted-foreground italic">No notes yet.</p>
            )}
        </ModalTabInner>
    );
}
