import { useState, type ReactNode } from "react";
import useSWR from "swr";
import { ChevronRightIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuthedFetcher } from "@/hooks/fetch";
import type { PlayerModalRefType } from "@/hooks/playerModal";
import InlineCode from "@/components/InlineCode";
import GenericSpinner from "@/components/GenericSpinner";
import { ModalTabInner, ModalTabMessage } from "@/components/modal-tabs";
import type { PlayerCharacter, PlayerCharacterDetailResp, PlayerCharactersResp } from "@shared/playerApiTypes";
import { useEverfallPermissions } from "@/hooks/everfall";
import {
    CharacterAuditView,
    CharacterSectionView,
    CharacterViewTabs,
    CharacterWalletView,
    type CharacterView,
} from "./CharacterSections";
import {
    CharacterActionDialog,
    CharacterActionsMenu,
    progressionSource,
    type OpenCharacterAction,
} from "./CharacterActions";
import { Button } from "@/components/ui/button";


const moneyFormatter = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
});
const dateTimeFormatter = new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
    hour12: true,
});

function formatMoney(value: number | null) {
    return value === null ? '—' : moneyFormatter.format(value);
}

function roleLine(label: string | null, grade: string | null) {
    if (!label) return null;
    return grade ? `${label} · ${grade}` : label;
}

const vehicleStates: Record<number, string> = { 0: 'Out', 1: 'Garaged', 2: 'Impounded' };
const numberFormatter = new Intl.NumberFormat('en-US');

function DetailSection({ title, count, children }: { title: string; count: number; children: ReactNode }) {
    return (
        <section className="min-w-0">
            <h4 className="text-xs font-medium text-muted-foreground mb-1">
                {title} <span className="tabular-nums">({count})</span>
            </h4>
            {count ? children : <p className="text-xs text-muted-foreground">None</p>}
        </section>
    );
}

function CharacterDetail({ citizenId }: { citizenId: string }) {
    const authedFetcher = useAuthedFetcher();
    const swr = useSWR(
        `/player/characterDetail?${new URLSearchParams({ citizenId })}`,
        (url: string) => authedFetcher<PlayerCharacterDetailResp>(url),
        { revalidateOnFocus: false },
    );

    if (swr.error) {
        return <p className="text-xs text-destructive-inline">Error: {swr.error instanceof Error ? swr.error.message : String(swr.error)}</p>;
    }
    if (!swr.data) {
        return <GenericSpinner msg="Loading Details..." />;
    }
    if ('error' in swr.data) {
        return <p className="text-xs text-destructive-inline">Error: {swr.data.error}</p>;
    }
    if (swr.data.status === 'unavailable') {
        return <p className="text-xs text-muted-foreground">{swr.data.reason}</p>;
    }

    const { vehicles, inventory } = swr.data;
    return (
        <div className="grid gap-3 sm:grid-cols-2">
            <DetailSection title="Vehicles" count={vehicles.length}>
                <ul className="space-y-0.5 text-xs">
                    {vehicles.map((vehicle) => (
                        <li key={vehicle.plate} className="flex items-baseline justify-between gap-2">
                            <span className="truncate">
                                <InlineCode className="tracking-widest">{vehicle.plate}</InlineCode>{' '}
                                {vehicle.model ?? 'Unknown Model'}
                            </span>
                            <span className="shrink-0 text-muted-foreground">
                                {[
                                    vehicle.state !== null ? (vehicleStates[vehicle.state] ?? `State ${vehicle.state}`) : null,
                                    vehicle.garage,
                                ].filter(Boolean).join(' · ')}
                            </span>
                        </li>
                    ))}
                </ul>
            </DetailSection>
            <DetailSection title="Inventory" count={inventory.length}>
                <ul className="space-y-0.5 text-xs">
                    {inventory.map((item, index) => (
                        <li key={`${item.slot ?? 'x'}-${item.name}-${index}`} className="flex items-baseline justify-between gap-2">
                            <span className="truncate">{item.label ?? item.name}</span>
                            <span className="shrink-0 tabular-nums text-muted-foreground">
                                ×{numberFormatter.format(item.count)}
                            </span>
                        </li>
                    ))}
                </ul>
            </DetailSection>
        </div>
    );
}

function CharacterRecord({ character }: { character: PlayerCharacter }) {
    const [view, setView] = useState<CharacterView>('detail');
    const [action, setAction] = useState<OpenCharacterAction | null>(null);
    const { can } = useEverfallPermissions();
    const { citizenId } = character;
    const canEditProgression = view === 'progression' && can('EditCharacterProgression');

    return (
        <>
            <CharacterViewTabs
                view={view}
                onViewChange={setView}
                can={can}
                actions={<CharacterActionsMenu character={character} can={can} onSelect={setAction} />}
            />
            {view === 'detail' ? (
                <CharacterDetail citizenId={citizenId} />
            ) : view === 'wallet' ? (
                <CharacterWalletView citizenId={citizenId} />
            ) : view === 'audit' ? (
                <CharacterAuditView citizenId={citizenId} />
            ) : (
                <CharacterSectionView
                    key={view}
                    citizenId={citizenId}
                    section={view}
                    rowAction={canEditProgression ? (source, row) => {
                        const adapterId = progressionSource(source.id);
                        return adapterId && (
                            <Button size="inline" variant="ghost-muted" onClick={() => setAction({ kind: 'editProgression', adapterId, row })}>
                                Edit
                            </Button>
                        );
                    } : undefined}
                />
            )}
            <CharacterActionDialog character={character} open={action} onClose={() => setAction(null)} />
        </>
    );
}

function CharacterItem({ character }: { character: PlayerCharacter }) {
    const [expanded, setExpanded] = useState(false);
    const job = roleLine(character.jobLabel, character.jobGrade);
    const hasGang = character.gangName && character.gangName !== 'none';
    const gang = hasGang ? roleLine(character.gangLabel ?? character.gangName, character.gangGrade) : null;
    const tsLastSeen = character.tsLastLoggedOut ?? character.tsLastUpdated;

    return (
        <div className={cn(
            'px-2 py-1 border-l-4 rounded-r-sm bg-muted/30',
            character.online ? 'border-success' : 'border-muted'
        )}>
            <div className="flex w-full items-baseline justify-between gap-2">
                <button
                    type="button"
                    aria-expanded={expanded}
                    onClick={() => setExpanded(!expanded)}
                    className="flex min-w-0 items-center gap-1 text-left hover:underline focus-visible:underline outline-none"
                >
                    <ChevronRightIcon className={cn('size-3.5 shrink-0 transition-transform', expanded && 'rotate-90')} />
                    <strong className="text-sm truncate">{character.fullName}</strong>
                </button>
                <small className="shrink-0 text-right text-2xs space-x-1">
                    {character.slot !== null && <span className="opacity-75">Slot {character.slot}</span>}
                    <InlineCode className="tracking-widest">{character.citizenId}</InlineCode>
                </small>
            </div>
            {job && <span className="block text-sm">{job}</span>}
            {gang && <span className="block text-sm text-muted-foreground">{gang}</span>}
            <small className="block text-xs opacity-75 space-x-3">
                <span>Cash {formatMoney(character.cash)}</span>
                <span>Bank {formatMoney(character.bank)}</span>
                {character.online ? (
                    <span className="text-success-inline">Online Now</span>
                ) : tsLastSeen !== null && (
                    <span>Last Seen {dateTimeFormatter.format(tsLastSeen * 1000)}</span>
                )}
            </small>
            {expanded && (
                <div className="mt-2 mb-1 border-t border-border/60 pt-2">
                    <CharacterRecord character={character} />
                </div>
            )}
        </div>
    );
}


type PlayerCharactersTabProps = {
    playerRef: PlayerModalRefType;
}

export default function PlayerCharactersTab({ playerRef }: PlayerCharactersTabProps) {
    const authedFetcher = useAuthedFetcher();
    const query = new URLSearchParams(
        'license' in playerRef
            ? { license: playerRef.license }
            : { mutex: playerRef.mutex, netid: String(playerRef.netid) }
    ).toString();
    const swr = useSWR(`/player/characters?${query}`, (url: string) => authedFetcher<PlayerCharactersResp>(url), {
        revalidateOnFocus: false,
    });

    if (swr.error) {
        return <ModalTabMessage>
            <span className="text-destructive-inline">Error: {swr.error instanceof Error ? swr.error.message : String(swr.error)}</span>
        </ModalTabMessage>;
    }
    if (!swr.data) {
        return <ModalTabMessage>
            <GenericSpinner msg="Loading Characters..." />
        </ModalTabMessage>;
    }
    if ('error' in swr.data) {
        return <ModalTabMessage>
            <span className="text-destructive-inline">Error: {swr.data.error}</span>
        </ModalTabMessage>;
    }
    if (swr.data.status === 'unavailable') {
        return <ModalTabMessage className="flex-col gap-1 text-center">
            <span>Characters Unavailable</span>
            <small className="text-sm">{swr.data.reason}</small>
        </ModalTabMessage>;
    }
    if (!swr.data.characters.length) {
        return <ModalTabMessage>
            No characters found.
        </ModalTabMessage>;
    }

    return (
        <ModalTabInner className="flex flex-col gap-1">
            {swr.data.characters.map((character) => (
                <CharacterItem key={character.citizenId} character={character} />
            ))}
        </ModalTabInner>
    );
}
