import { useState } from "react";
import useSWR from "swr";
import { useAuthedFetcher } from "@/hooks/fetch";
import type { PlayerModalRefType } from "@/hooks/playerModal";
import GenericSpinner from "@/components/GenericSpinner";
import { Button } from "@/components/ui/button";
import type { PlayerCharacter, PlayerCharacterDetailResp } from "@shared/playerApiTypes";
import { useEverfallPermissions } from "@/hooks/everfall";
import { jobBadgeStyle } from "@/lib/jobColors";
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
import {
    Avatar, characterLastSeen, EmptyRow, errorText, formatMoney, GangBadge, hasGang, Pill,
    StatStrip, usePlayerCharacters,
} from "./parts";


const vehicleStates: Record<number, { label: string; tone: 'success' | 'info' | 'warning' }> = {
    0: { label: 'Out', tone: 'info' },
    1: { label: 'Garaged', tone: 'success' },
    2: { label: 'Impounded', tone: 'warning' },
};
const numberFormatter = new Intl.NumberFormat('en-US');

const thClass = 'px-4 py-2 text-left text-[0.6875rem] font-semibold uppercase tracking-wider text-muted-foreground';
const tdClass = 'border-t px-4 py-2';

/** The saved vehicles or inventory of a character, read from the game database. */
function CharacterDetail({ citizenId, part }: { citizenId: string; part: 'vehicles' | 'inventory' }) {
    const authedFetcher = useAuthedFetcher();
    const swr = useSWR(
        `/player/characterDetail?${new URLSearchParams({ citizenId })}`,
        (url: string) => authedFetcher<PlayerCharacterDetailResp>(url),
        { revalidateOnFocus: false },
    );

    if (swr.error) return <EmptyRow>Error: {errorText(swr.error)}</EmptyRow>;
    if (!swr.data) return <div className="py-6"><GenericSpinner msg="Loading..." /></div>;
    if ('error' in swr.data) return <EmptyRow>Error: {swr.data.error}</EmptyRow>;
    if (swr.data.status === 'unavailable') return <EmptyRow>{swr.data.reason}</EmptyRow>;

    if (part === 'vehicles') {
        const { vehicles } = swr.data;
        if (!vehicles.length) return <EmptyRow>No vehicles.</EmptyRow>;
        return (
            <div className="overflow-x-auto">
                <table className="w-full text-sm">
                    <thead><tr>
                        <th className={thClass}>Plate</th>
                        <th className={thClass}>Model</th>
                        <th className={thClass}>Garage</th>
                        <th className={`${thClass} text-right`}>Mileage</th>
                        <th className={thClass}>State</th>
                    </tr></thead>
                    <tbody>
                        {vehicles.map((vehicle) => {
                            const state = vehicle.state !== null ? vehicleStates[vehicle.state] : undefined;
                            return (
                                <tr key={vehicle.plate} className="hover:bg-muted/30">
                                    <td className={`${tdClass} whitespace-nowrap font-mono font-semibold tracking-wider`}>{vehicle.plate}</td>
                                    <td className={tdClass}>{vehicle.model ?? 'Unknown Model'}</td>
                                    <td className={`${tdClass} text-muted-foreground`}>{vehicle.garage ?? '—'}</td>
                                    <td className={`${tdClass} text-right font-mono tabular-nums text-muted-foreground`}>
                                        {vehicle.mileage === null ? '—' : `${numberFormatter.format(Math.round(vehicle.mileage))} mi`}
                                    </td>
                                    <td className={tdClass}>
                                        {state ? <Pill tone={state.tone}>{state.label}</Pill> : vehicle.state !== null && <Pill>State {vehicle.state}</Pill>}
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        );
    }

    const { inventory } = swr.data;
    if (!inventory.length) return <EmptyRow>No saved items.</EmptyRow>;
    return (
        <div className="overflow-x-auto">
            <table className="w-full text-sm">
                <thead><tr>
                    <th className={`${thClass} w-16`}>Slot</th>
                    <th className={thClass}>Item</th>
                    <th className={thClass}>Name</th>
                    <th className={`${thClass} text-right`}>Count</th>
                </tr></thead>
                <tbody>
                    {inventory.map((item, index) => (
                        <tr key={`${item.slot ?? 'x'}-${item.name}-${index}`} className="hover:bg-muted/30">
                            <td className={`${tdClass} font-mono tabular-nums text-muted-foreground`}>{item.slot ?? '—'}</td>
                            <td className={`${tdClass} font-medium`}>{item.label ?? item.name}</td>
                            <td className={`${tdClass} font-mono text-xs text-muted-foreground`}>{item.name}</td>
                            <td className={`${tdClass} text-right font-mono tabular-nums`}>×{numberFormatter.format(item.count)}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

function CharacterRecord({ character }: { character: PlayerCharacter }) {
    const [view, setView] = useState<CharacterView>('vehicles');
    const [action, setAction] = useState<OpenCharacterAction | null>(null);
    const { can } = useEverfallPermissions();
    const { citizenId } = character;
    const canEditProgression = view === 'progression' && can('EditCharacterProgression');

    return (
        <div className="flex flex-col gap-3">
            <div className="flex items-center gap-3">
                <Avatar name={character.fullName} className="size-11 text-sm" />
                <div className="min-w-0 grow">
                    <div className="flex flex-wrap items-center gap-2">
                        <h2 className="truncate text-xl font-bold tracking-tight">{character.fullName}</h2>
                        {character.online ? <Pill tone="success">Online</Pill> : <Pill>Offline</Pill>}
                    </div>
                    <div className="truncate font-mono text-xs text-muted-foreground">
                        {[
                            citizenId,
                            character.slot !== null ? `Slot ${character.slot}` : null,
                            character.dateOfBirth ? `Born ${character.dateOfBirth}` : null,
                        ].filter(Boolean).join(' · ')}
                    </div>
                </div>
                <CharacterActionsMenu character={character} can={can} onSelect={setAction} />
            </div>

            <StatStrip stats={[
                { label: 'Cash', value: formatMoney(character.cash), tone: 'success' },
                { label: 'Bank', value: formatMoney(character.bank), tone: 'success' },
                {
                    label: 'Job',
                    wrap: true,
                    value: character.jobLabel ? (
                        <span style={{ color: jobBadgeStyle(character.jobColor)?.color }}>
                            {character.jobLabel}
                            {character.jobGrade && <span className="block text-sm font-medium text-muted-foreground">{character.jobGrade}</span>}
                        </span>
                    ) : 'None',
                    tone: character.jobLabel ? undefined : 'neutral',
                },
                { label: 'Gang', value: hasGang(character) ? <GangBadge character={character} /> : 'None', tone: hasGang(character) ? undefined : 'neutral' },
                { label: 'Vehicles', value: character.vehicleCount ?? '—' },
                { label: 'Last Seen', value: characterLastSeen(character), tone: character.online ? 'success' : undefined },
            ]} />

            <div className="rounded-lg border bg-card">
                <CharacterViewTabs view={view} onViewChange={setView} can={can} />
                {view === 'vehicles' || view === 'inventory' ? (
                    <CharacterDetail citizenId={citizenId} part={view} />
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
            </div>
            <CharacterActionDialog character={character} open={action} onClose={() => setAction(null)} />
        </div>
    );
}

/** One character of the player, picked from the rail or an overview card. */
export default function PlayerCharacterPage({ playerRef, citizenId }: { playerRef: PlayerModalRefType; citizenId: string }) {
    const swr = usePlayerCharacters(playerRef);
    if (swr.error) return <EmptyRow>Error: {errorText(swr.error)}</EmptyRow>;
    if (!swr.data) return <div className="py-10"><GenericSpinner msg="Loading Character..." /></div>;
    if ('error' in swr.data) return <EmptyRow>Error: {swr.data.error}</EmptyRow>;
    if (swr.data.status === 'unavailable') return <EmptyRow>{swr.data.reason}</EmptyRow>;
    const character = swr.data.characters.find((entry) => entry.citizenId === citizenId);
    if (!character) return <EmptyRow>This character no longer exists.</EmptyRow>;
    return <CharacterRecord key={citizenId} character={character} />;
}
