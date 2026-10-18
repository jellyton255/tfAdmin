import DateTimeCorrected from "@/components/DateTimeCorrected";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAdminPerms, useAuth } from "@/hooks/auth";
import { useBackendApi } from "@/hooks/fetch";
import { PlayerModalRefType } from "@/hooks/playerModal";
import { cn } from "@/lib/utils";
import { msToDuration, tsToLocaleDateTimeString } from "@/lib/dateTime";
import StaffNoteText, { formatNoteAge } from "@/components/StaffNoteText";
import { GenericApiOkResp } from "@shared/genericApiTypes";
import { PlayerModalPlayerData, PlayerNoteItem } from "@shared/playerApiTypes";
import { CornerDownRightIcon, EyeIcon, ShieldAlertIcon, Trash2Icon, XIcon } from "lucide-react";
import {
    DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { isNoteAuthor } from "@shared/noteAuthor";
import { useMemo, useState } from "react";
import { useOpenConfirmDialog, useOpenPromptDialog } from "@/hooks/dialogs";
import { ModalTabInner } from "@/components/modal-tabs";


function LogActionCounter({ type, count }: { type: 'Ban' | 'Warn', count: number }) {
    const pluralLabel = (count > 1) ? `${type}s` : type;
    if (count === 0) {
        return <span className={cn(
            'h-max rounded-sm text-xs font-semibold px-1 py-[0.125rem] tracking-widest text-center inline-block',
            'bg-secondary text-secondary-foreground'
        )}>
            0 {type}s
        </span>
    } else {
        return <span className={cn(
            'h-max rounded-sm text-xs font-semibold px-1 py-[0.125rem] tracking-widest text-center inline-block',
            type === 'Ban' ? 'bg-destructive text-destructive-foreground' : 'bg-warning text-warning-foreground'
        )}>
            {count} {pluralLabel}
        </span>
    }
}

type PlayerNotesBoxProps = {
    playerRef: PlayerModalRefType;
    player: PlayerModalPlayerData;
    serverTime: number;
    refreshModalData: () => void;
}

function PlayerNotesBox({ playerRef, player, serverTime, refreshModalData }: PlayerNotesBoxProps) {
    const [draft, setDraft] = useState('');
    const [isSaving, setIsSaving] = useState(false);
    const openConfirmDialog = useOpenConfirmDialog();
    const saveNoteApi = useBackendApi<GenericApiOkResp>({
        method: 'POST',
        path: `/player/save_note`,
    });
    const deleteNoteApi = useBackendApi<GenericApiOkResp>({
        method: 'POST',
        path: `/player/delete_note`,
    });
    const moveNoteApi = useBackendApi<GenericApiOkResp>({
        method: 'POST',
        path: `/player/move_note`,
    });
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
    }

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
    }

    const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (event.key === 'Enter' && !event.shiftKey && !window.txIsMobile) {
            event.preventDefault();
            doSaveNote();
        }
    }

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
    }

    return <div className="flex flex-col gap-2">
        <Label htmlFor="playerNotes">
            Notes {notes.length > 0 && <span className="text-muted-foreground font-normal">({notes.length})</span>}
        </Label>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <Textarea
                id="playerNotes"
                className="w-full min-h-[3.25rem] resize-y"
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
        {notes.length > 0 && <ol className="flex flex-col gap-1">
            {notes.map((note) => (
                <li key={note.id} className="group flex gap-2 px-2 py-1 border-l-4 border-muted rounded-r-sm bg-muted/30">
                    <div className="min-w-0 grow">
                        <StaffNoteText text={note.text} />
                        <small
                            className="block text-xs text-muted-foreground"
                            title={tsToLocaleDateTimeString(note.ts, 'long', 'short')}
                        >
                            {note.author} · {formatNoteAge(serverTime - note.ts)}
                        </small>
                    </div>
                    {canMove(note) && <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button
                                size="icon"
                                variant="ghost"
                                className="size-7 shrink-0 text-muted-foreground"
                                title="Move to a Sanction"
                            >
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
                        variant="ghost"
                        className="size-7 shrink-0 text-muted-foreground hover:text-destructive"
                        title="Delete Note"
                        onClick={() => handleDelete(note)}
                    >
                        <Trash2Icon className="size-4" />
                    </Button>
                </li>
            ))}
        </ol>}
    </div>
}



type PlayerInfoTabProps = {
    playerRef: PlayerModalRefType;
    player: PlayerModalPlayerData;
    tagSuggestions: string[];
    serverTime: number;
    tsFetch: number;
    setSelectedTab: (t: string) => void;
    refreshModalData: () => void;
}

export default function PlayerInfoTab({ playerRef, player, tagSuggestions, serverTime, tsFetch, setSelectedTab, refreshModalData }: PlayerInfoTabProps) {
    const { hasPerm } = useAdminPerms();
    const openPromptDialog = useOpenPromptDialog();
    const playerWhitelistApi = useBackendApi<GenericApiOkResp>({
        method: 'POST',
        path: `/player/whitelist`,
    });
    const watchApi = useBackendApi<GenericApiOkResp>({
        method: 'POST',
        path: `/player/watch`,
    });
    const unwatchApi = useBackendApi<GenericApiOkResp>({
        method: 'POST',
        path: `/player/unwatch`,
    });
    const setTagsApi = useBackendApi<GenericApiOkResp>({
        method: 'POST',
        path: `/player/set_tags`,
    });
    const tags = player.tags ?? [];

    const sessionTimeText = !player.sessionTime ? '--' : msToDuration(
        player.sessionTime * 60_000,
        { units: ['h', 'm'] }
    );
    const lastConnectionText = !player.tsLastConnection ? '--' : <DateTimeCorrected
        className="opacity-75 cursor-help"
        serverTime={serverTime}
        tsObject={player.tsLastConnection}
        tsFetch={tsFetch}
        isDateOnly
    />;
    const playTimeText = !player.playTime ? '--' : msToDuration(
        player.playTime * 60_000,
        { units: ['d', 'h', 'm'] }
    )
    const joinDateText = !player.tsJoined ? '--' : <DateTimeCorrected
        className="opacity-75 cursor-help"
        serverTime={serverTime}
        tsObject={player.tsJoined}
        tsFetch={tsFetch}
        isDateOnly
    />;
    const whitelistedText = !player.tsWhitelisted ? 'not yet' : <DateTimeCorrected
        className="opacity-75 cursor-help"
        serverTime={serverTime}
        tsObject={player.tsWhitelisted}
        tsFetch={tsFetch}
        isDateOnly
    />;
    const banCount = player.actionHistory.filter((a) => a.type === 'ban' && !a.revokedAt).length;
    const warnCount = player.actionHistory.filter((a) => a.type === 'warn' && !a.revokedAt).length;

    const handleWhitelistClick = () => {
        playerWhitelistApi({
            queryParams: playerRef,
            data: {
                status: !player.tsWhitelisted
            },
            toastLoadingMessage: 'Updating whitelist...',
            genericHandler: {
                successMsg: 'Whitelist changed.',
            },
            success: (data, toastId) => {
                if ('success' in data) {
                    refreshModalData();
                }
            },
        });
    }

    const handleWatchClick = () => {
        if (player.watch) {
            unwatchApi({
                queryParams: playerRef,
                toastLoadingMessage: 'Removing from the watchlist...',
                genericHandler: { successMsg: 'Removed from the watchlist.' },
                success: (data) => {
                    if ('success' in data) refreshModalData();
                },
            });
            return;
        }
        openPromptDialog({
            title: 'Watch Player',
            placeholder: 'Reason',
            required: true,
            submitLabel: 'Watch',
            onSubmit: (reason) => {
                watchApi({
                    queryParams: playerRef,
                    data: { reason },
                    toastLoadingMessage: 'Adding to the watchlist...',
                    genericHandler: { successMsg: 'Added to the watchlist.' },
                    success: (data) => {
                        if ('success' in data) refreshModalData();
                    },
                });
            },
        });
    }

    const saveTags = (newTags: string[]) => {
        setTagsApi({
            queryParams: playerRef,
            data: { tags: newTags },
            toastLoadingMessage: 'Saving tags...',
            genericHandler: { successMsg: 'Tags saved.' },
            success: (data) => {
                if ('success' in data) refreshModalData();
            },
        });
    }

    const handleAddTagClick = () => {
        const taken = new Set(tags.map((tag) => tag.toLowerCase()));
        openPromptDialog({
            title: 'Add Tag',
            placeholder: 'Tag',
            required: true,
            suggestions: tagSuggestions.filter((tag) => !taken.has(tag.toLowerCase())).slice(0, 8),
            submitLabel: 'Add',
            onSubmit: (tag) => saveTags([...tags, tag]),
        });
    }

    const playerBannedText: string | undefined = useMemo(() => {
        if (!player || !serverTime) return;
        let banExpiration;
        for (const action of player.actionHistory) {
            if (action.type !== 'ban' || action.revokedAt) continue;
            if (action.exp) {
                if (action.exp >= serverTime) {
                    banExpiration = Math.max(banExpiration ?? 0, action.exp);
                }
            } else {
                return 'This player is permanently banned.';
            }
        }

        if (banExpiration !== undefined) {
            const str = tsToLocaleDateTimeString(banExpiration, 'short', 'short');
            return `This player is banned until ${str}`;
        }
    }, [player, serverTime]);

    return (
        <ModalTabInner>
            {playerBannedText ? (
                <div className="w-full p-2 pr-3 mb-1 flex items-center justify-between space-x-4 rounded-lg border shadow-lg transition-all text-black/75 dark:text-white/90 border-warning/70 bg-warning-hint">
                    <div className="flex-shrink-0 flex flex-col gap-2 items-center">
                        <ShieldAlertIcon className="size-5 text-warning" />
                    </div>
                    <div className="flex-grow text-sm font-medium">
                        {playerBannedText}
                    </div>
                </div>
            ) : null}
            {player.watch ? (
                <div className="w-full p-2 pr-3 mb-1 flex items-center justify-between space-x-4 rounded-lg border shadow-lg transition-all text-black/75 dark:text-white/90 border-destructive/70 bg-destructive-hint">
                    <div className="flex-shrink-0 flex flex-col gap-2 items-center">
                        <EyeIcon className="size-5 text-destructive" />
                    </div>
                    <div className="flex-grow min-w-0">
                        <StaffNoteText text={player.watch.reason} />
                        <small
                            className="block text-xs text-muted-foreground"
                            title={tsToLocaleDateTimeString(player.watch.ts, 'long', 'short')}
                        >
                            Watched by {player.watch.author} · {formatNoteAge(serverTime - player.watch.ts)}
                        </small>
                    </div>
                </div>
            ) : null}
            <dl className="pb-2">
                {player.isConnected && <div className="py-0.5 grid grid-cols-3 gap-4 px-0">
                    <dt className="text-sm font-medium leading-6 text-muted-foreground">Session Time</dt>
                    <dd className="text-sm leading-6 col-span-2 mt-0">{sessionTimeText}</dd>
                </div>}
                <div className="py-0.5 grid grid-cols-3 gap-4 px-0">
                    <dt className="text-sm font-medium leading-6 text-muted-foreground">Play Time</dt>
                    <dd className="text-sm leading-6 col-span-2 mt-0">{playTimeText}</dd>
                </div>
                <div className="py-0.5 grid grid-cols-3 gap-4 px-0">
                    <dt className="text-sm font-medium leading-6 text-muted-foreground">Join Date</dt>
                    <dd className="text-sm leading-6 col-span-2 mt-0">{joinDateText}</dd>
                </div>
                {!player.isConnected && <div className="py-0.5 grid grid-cols-3 gap-4 px-0">
                    <dt className="text-sm font-medium leading-6 text-muted-foreground">Last Connection</dt>
                    <dd className="text-sm leading-6 col-span-2 mt-0">{lastConnectionText}</dd>
                </div>}

                <div className="py-0.5 grid grid-cols-3 gap-4 px-0">
                    <dt className="text-sm font-medium leading-6 text-muted-foreground">ID Allowlisted</dt>
                    <dd className="text-sm leading-6 mt-0">{whitelistedText}</dd>
                    <dd className="text-right">
                        <Button
                            variant="outline"
                            size='inline'
                            style={{ minWidth: '8.25ch' }}
                            onClick={handleWhitelistClick}
                            disabled={!hasPerm('players.whitelist')}
                        >
                            {player.tsWhitelisted ? 'Remove' : 'Allow'}
                        </Button>
                    </dd>
                </div>
                <div className="py-0.5 grid grid-cols-3 gap-4 px-0">
                    <dt className="text-sm font-medium leading-6 text-muted-foreground">Watchlist</dt>
                    <dd className="text-sm leading-6 mt-0">{player.watch ? 'Watched' : 'Not watched'}</dd>
                    <dd className="text-right">
                        <Button
                            variant="outline"
                            size='inline'
                            style={{ minWidth: '8.25ch' }}
                            onClick={handleWatchClick}
                            disabled={!player.isRegistered}
                        >
                            {player.watch ? 'Remove' : 'Watch'}
                        </Button>
                    </dd>
                </div>
                <div className="py-0.5 grid grid-cols-3 gap-4 px-0">
                    <dt className="text-sm font-medium leading-6 text-muted-foreground">Tags</dt>
                    <dd className="text-sm leading-6 mt-0 flex flex-wrap gap-1">
                        {tags.length ? tags.map((tag) => (
                            <span
                                key={tag}
                                className="h-max inline-flex items-center gap-0.5 rounded-sm bg-secondary text-secondary-foreground text-xs font-semibold pl-1.5 pr-0.5 py-[0.125rem]"
                            >
                                {tag}
                                <button
                                    className="rounded-sm opacity-60 hover:opacity-100"
                                    title={`Remove ${tag}`}
                                    onClick={() => saveTags(tags.filter((x) => x !== tag))}
                                >
                                    <XIcon className="size-3" />
                                </button>
                            </span>
                        )) : '--'}
                    </dd>
                    <dd className="text-right">
                        <Button
                            variant="outline"
                            size='inline'
                            style={{ minWidth: '8.25ch' }}
                            onClick={handleAddTagClick}
                            disabled={!player.isRegistered}
                        >Add</Button>
                    </dd>
                </div>
                <div className="py-0.5 grid grid-cols-3 gap-4 px-0">
                    <dt className="text-sm font-medium leading-6 text-muted-foreground">Sanctions</dt>
                    <dd className="text-sm leading-6 mt-0 flex flex-wrap gap-2">
                        <LogActionCounter type="Ban" count={banCount} />
                        <LogActionCounter type="Warn" count={warnCount} />
                    </dd>
                    <dd className="text-right">
                        <Button
                            variant="outline"
                            size='inline'
                            style={{ minWidth: '8.25ch' }}
                            onClick={() => { setSelectedTab('History') }}
                        >View</Button>
                    </dd>
                </div>
            </dl>

            <PlayerNotesBox player={player} playerRef={playerRef} serverTime={serverTime} refreshModalData={refreshModalData} />
        </ModalTabInner>
    );
}
