import type { CSSProperties, ReactNode } from "react";
import useSWR from "swr";
import { cn } from "@/lib/utils";
import { useAuthedFetcher } from "@/hooks/fetch";
import type { PlayerModalRefType } from "@/hooks/playerModal";
import { jobBadgeStyle } from "@/lib/jobColors";
import type { PlayerCharacter, PlayerCharactersResp, PlayerHistoryItem } from "@shared/playerApiTypes";


/**
 * Everfall: shared pieces of the player window, styled after ef_administration.
 */

export const moneyFormatter = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
});
export const dateFormatter = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' });
export const dateTimeFormatter = new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
    hour12: true,
});

export function formatMoney(value: number | null) {
    return value === null ? '—' : moneyFormatter.format(value);
}

/** Minutes as "6d 13h" or "1h 22m". */
export function compactDuration(minutes: number) {
    const days = Math.floor(minutes / 1440);
    const hours = Math.floor((minutes % 1440) / 60);
    return days ? `${days}d ${hours}h` : `${hours}h ${minutes % 60}m`;
}

export function errorText(error: unknown) {
    return error instanceof Error ? error.message : String(error);
}

export function playerRefQuery(playerRef: PlayerModalRefType) {
    return new URLSearchParams(
        'license' in playerRef
            ? { license: playerRef.license }
            : { mutex: playerRef.mutex, netid: String(playerRef.netid) }
    ).toString();
}

/** The player's QBox characters; the overview, the rail and each character page share this request. */
export function usePlayerCharacters(playerRef: PlayerModalRefType) {
    const authedFetcher = useAuthedFetcher();
    return useSWR(
        `/player/characters?${playerRefQuery(playerRef)}`,
        (url: string) => authedFetcher<PlayerCharactersResp>(url),
        { revalidateOnFocus: false },
    );
}

const monthDayFormatter = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });

export function characterLastSeen(character: PlayerCharacter) {
    if (character.online) return 'Now';
    const ts = character.tsLastLoggedOut ?? character.tsLastUpdated;
    if (ts === null) return '—';
    const date = new Date(ts * 1000);
    return date.getFullYear() === new Date().getFullYear() ? monthDayFormatter.format(date) : dateFormatter.format(date);
}

export function initials(name: string) {
    const letters = name.split(/\s+/).filter(Boolean).map((part) => part[0]);
    return (letters.length > 1 ? letters[0] + letters[letters.length - 1] : name.slice(0, 2)).toUpperCase();
}


export type Tone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

const toneClasses: Record<Tone, string> = {
    success: 'border-success/40 bg-success/10 text-success-inline',
    warning: 'border-warning/40 bg-warning/10 text-warning-inline',
    danger: 'border-destructive/40 bg-destructive/10 text-destructive-inline',
    info: 'border-info/40 bg-info/10 text-info-inline',
    neutral: 'border-border bg-muted/40 text-muted-foreground',
};
export const toneText: Record<Tone, string> = {
    success: 'text-success-inline',
    warning: 'text-warning-inline',
    danger: 'text-destructive-inline',
    info: 'text-info-inline',
    neutral: 'text-muted-foreground',
};

export function Pill({ tone = 'neutral', className, title, children }: {
    tone?: Tone;
    className?: string;
    title?: string;
    children: ReactNode;
}) {
    return (
        <span
            title={title}
            className={cn(
                'inline-flex h-5 shrink-0 items-center gap-1 whitespace-nowrap rounded border px-1.5 text-xs font-semibold',
                toneClasses[tone],
                className,
            )}
        >
            {children}
        </span>
    );
}

/** A job badge in its ef_scoreboard color, with the grade after the label. */
export function JobBadge({ character, className }: { character: PlayerCharacter; className?: string }) {
    if (!character.jobLabel) return null;
    const style: CSSProperties | undefined = jobBadgeStyle(character.jobColor);
    return (
        <span
            style={style}
            className={cn(
                'inline-flex h-5 max-w-full items-center gap-1 truncate rounded px-1.5 text-xs font-semibold',
                !style && 'bg-muted text-muted-foreground',
                className,
            )}
        >
            {character.jobLabel}
            {character.jobGrade && <span className="font-medium opacity-80">{character.jobGrade}</span>}
        </span>
    );
}

export function hasGang(character: PlayerCharacter) {
    return !!character.gangName && character.gangName !== 'none';
}

export function GangBadge({ character }: { character: PlayerCharacter }) {
    if (!hasGang(character)) return null;
    return (
        <Pill>
            {character.gangLabel ?? character.gangName}
            {character.gangGrade && <span className="font-medium opacity-80">{character.gangGrade}</span>}
        </Pill>
    );
}

export function Avatar({ name, online, className }: { name: string; online?: boolean; className?: string }) {
    return (
        <span className={cn(
            'relative flex size-9 shrink-0 items-center justify-center rounded-md border bg-muted/40 font-mono text-xs font-semibold text-muted-foreground',
            className,
        )}>
            {initials(name)}
            {online && <span className="absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full border-2 border-card bg-success" />}
        </span>
    );
}

export function Panel({ className, children }: { className?: string; children: ReactNode }) {
    return <div className={cn('rounded-lg border bg-card', className)}>{children}</div>;
}

export function PanelHeader({ title, children }: { title: ReactNode; children?: ReactNode }) {
    return (
        <div className="flex min-h-11 items-center justify-between gap-2 border-b px-4 py-2">
            <h3 className="text-sm font-semibold">{title}</h3>
            {children}
        </div>
    );
}

export type Stat = { label: string; value: ReactNode; tone?: Tone; mono?: boolean; wrap?: boolean };

export function StatStrip({ stats }: { stats: Stat[] }) {
    return (
        <Panel className="grid grid-cols-2 overflow-hidden sm:grid-cols-3 xl:grid-cols-6">
            {stats.map((stat) => (
                <div key={stat.label} className="min-w-0 border-b border-r px-4 py-3 -mb-px -mr-px">
                    <div className="text-xs text-muted-foreground">{stat.label}</div>
                    <div className={cn(
                        'mt-0.5 text-lg font-semibold leading-snug tabular-nums',
                        !stat.wrap && 'truncate',
                        stat.mono && 'font-mono',
                        stat.tone && toneText[stat.tone],
                    )}>
                        {stat.value}
                    </div>
                </div>
            ))}
        </Panel>
    );
}

export function EmptyRow({ children }: { children: ReactNode }) {
    return <p className="px-4 py-6 text-center text-sm text-muted-foreground">{children}</p>;
}


/** Where a sanction stands, for its badge in the history tables. */
export function actionStatus(action: PlayerHistoryItem, serverTime: number): { label: string; tone: Tone } | null {
    if (action.historical) return { label: 'Historical', tone: 'neutral' };
    if (action.revokedBy) return { label: 'Revoked', tone: 'neutral' };
    if (action.type === 'ban') {
        return action.exp && action.exp < serverTime
            ? { label: 'Expired', tone: 'neutral' }
            : { label: 'Active', tone: 'danger' };
    }
    if (action.type === 'warn' && action.offenseUntil && action.offenseUntil > serverTime) {
        return { label: 'Counts', tone: 'warning' };
    }
    return null;
}

export const actionTypeTone: Record<PlayerHistoryItem['type'], Tone> = {
    ban: 'danger',
    warn: 'warning',
    kick: 'neutral',
    sanction: 'info',
};
