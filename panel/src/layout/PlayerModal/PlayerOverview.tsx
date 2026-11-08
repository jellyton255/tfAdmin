import { PiCaretRight, PiEye } from "react-icons/pi";
import GenericSpinner from "@/components/GenericSpinner";
import StaffNoteText, { formatNoteAge } from "@/components/StaffNoteText";
import type { PlayerModalRefType } from "@/hooks/playerModal";
import type { PlayerCharacter, PlayerModalSuccess } from "@shared/playerApiTypes";
import { HistoryTable } from "./PlayerHistoryTab";
import { NoteCard } from "./PlayerNotesTab";
import type { PlayerView } from "./PlayerRail";
import {
    Avatar, characterLastSeen, compactDuration, dateFormatter, EmptyRow, errorText, formatMoney, GangBadge, JobBadge,
    Panel, PanelHeader, StatStrip, usePlayerCharacters,
} from "./parts";


const RECENT_HISTORY = 4;
const RECENT_NOTES = 2;

function MoneyCell({ label, value, money }: { label: string; value: string; money?: boolean }) {
    return (
        <div className="min-w-0">
            <div className="text-xs text-muted-foreground">{label}</div>
            <div className={money ? 'truncate text-sm font-semibold tabular-nums text-success-inline' : 'truncate text-sm font-semibold tabular-nums'}>
                {value}
            </div>
        </div>
    );
}

function CharacterCard({ character, onOpen }: { character: PlayerCharacter; onOpen: () => void }) {
    return (
        <button
            type="button"
            onClick={onOpen}
            className="group flex min-w-0 flex-col gap-3 rounded-lg border bg-card p-4 text-left transition-colors hover:border-foreground/25 hover:bg-muted/30"
        >
            <div className="flex w-full items-center gap-3">
                <Avatar name={character.fullName} />
                <div className="min-w-0 grow">
                    <div className="flex items-center gap-1.5">
                        <span className="truncate font-semibold">{character.fullName}</span>
                        {character.online && <span className="size-2 shrink-0 rounded-full bg-success" title="Online" />}
                    </div>
                    <div className="truncate font-mono text-xs text-muted-foreground">
                        {character.citizenId}{character.slot !== null && ` · Slot ${character.slot}`}
                    </div>
                </div>
                <PiCaretRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
            </div>
            <div className="flex min-h-5 flex-wrap gap-1.5">
                {character.jobLabel ? <JobBadge character={character} /> : <span className="text-xs text-muted-foreground">No Job</span>}
                <GangBadge character={character} />
            </div>
            <div className="flex w-full flex-wrap gap-x-5 gap-y-2">
                <MoneyCell label="Cash" value={formatMoney(character.cash)} money />
                <MoneyCell label="Bank" value={formatMoney(character.bank)} money />
                <MoneyCell label="Vehicles" value={character.vehicleCount === null ? '—' : String(character.vehicleCount)} />
                <MoneyCell label="Last Seen" value={characterLastSeen(character)} />
            </div>
        </button>
    );
}

function CharacterCards({ playerRef, onOpen }: { playerRef: PlayerModalRefType; onOpen: (citizenId: string) => void }) {
    const swr = usePlayerCharacters(playerRef);
    if (swr.error) return <Panel><EmptyRow>Error: {errorText(swr.error)}</EmptyRow></Panel>;
    if (!swr.data) return <Panel className="py-6"><GenericSpinner msg="Loading Characters..." /></Panel>;
    if ('error' in swr.data) return <Panel><EmptyRow>Error: {swr.data.error}</EmptyRow></Panel>;
    if (swr.data.status === 'unavailable') return <Panel><EmptyRow>{swr.data.reason}</EmptyRow></Panel>;
    if (!swr.data.characters.length) return <Panel><EmptyRow>No characters.</EmptyRow></Panel>;
    return (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {swr.data.characters.map((character) => (
                <CharacterCard key={character.citizenId} character={character} onOpen={() => onOpen(character.citizenId)} />
            ))}
        </div>
    );
}

function useTotalWealth(playerRef: PlayerModalRefType) {
    const swr = usePlayerCharacters(playerRef);
    if (!swr.data || !('characters' in swr.data)) return '—';
    const total = swr.data.characters.reduce((sum, character) => sum + (character.cash ?? 0) + (character.bank ?? 0), 0);
    return formatMoney(total);
}

type PlayerOverviewProps = {
    playerRef: PlayerModalRefType;
    data: PlayerModalSuccess;
    onViewChange: (view: PlayerView) => void;
};

export default function PlayerOverview({ playerRef, data, onViewChange }: PlayerOverviewProps) {
    const { player, serverTime, banTemplates } = data;
    const totalWealth = useTotalWealth(playerRef);
    const history = [...player.actionHistory].reverse();
    const notes = player.noteHistory ?? [];
    const count = (type: string) => player.actionHistory.filter((a) => a.type === type && !a.revokedAt && !a.historical).length;
    const activeBans = player.actionHistory.filter((a) => (
        a.type === 'ban' && !a.revokedAt && !a.historical && (!a.exp || a.exp >= serverTime)
    )).length;
    const bans = count('ban');

    return (
        <div className="flex flex-col gap-3">
            {player.watch && (
                <Panel className="flex gap-3 border-warning/40 bg-warning/5 px-4 py-3">
                    <PiEye className="mt-0.5 size-[1.125rem] shrink-0 text-warning-inline" />
                    <div className="min-w-0">
                        <StaffNoteText text={player.watch.reason} />
                        <small className="block text-xs text-muted-foreground">
                            Watched by {player.watch.author} · {formatNoteAge(serverTime - player.watch.ts)}
                        </small>
                    </div>
                </Panel>
            )}

            <StatStrip stats={[
                { label: 'Playtime', value: player.playTime ? compactDuration(player.playTime) : '—' },
                player.isConnected
                    ? { label: 'Last Seen', value: 'Online Now', tone: 'success' }
                    : { label: 'Last Seen', value: player.tsLastConnection ? dateFormatter.format(player.tsLastConnection * 1000) : '—' },
                { label: 'Warns', value: count('warn'), tone: count('warn') ? 'warning' : undefined },
                { label: 'Kicks', value: count('kick') },
                { label: 'Bans', value: activeBans ? `${bans} · Active` : bans, tone: activeBans ? 'danger' : undefined },
                { label: 'Total Wealth', value: totalWealth, tone: 'success' },
            ]} />

            <CharacterCards playerRef={playerRef} onOpen={(citizenId) => onViewChange({ citizenId })} />

            <Panel>
                <PanelHeader title="Recent History">
                    {history.length > RECENT_HISTORY && (
                        <button
                            type="button"
                            className="text-xs text-muted-foreground hover:text-foreground"
                            onClick={() => onViewChange({ section: 'history' })}
                        >
                            View All {history.length}
                        </button>
                    )}
                </PanelHeader>
                <HistoryTable actions={history.slice(0, RECENT_HISTORY)} banTemplates={banTemplates} serverTime={serverTime} />
            </Panel>

            {notes.length > 0 && (
                <div className="grid gap-3 lg:grid-cols-2">
                    {notes.slice(0, RECENT_NOTES).map((note) => (
                        <NoteCard key={note.id} note={note} serverTime={serverTime} />
                    ))}
                </div>
            )}
        </div>
    );
}
