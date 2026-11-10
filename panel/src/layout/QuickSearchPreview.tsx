import type { ReactNode } from "react";
import useSWR from "swr";
import type { IconType } from "react-icons";
import {
    PiArrowElbowDownLeft, PiChatCircleText, PiFirstAidKit, PiHeartbeat, PiSnowflake, PiSun,
} from "react-icons/pi";
import GenericSpinner from "@/components/GenericSpinner";
import { txToast } from "@/components/TxToaster";
import { useAdminPerms } from "@/hooks/auth";
import { useAuthedFetcher, useBackendApi } from "@/hooks/fetch";
import { useOpenPromptDialog } from "@/hooks/dialogs";
import { useEverfallPermissions, useEverfallRequest } from "@/hooks/everfall";
import { cn } from "@/lib/utils";
import type { GenericApiOkResp } from "@shared/genericApiTypes";
import type { PlayerModalResp } from "@shared/playerApiTypes";
import {
    compactDuration, dateFormatter, errorText, formatMoney, JobBadge, Pill, usePlayerCharacters,
} from "./PlayerModal/parts";


function PreviewStat({ label, value, className }: { label: string; value: ReactNode; className?: string }) {
    return (
        <div className="min-w-0 px-3 py-2">
            <div className="text-xs text-muted-foreground">{label}</div>
            <div className={cn('truncate text-sm font-semibold tabular-nums', className)}>{value}</div>
        </div>
    );
}

function PreviewKey({ icon: Icon, label, hint, disabled, onClick, className }: {
    className?: string;
    icon: IconType;
    label: string;
    hint?: ReactNode;
    disabled?: boolean;
    onClick: () => void;
}) {
    return (
        <button
            type="button"
            disabled={disabled}
            onClick={onClick}
            className={cn("flex h-8 items-center gap-2 rounded-md border bg-card px-2.5 text-left text-xs font-semibold outline-none transition-colors hover:bg-muted focus-visible:bg-muted disabled:pointer-events-none disabled:opacity-40", className)}
        >
            <Icon className="size-4 shrink-0 text-muted-foreground" />
            <span className="grow truncate">{label}</span>
            {hint}
        </button>
    );
}

/** The highlighted player: who they are, their main character, their record, and quick actions. */
function PlayerPreview({ license, onOpen }: { license: string; onOpen: () => void }) {
    const authedFetcher = useAuthedFetcher();
    const playerRef = { license };
    const player = useSWR(
        `/player?${new URLSearchParams({ license })}`,
        (url: string) => authedFetcher<PlayerModalResp>(url),
        { revalidateOnFocus: false, keepPreviousData: false },
    );
    const characters = usePlayerCharacters(playerRef);
    const { hasPerm } = useAdminPerms();
    const { can } = useEverfallPermissions();
    const everfallRequest = useEverfallRequest();
    const openPromptDialog = useOpenPromptDialog();
    const messageApi = useBackendApi<GenericApiOkResp>({ method: 'POST', path: `/player/message` });

    if (player.error) return <p className="p-4 text-sm text-destructive-inline">{errorText(player.error)}</p>;
    if (!player.data) return <div className="py-10"><GenericSpinner msg="Loading..." /></div>;
    if ('error' in player.data) return <p className="p-4 text-sm text-destructive-inline">{player.data.error}</p>;

    const { player: data, serverTime } = player.data;
    const characterList = characters.data && 'characters' in characters.data ? characters.data.characters : [];
    const character = characterList.find((entry) => entry.online) ?? characterList[0];
    const isLive = data.isConnected && data.netid !== undefined;
    const active = data.actionHistory.filter((action) => !action.revokedAt && !action.historical);
    const warns = active.filter((action) => action.type === 'warn').length;
    const banned = active.some((action) => action.type === 'ban' && (!action.exp || action.exp >= serverTime));

    async function runLive(operation: string, payload: Record<string, unknown>, loading: string, done: string) {
        if (data.netid === undefined || !data.license) return;
        const toastId = txToast.loading(loading);
        try {
            await everfallRequest(operation, { serverId: data.netid, license: data.license, ...payload });
            txToast.success(done, { id: toastId });
        } catch (error) {
            txToast.error(errorText(error), { id: toastId });
        }
    }

    function handleMessage() {
        openPromptDialog({
            title: `Direct Message ${data.displayName}`,
            placeholder: 'Message',
            submitLabel: 'Send',
            required: true,
            onSubmit: (message) => messageApi({
                queryParams: playerRef,
                data: { message },
                genericHandler: { successMsg: 'Direct message sent.' },
                toastLoadingMessage: 'Sending direct message...',
            }),
        });
    }

    return (
        <div className="flex flex-col gap-3 p-4">
            <div className="flex items-center gap-3">
                <div className="flex size-12 shrink-0 flex-col items-center justify-center rounded-lg border bg-background shadow-[inset_0_1px_2px_rgb(0_0_0/0.4)]">
                    <span className="text-[0.625rem] font-semibold uppercase tracking-wider text-muted-foreground">{isLive ? 'ID' : 'Off'}</span>
                    <span className="font-mono text-lg font-bold leading-5 tabular-nums">{data.netid ?? '—'}</span>
                </div>
                <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                        <span className="truncate text-base font-bold">{data.displayName}</span>
                        {data.isConnected && <span className="size-2 shrink-0 rounded-full bg-success" title="Online" />}
                    </div>
                    <div className="truncate font-mono text-xs text-muted-foreground">
                        {character ? character.citizenId : license.slice(0, 12)}
                    </div>
                </div>
            </div>

            {character && (
                <div className="flex min-h-5 flex-wrap items-center gap-1.5">
                    {character.jobLabel ? <JobBadge character={character} /> : <span className="text-xs text-muted-foreground">No Job</span>}
                    <span className="truncate text-xs text-muted-foreground">{character.fullName}</span>
                </div>
            )}

            <div className="grid grid-cols-2 overflow-hidden rounded-lg border bg-background [&>*:nth-child(even)]:border-l [&>*:nth-child(n+3)]:border-t">
                <PreviewStat label="Cash" value={character ? formatMoney(character.cash) : '—'} className={cn(character && 'text-success-inline')} />
                <PreviewStat label="Bank" value={character ? formatMoney(character.bank) : '—'} className={cn(character && 'text-success-inline')} />
                <PreviewStat
                    label={data.isConnected ? 'Session' : 'Last Seen'}
                    value={data.isConnected
                        ? (data.sessionTime ? compactDuration(data.sessionTime) : '—')
                        : (data.tsLastConnection ? dateFormatter.format(data.tsLastConnection * 1000) : '—')}
                />
                <PreviewStat label="Playtime" value={data.playTime ? compactDuration(data.playTime) : '—'} />
            </div>

            {(warns > 0 || banned || data.watch || (data.tags?.length ?? 0) > 0) && (
                <div className="flex flex-wrap gap-1.5">
                    {banned && <Pill tone="danger">Banned</Pill>}
                    {warns > 0 && <Pill tone="warning">{warns} {warns === 1 ? 'Warn' : 'Warns'}</Pill>}
                    {data.watch && <Pill tone="warning" title={data.watch.reason}>Watched</Pill>}
                    {data.tags?.map((tag) => <Pill key={tag} tone="info">{tag}</Pill>)}
                </div>
            )}

            <div className="grid grid-cols-2 gap-1.5">
                <PreviewKey
                    className="col-span-2"
                    icon={PiArrowElbowDownLeft}
                    label="Open Player"
                    hint={<kbd className="rounded border bg-muted px-1 font-sans text-[0.625rem] text-muted-foreground">Enter</kbd>}
                    onClick={onOpen}
                />
                {hasPerm('players.direct_message') && (
                    <PreviewKey icon={PiChatCircleText} label="Message" disabled={!data.isConnected} onClick={handleMessage} />
                )}
                {can('PlayerState') && <>
                    <PreviewKey icon={PiHeartbeat} label="Revive" disabled={!isLive} onClick={() => runLive('player.revive', {}, 'Reviving...', 'Player revived.')} />
                    <PreviewKey icon={PiFirstAidKit} label="Heal" disabled={!isLive} onClick={() => runLive('player.heal', {}, 'Healing...', 'Player healed.')} />
                </>}
                {can('Teleport') && <>
                    <PreviewKey icon={PiSnowflake} label="Freeze" disabled={!isLive} onClick={() => runLive('player.freeze', { frozen: true }, 'Freezing...', 'Player frozen.')} />
                    <PreviewKey icon={PiSun} label="Unfreeze" disabled={!isLive} onClick={() => runLive('player.freeze', { frozen: false }, 'Unfreezing...', 'Player unfrozen.')} />
                </>}
            </div>
        </div>
    );
}

export type PreviewTarget =
    | { kind: 'player'; license: string }
    | { kind: 'other'; icon: ReactNode; title: string; detail: string | null };

/** The right side of the palette: a player preview, or what the highlighted row opens. */
export default function QuickSearchPreview({ target, onOpen }: { target: PreviewTarget | null; onOpen: () => void }) {
    if (!target) return null;
    if (target.kind === 'player') return <PlayerPreview key={target.license} license={target.license} onOpen={onOpen} />;
    return (
        <div className="flex flex-col gap-3 p-4">
            <div className="flex items-center gap-3">
                <span className="flex size-12 shrink-0 items-center justify-center rounded-lg border bg-background text-muted-foreground [&_svg]:size-5">
                    {target.icon}
                </span>
                <span className="min-w-0 truncate text-base font-bold">{target.title}</span>
            </div>
            {target.detail && <p className="text-sm text-muted-foreground">{target.detail}</p>}
            <PreviewKey
                icon={PiArrowElbowDownLeft}
                label="Open"
                hint={<kbd className="rounded border bg-muted px-1 font-sans text-[0.625rem] text-muted-foreground">Enter</kbd>}
                onClick={onOpen}
            />
        </div>
    );
}
