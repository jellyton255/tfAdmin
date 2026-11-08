import { useState, type ReactNode } from "react";
import type { IconType } from "react-icons";
import {
    PiBowlFood, PiCamera, PiChatCircleText, PiCpu, PiCrown, PiDiscordLogo, PiEye, PiEyeSlash,
    PiFirstAidKit, PiFlowerLotus, PiGavel, PiGift, PiHeartbeat, PiKey, PiNotePencil, PiShieldCheck, PiSignOut,
    PiSnowflake, PiSparkle, PiSun, PiTag, PiUserSwitch, PiWarning, PiX,
} from "react-icons/pi";
import { useLocation, useRoute } from "wouter";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { txToast } from "@/components/TxToaster";
import { STAFF_NOTE_LABEL } from "@/components/StaffNoteText";
import { useAdminPerms } from "@/hooks/auth";
import { useBackendApi } from "@/hooks/fetch";
import { useOpenPromptDialog } from "@/hooks/dialogs";
import { useClosePlayerModal, type PlayerModalRefType } from "@/hooks/playerModal";
import { useContentRefresh } from "@/hooks/pages";
import { useCloseAllSheets } from "@/hooks/sheets";
import { useEverfallPermissions, useEverfallRequest } from "@/hooks/everfall";
import { tsToLocaleDateTimeString } from "@/lib/dateTime";
import type { GenericApiOkResp } from "@shared/genericApiTypes";
import type { EverfallPlayerScreenshot } from "@shared/everfallApiTypes";
import type { PlayerModalPlayerData } from "@shared/playerApiTypes";
import { compactDuration, dateFormatter, Pill, type Tone } from "./parts";


export type PlayerSection = 'overview' | 'history' | 'notes' | 'linked' | 'ids' | 'ban';

const itemPattern = /^(\S+)(?:\s+(\d+))?$/;

type KeyDef = {
    label: string;
    icon: IconType;
    onClick: () => void;
    disabled?: boolean;
    /** Why the key is disabled, shown in its tooltip */
    reason?: string;
    active?: boolean;
};

const groupTone: Record<Tone, string> = {
    danger: 'border-destructive/30 bg-destructive/5 text-destructive-inline',
    success: 'border-success/30 bg-success/5 text-success-inline',
    info: 'border-info/30 bg-info/5 text-info-inline',
    warning: 'border-warning/30 bg-warning/5 text-warning-inline',
    neutral: 'border-border bg-muted/30 text-muted-foreground',
};

/** A row of icon keys sharing one color, like ef_administration's grouped action keys. */
function KeyGroup({ tone, keys }: { tone: Tone; keys: (KeyDef | false)[] }) {
    const shown = keys.filter((key): key is KeyDef => !!key);
    if (!shown.length) return null;
    return (
        <div className={cn('flex shrink-0 overflow-hidden rounded-md border', groupTone[tone])}>
            {shown.map(({ label, icon: Icon, onClick, disabled, reason, active }) => (
                <Tooltip key={label}>
                    <TooltipTrigger asChild>
                        {/* The span keeps the tooltip working on a disabled key */}
                        <span className="border-l border-inherit first:border-l-0">
                            <button
                                type="button"
                                aria-label={label}
                                disabled={disabled}
                                onClick={onClick}
                                className={cn(
                                    'flex size-9 items-center justify-center outline-none transition-colors hover:bg-foreground/10 focus-visible:bg-foreground/10 disabled:pointer-events-none disabled:opacity-35',
                                    active && 'bg-foreground/10',
                                )}
                            >
                                <Icon className="size-[1.125rem]" />
                            </button>
                        </span>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">
                        {label}{disabled && reason ? <span className="text-muted-foreground"> · {reason}</span> : null}
                    </TooltipContent>
                </Tooltip>
            ))}
        </div>
    );
}

function bannedText(player: PlayerModalPlayerData, serverTime: number) {
    let banExpiration: number | undefined;
    for (const action of player.actionHistory) {
        if (action.type !== 'ban' || action.revokedAt || action.historical) continue;
        if (!action.exp) return 'Permanently Banned';
        if (action.exp >= serverTime) banExpiration = Math.max(banExpiration ?? 0, action.exp);
    }
    return banExpiration === undefined ? undefined : `Banned Until ${dateFormatter.format(banExpiration * 1000)}`;
}

function IdChip({ icon: Icon, title, children }: { icon: IconType; title: string; children: ReactNode }) {
    return (
        <span className="inline-flex min-w-0 items-center gap-1" title={title}>
            <Icon className="size-3.5 shrink-0" />
            <span className="truncate">{children}</span>
        </span>
    );
}


type PlayerHeaderProps = {
    playerRef: PlayerModalRefType;
    player: PlayerModalPlayerData;
    serverTime: number;
    tagSuggestions: string[];
    onOpenSection: (section: PlayerSection) => void;
    refreshModalData: () => void;
};

export default function PlayerHeader({ playerRef, player, serverTime, tagSuggestions, onOpenSection, refreshModalData }: PlayerHeaderProps) {
    const { hasPerm } = useAdminPerms();
    const { can } = useEverfallPermissions();
    const everfallRequest = useEverfallRequest();
    const openPromptDialog = useOpenPromptDialog();
    const closeModal = useClosePlayerModal();
    const closeAllSheets = useCloseAllSheets();
    const setLocation = useLocation()[1];
    const [isAlreadyInAdminPage] = useRoute('/admins');
    const refreshContent = useContentRefresh();
    const [screenshotUrl, setScreenshotUrl] = useState<string | null>(null);

    const playerMessageApi = useBackendApi<GenericApiOkResp>({ method: 'POST', path: `/player/message` });
    const playerKickApi = useBackendApi<GenericApiOkResp>({ method: 'POST', path: `/player/kick` });
    const playerWarnApi = useBackendApi<GenericApiOkResp>({ method: 'POST', path: `/player/warn` });
    const playerWhitelistApi = useBackendApi<GenericApiOkResp>({ method: 'POST', path: `/player/whitelist` });
    const watchApi = useBackendApi<GenericApiOkResp>({ method: 'POST', path: `/player/watch` });
    const unwatchApi = useBackendApi<GenericApiOkResp>({ method: 'POST', path: `/player/unwatch` });
    const setTagsApi = useBackendApi<GenericApiOkResp>({ method: 'POST', path: `/player/set_tags` });

    const tags = player.tags ?? [];
    const isLive = player.isConnected && player.netid !== undefined && !!player.license;
    const offlineReason = 'Player is offline';
    const banned = bannedText(player, serverTime);
    const allIds = [...new Set([...player.idsOnline, ...player.idsOffline])];
    const hwidCount = new Set([...player.hwidsOnline, ...player.hwidsOffline]).size;
    const discordId = allIds.find((id) => id.startsWith('discord:'));
    const fivemId = allIds.find((id) => id.startsWith('fivem:'));

    const closeOnSuccess = (data: GenericApiOkResp) => {
        if ('success' in data) {
            closeModal();
            closeAllSheets();
        }
    };
    const refreshOnSuccess = (data: GenericApiOkResp) => {
        if ('success' in data) refreshModalData();
    };

    function handleDm() {
        openPromptDialog({
            title: `Direct Message ${player.displayName}`,
            message: 'Type direct message below',
            placeholder: 'whatever you wanna say',
            submitLabel: 'Send',
            required: true,
            onSubmit: (input) => playerMessageApi({
                queryParams: playerRef,
                data: { message: input },
                genericHandler: { successMsg: 'Direct message sent.' },
                toastLoadingMessage: 'Sending direct message...',
                success: closeOnSuccess,
            }),
        });
    }

    function handleWarn() {
        openPromptDialog({
            title: `Warn ${player.displayName}`,
            message: 'Offline players get the warning when they come back.',
            placeholder: 'The reason for the warn, rule violated, etc.',
            submitLabel: 'Send',
            required: true,
            noteLabel: STAFF_NOTE_LABEL,
            onSubmit: (input, note) => playerWarnApi({
                queryParams: playerRef,
                data: { reason: input, note: note || undefined },
                genericHandler: { successMsg: 'Warning sent.' },
                toastLoadingMessage: 'Sending warning...',
                success: closeOnSuccess,
            }),
        });
    }

    function handleKick() {
        openPromptDialog({
            title: `Kick ${player.displayName}`,
            message: 'Type the kick reason or leave it blank (press enter)',
            placeholder: 'any reason you want',
            submitLabel: 'Send',
            noteLabel: STAFF_NOTE_LABEL,
            onSubmit: (input, note) => playerKickApi({
                queryParams: playerRef,
                data: { reason: input, note: note || undefined },
                genericHandler: { successMsg: 'Player kicked.' },
                toastLoadingMessage: 'Kicking player...',
                success: closeOnSuccess,
            }),
        });
    }

    function handleWatch() {
        if (player.watch) {
            unwatchApi({
                queryParams: playerRef,
                toastLoadingMessage: 'Removing from the watchlist...',
                genericHandler: { successMsg: 'Removed from the watchlist.' },
                success: refreshOnSuccess,
            });
            return;
        }
        openPromptDialog({
            title: 'Watch Player',
            placeholder: 'Reason',
            required: true,
            submitLabel: 'Watch',
            onSubmit: (reason) => watchApi({
                queryParams: playerRef,
                data: { reason },
                toastLoadingMessage: 'Adding to the watchlist...',
                genericHandler: { successMsg: 'Added to the watchlist.' },
                success: refreshOnSuccess,
            }),
        });
    }

    function saveTags(newTags: string[]) {
        setTagsApi({
            queryParams: playerRef,
            data: { tags: newTags },
            toastLoadingMessage: 'Saving tags...',
            genericHandler: { successMsg: 'Tags saved.' },
            success: refreshOnSuccess,
        });
    }

    function handleAddTag() {
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

    function handleWhitelist() {
        playerWhitelistApi({
            queryParams: playerRef,
            data: { status: !player.tsWhitelisted },
            toastLoadingMessage: 'Updating whitelist...',
            genericHandler: { successMsg: 'Whitelist changed.' },
            success: refreshOnSuccess,
        });
    }

    function handleGiveAdmin() {
        const params = new URLSearchParams();
        params.set("autofill", "true");
        params.set("name", player.pureName);
        for (const id of player.idsOnline) {
            if (id.startsWith("discord:")) {
                params.set("discord", id);
            } else if (id.startsWith("fivem:")) {
                params.set("citizenfx", id);
            }
        }
        setLocation(`/admins?${params.toString()}`);
        if (isAlreadyInAdminPage) refreshContent();
        closeModal();
        closeAllSheets();
    }

    // ef_administration's live actions, offered by the admin's Everfall staff rank
    async function runLive<Data>(operation: string, payload: Record<string, unknown>, loading: string, done: string) {
        if (player.netid === undefined || !player.license) return;
        const toastId = txToast.loading(loading);
        try {
            const data = await everfallRequest<Data>(operation, { serverId: player.netid, license: player.license, ...payload });
            txToast.success(done, { id: toastId });
            return data;
        } catch (error) {
            txToast.error(error instanceof Error ? error.message : String(error), { id: toastId });
        }
    }

    function liveKey(label: string, icon: IconType, permission: string, onClick: () => void): KeyDef | false {
        return can(permission) && { label, icon, onClick, disabled: !isLive, reason: offlineReason };
    }

    function handleGiveItem() {
        openPromptDialog({
            title: `Give Item to ${player.displayName}`,
            message: 'Type the item name, then the quantity if more than one.',
            placeholder: 'water 5',
            submitLabel: 'Give',
            required: true,
            onSubmit: (input) => {
                const match = itemPattern.exec(input.trim());
                if (!match) {
                    txToast.warning('Type the item name, then an optional quantity.');
                    return;
                }
                const amount = match[2] ? Number(match[2]) : 1;
                runLive('player.giveItem', { item: match[1], amount }, 'Giving item...', `Gave ${amount}x ${match[1]}.`);
            },
        });
    }

    function handleSetModel() {
        openPromptDialog({
            title: `Set Model for ${player.displayName}`,
            placeholder: 'mp_m_freemode_01',
            submitLabel: 'Set Model',
            required: true,
            onSubmit: (input) => runLive('player.setModel', { model: input.trim() }, 'Setting model...', 'Model set.'),
        });
    }

    async function handleScreenshot() {
        const data = await runLive<EverfallPlayerScreenshot>('player.screenshot', {}, 'Taking screenshot...', 'Screenshot taken.');
        if (data) setScreenshotUrl(data.url);
    }

    const sessionText = player.sessionTime ? compactDuration(player.sessionTime) : undefined;

    return (<>
        <header className="flex flex-col gap-3 border-b px-4 py-3 lg:flex-row lg:items-center lg:gap-4 lg:px-5">
            <div className="flex min-w-0 grow items-center gap-3 pr-8 lg:pr-0">
                <div className={cn(
                    'flex size-14 shrink-0 flex-col items-center justify-center rounded-lg border',
                    player.netid !== undefined ? 'bg-muted/40' : 'bg-muted/20 text-muted-foreground',
                )}>
                    <span className="text-[0.625rem] font-semibold uppercase tracking-wider text-muted-foreground">
                        {player.netid !== undefined ? 'ID' : 'Off'}
                    </span>
                    <span className="font-mono text-xl font-bold leading-6 tabular-nums">{player.netid ?? '—'}</span>
                </div>
                <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                        <h2 className="mr-1 truncate text-xl font-bold tracking-tight">{player.displayName}</h2>
                        {player.isConnected ? (
                            <Pill tone="success">
                                <span className="size-1.5 rounded-full bg-current" />
                                Online{sessionText && ` · ${sessionText}`}
                            </Pill>
                        ) : (
                            <Pill>Offline</Pill>
                        )}
                        {player.watch && (
                            <Pill
                                tone="warning"
                                title={`${player.watch.reason} (${player.watch.author}, ${tsToLocaleDateTimeString(player.watch.ts, 'medium', 'short')})`}
                            >
                                <PiEye className="size-3.5" /> Watching
                            </Pill>
                        )}
                        {banned && <Pill tone="danger"><PiGavel className="size-3.5" /> {banned}</Pill>}
                        {tags.map((tag) => (
                            <Pill key={tag} tone="info" className="pr-0.5">
                                {tag}
                                <button
                                    type="button"
                                    className="rounded-sm opacity-60 hover:opacity-100"
                                    aria-label={`Remove ${tag}`}
                                    onClick={() => saveTags(tags.filter((x) => x !== tag))}
                                >
                                    <PiX className="size-3" />
                                </button>
                            </Pill>
                        ))}
                    </div>
                    <button
                        type="button"
                        onClick={() => onOpenSection('ids')}
                        className="mt-1 flex max-w-full flex-wrap items-center gap-x-3 gap-y-0.5 font-mono text-xs text-muted-foreground hover:text-foreground"
                    >
                        {discordId && <IdChip icon={PiDiscordLogo} title={discordId}>{discordId.slice(8)}</IdChip>}
                        {fivemId && <IdChip icon={PiUserSwitch} title={fivemId}>{fivemId.slice(6)}</IdChip>}
                        {player.license && <IdChip icon={PiKey} title={player.license}>{player.license.slice(0, 10)}…{player.license.slice(-4)}</IdChip>}
                        {hwidCount > 0 && <IdChip icon={PiCpu} title="Hardware IDs">{hwidCount} HWIDs</IdChip>}
                    </button>
                </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 lg:mr-10 lg:shrink-0 xl:flex-nowrap">
                <KeyGroup tone="danger" keys={[
                    hasPerm('players.direct_message') && { label: 'Direct Message', icon: PiChatCircleText, onClick: handleDm, disabled: !player.isConnected, reason: offlineReason },
                    hasPerm('players.warn') && { label: 'Warn', icon: PiWarning, onClick: handleWarn },
                    hasPerm('players.kick') && { label: 'Kick', icon: PiSignOut, onClick: handleKick, disabled: !player.isConnected, reason: offlineReason },
                    hasPerm('players.ban') && { label: 'Ban', icon: PiGavel, onClick: () => onOpenSection('ban') },
                ]} />
                <KeyGroup tone="success" keys={[
                    liveKey('Revive', PiHeartbeat, 'PlayerState', () => runLive('player.revive', {}, 'Reviving...', 'Player revived.')),
                    liveKey('Heal', PiFirstAidKit, 'PlayerState', () => runLive('player.heal', {}, 'Healing...', 'Player healed.')),
                    liveKey('Feed', PiBowlFood, 'PlayerState', () => runLive('player.feed', {}, 'Feeding...', 'Hunger and thirst restored.')),
                    liveKey('Relieve Stress', PiFlowerLotus, 'PlayerState', () => runLive('player.relieveStress', {}, 'Relieving stress...', 'Stress relieved.')),
                    liveKey('Clear Effects', PiSparkle, 'PlayerState', () => runLive('player.clearEffects', {}, 'Clearing effects...', 'Effects cleared.')),
                ]} />
                <KeyGroup tone="info" keys={[
                    liveKey('Freeze', PiSnowflake, 'Teleport', () => runLive('player.freeze', { frozen: true }, 'Freezing...', 'Player frozen.')),
                    liveKey('Unfreeze', PiSun, 'Teleport', () => runLive('player.freeze', { frozen: false }, 'Unfreezing...', 'Player unfrozen.')),
                    liveKey('Set Model', PiUserSwitch, 'PlayerState', handleSetModel),
                ]} />
                <KeyGroup tone="warning" keys={[
                    liveKey('Give Item', PiGift, 'SpawnItemsVehicles', handleGiveItem),
                ]} />
                <KeyGroup tone="neutral" keys={[
                    liveKey('Take Screenshot', PiCamera, 'Punishments', handleScreenshot),
                    { label: 'Notes', icon: PiNotePencil, onClick: () => onOpenSection('notes') },
                    {
                        label: player.watch ? 'Stop Watching' : 'Watch',
                        icon: player.watch ? PiEyeSlash : PiEye,
                        onClick: handleWatch,
                        disabled: !player.isRegistered,
                        reason: 'Player is not registered',
                        active: !!player.watch,
                    },
                    { label: 'Add Tag', icon: PiTag, onClick: handleAddTag, disabled: !player.isRegistered, reason: 'Player is not registered' },
                    hasPerm('players.whitelist') && {
                        label: player.tsWhitelisted ? 'Remove from Whitelist' : 'Whitelist',
                        icon: PiShieldCheck,
                        onClick: handleWhitelist,
                        active: !!player.tsWhitelisted,
                    },
                    hasPerm('manage.admins') && {
                        label: 'Give Admin',
                        icon: PiCrown,
                        onClick: handleGiveAdmin,
                        disabled: !player.idsOnline.length,
                        reason: offlineReason,
                    },
                ]} />
            </div>
        </header>

        <Dialog open={screenshotUrl !== null} onOpenChange={(open) => !open && setScreenshotUrl(null)}>
            <DialogContent className="max-w-5xl">
                <DialogHeader>
                    <DialogTitle>Screenshot of {player.displayName}</DialogTitle>
                </DialogHeader>
                {screenshotUrl && (
                    <a href={screenshotUrl} target="_blank" rel="noopener noreferrer">
                        <img src={screenshotUrl} alt={`Screenshot of ${player.displayName}`} className="w-full rounded-md border" />
                    </a>
                )}
            </DialogContent>
        </Dialog>
    </>);
}
