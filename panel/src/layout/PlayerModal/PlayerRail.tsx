import type { IconType } from "react-icons";
import { PiClockCounterClockwise, PiFingerprint, PiLinkSimple, PiNotePencil, PiSquaresFour } from "react-icons/pi";
import useSWR from "swr";
import { cn } from "@/lib/utils";
import { useAuthedFetcher } from "@/hooks/fetch";
import type { PlayerModalRefType } from "@/hooks/playerModal";
import type { PlayerLinkedAccountsResp, PlayerModalPlayerData } from "@shared/playerApiTypes";
import type { PlayerSection } from "./PlayerHeader";
import { Avatar, compactDuration, dateFormatter, playerRefQuery, usePlayerCharacters } from "./parts";


/** What the main pane shows: a player section or one character. */
export type PlayerView = { section: PlayerSection } | { citizenId: string };

function RailButton({ active, onClick, children, className }: {
    active: boolean;
    onClick: () => void;
    children: React.ReactNode;
    className?: string;
}) {
    return (
        <button
            type="button"
            aria-current={active ? 'page' : undefined}
            onClick={onClick}
            className={cn(
                'flex shrink-0 items-center gap-2.5 rounded-md px-2.5 text-left text-sm transition-colors outline-none',
                'hover:bg-muted/60 focus-visible:bg-muted/60',
                active ? 'bg-muted font-medium text-foreground' : 'text-muted-foreground',
                className,
            )}
        >
            {children}
        </button>
    );
}

function StatRow({ label, value }: { label: string; value: string }) {
    return (
        <div className="flex items-baseline justify-between gap-2 border-t px-3 py-1.5 text-xs first:border-t-0">
            <span className="text-muted-foreground">{label}</span>
            <span className="tabular-nums">{value}</span>
        </div>
    );
}

type PlayerRailProps = {
    playerRef: PlayerModalRefType;
    player: PlayerModalPlayerData;
    view: PlayerView;
    onViewChange: (view: PlayerView) => void;
};

export default function PlayerRail({ playerRef, player, view, onViewChange }: PlayerRailProps) {
    const authedFetcher = useAuthedFetcher();
    const characters = usePlayerCharacters(playerRef);
    const linked = useSWR(
        `/player/linked?${playerRefQuery(playerRef)}`,
        (url: string) => authedFetcher<PlayerLinkedAccountsResp>(url),
        { revalidateOnFocus: false },
    );
    const linkedCount = linked.data && 'accounts' in linked.data ? linked.data.accounts.length : undefined;
    const idCount = new Set([...player.idsOnline, ...player.idsOffline, ...player.hwidsOnline, ...player.hwidsOffline]).size;
    const characterList = characters.data && 'characters' in characters.data ? characters.data.characters : [];

    const sections: { section: PlayerSection; label: string; icon: IconType; count?: number }[] = [
        { section: 'overview', label: 'Overview', icon: PiSquaresFour },
        { section: 'history', label: 'History', icon: PiClockCounterClockwise, count: player.actionHistory.length },
        { section: 'notes', label: 'Notes', icon: PiNotePencil, count: player.noteHistory?.length ?? 0 },
        { section: 'linked', label: 'Linked Accounts', icon: PiLinkSimple, count: linkedCount },
        { section: 'ids', label: 'Identifiers', icon: PiFingerprint, count: idCount },
    ];
    const stats = [
        { label: 'Playtime', value: player.playTime ? compactDuration(player.playTime) : '—' },
        { label: 'Joined', value: player.tsJoined ? dateFormatter.format(player.tsJoined * 1000) : '—' },
        { label: 'Whitelisted', value: player.tsWhitelisted ? dateFormatter.format(player.tsWhitelisted * 1000) : 'Not Yet' },
    ];

    return (
        <nav className={cn(
            'flex shrink-0 gap-1 overflow-x-auto border-b p-2',
            'md:w-60 md:flex-col md:overflow-x-visible md:overflow-y-auto md:border-b-0 md:border-r md:p-3',
        )}>
            {sections.map(({ section, label, icon: Icon, count }) => (
                <RailButton
                    key={section}
                    active={'section' in view && view.section === section}
                    onClick={() => onViewChange({ section })}
                    className="h-9"
                >
                    <Icon className="size-[1.125rem] shrink-0" />
                    <span className="grow whitespace-nowrap">{label}</span>
                    {count !== undefined && <span className="text-xs tabular-nums text-muted-foreground">{count}</span>}
                </RailButton>
            ))}

            {characterList.length > 0 && (
                <h3 className="hidden px-2.5 pb-1 pt-4 text-[0.6875rem] font-semibold uppercase tracking-wider text-muted-foreground md:block">
                    Characters
                </h3>
            )}
            {characterList.map((character) => (
                <RailButton
                    key={character.citizenId}
                    active={'citizenId' in view && view.citizenId === character.citizenId}
                    onClick={() => onViewChange({ citizenId: character.citizenId })}
                    className="py-1.5"
                >
                    <Avatar name={character.fullName} online={character.online} className="size-8" />
                    <span className="min-w-0">
                        <span className="block truncate font-medium text-foreground">{character.fullName}</span>
                        <span className="block truncate text-xs text-muted-foreground">{character.jobLabel ?? 'No Job'}</span>
                    </span>
                </RailButton>
            ))}

            <div className="mt-auto hidden pt-3 md:block">
                <div className="rounded-lg border">
                    {stats.map((stat) => <StatRow key={stat.label} {...stat} />)}
                </div>
            </div>
        </nav>
    );
}
