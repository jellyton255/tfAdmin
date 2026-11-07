import { useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { useEverfallQuery } from "@/hooks/everfall";
import GenericSpinner from "@/components/GenericSpinner";
import { Button } from "@/components/ui/button";
import type {
    EverfallCharacterAudit,
    EverfallCharacterSection,
    EverfallCharacterSectionName,
    EverfallCharacterSectionSource,
    EverfallCharacterWallet,
} from "@shared/everfallApiTypes";


/** The views of an expanded character: the saved vehicles and inventory, then ef_administration's sections. */
export type CharacterView = 'detail' | Exclude<EverfallCharacterSectionName, 'vehicles'> | 'wallet' | 'audit';

const sectionViews: { view: CharacterView; label: string; permission: string | null }[] = [
    { view: 'detail', label: 'Vehicles & Inventory', permission: null },
    { view: 'finances', label: 'Finances', permission: 'ViewCharacterConnectedData' },
    { view: 'groups', label: 'Groups', permission: 'ViewCharacterConnectedData' },
    { view: 'properties', label: 'Properties', permission: 'ViewCharacterConnectedData' },
    { view: 'phone', label: 'Phone', permission: 'ViewCharacterConnectedData' },
    { view: 'mdt', label: 'MDT', permission: 'ViewCharacterConnectedData' },
    { view: 'progression', label: 'Progression', permission: 'ViewCharacterConnectedData' },
    { view: 'wallet', label: 'Wallet', permission: 'ViewCharacterConnectedData' },
    { view: 'audit', label: 'Change Log', permission: 'ViewCharacters' },
];

const dateTimeFormatter = new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
    hour12: true,
});
const numberFormatter = new Intl.NumberFormat('en-US', { maximumFractionDigits: 4 });

/** camelCase or snake_case keys as Title Case labels. */
function keyLabel(key: string) {
    return key
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replace(/[_-]+/g, ' ')
        .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

// oxmysql sends DATETIME and TIMESTAMP columns as milliseconds.
function isDateKey(key: string) {
    return /(At|On|Date|Updated|Created)$/.test(key) || key.startsWith('date');
}

function formatValue(key: string, value: unknown) {
    if (value === null || value === undefined || value === '') return '—';
    if (typeof value === 'boolean') return value ? 'Yes' : 'No';
    if (typeof value === 'number') {
        if (isDateKey(key) && value > 1e11) return dateTimeFormatter.format(value);
        return numberFormatter.format(value);
    }
    if (typeof value === 'string') return value;
    return JSON.stringify(value);
}

function errorText(error: unknown) {
    return error instanceof Error ? error.message : String(error);
}

export function CharacterViewTabs({ view, onViewChange, can, actions }: {
    view: CharacterView;
    onViewChange: (view: CharacterView) => void;
    can: (permission: string) => boolean;
    actions?: ReactNode;
}) {
    return (
        <div className="flex items-start justify-between gap-2 mb-2">
            <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
                {sectionViews.filter((entry) => entry.permission === null || can(entry.permission)).map((entry) => (
                    <button
                        key={entry.view}
                        type="button"
                        aria-pressed={view === entry.view}
                        onClick={() => onViewChange(entry.view)}
                        className={cn(
                            'outline-none hover:underline focus-visible:underline',
                            view === entry.view ? 'font-medium text-foreground' : 'text-muted-foreground'
                        )}
                    >
                        {entry.label}
                    </button>
                ))}
            </div>
            {actions}
        </div>
    );
}

function SourceTable({ source, rowAction }: {
    source: EverfallCharacterSectionSource;
    rowAction?: (row: Record<string, unknown>) => ReactNode;
}) {
    // Lua sends an empty table for a source with no rows, which may arrive as {}.
    const rows = Array.isArray(source.rows) ? source.rows : [];
    return (
        <section className="min-w-0">
            <h4 className="text-xs font-medium text-muted-foreground mb-1">
                {source.label} <span className="tabular-nums">({source.count})</span>
            </h4>
            {!source.available ? (
                <p className="text-xs text-muted-foreground">{source.error ?? 'Unavailable on this server.'}</p>
            ) : !rows.length ? (
                <p className="text-xs text-muted-foreground">None</p>
            ) : (
                // Sources have many columns, so each row wraps its fields instead of scrolling a table.
                <ul className="text-xs">
                    {rows.map((row, index) => (
                        <li key={index} className="flex flex-wrap items-baseline gap-x-3 border-t border-border/40 py-0.5 first:border-t-0">
                            {Object.entries(row).map(([key, value]) => {
                                const text = formatValue(key, value);
                                return (
                                    <span key={key} title={text} className="inline-block max-w-64 truncate tabular-nums">
                                        <span className="text-muted-foreground">{keyLabel(key)}</span> {text}
                                    </span>
                                );
                            })}
                            {rowAction && <span className="ml-auto">{rowAction(row)}</span>}
                        </li>
                    ))}
                </ul>
            )}
        </section>
    );
}

export function CharacterSectionView({ citizenId, section, rowAction }: {
    citizenId: string;
    section: EverfallCharacterSectionName;
    rowAction?: (source: EverfallCharacterSectionSource, row: Record<string, unknown>) => ReactNode;
}) {
    const [page, setPage] = useState(1);
    const query = useEverfallQuery<EverfallCharacterSection>('character.section', { citizenId, section, page });

    if (query.error) {
        return <p className="text-xs text-destructive-inline">Error: {errorText(query.error)}</p>;
    }
    if (!query.data) {
        return <GenericSpinner msg="Loading Section..." />;
    }

    const { adapters, pageSize } = query.data;
    const hasMore = adapters.some((source) => source.count > page * pageSize);
    return (
        <div className="flex flex-col gap-3">
            {adapters.map((source) => (
                <SourceTable
                    key={source.id}
                    source={source}
                    rowAction={rowAction && ((row) => rowAction(source, row))}
                />
            ))}
            {(page > 1 || hasMore) && (
                <div className="flex items-center justify-end gap-2 text-xs">
                    <Button size="inline" variant="outline-muted" disabled={page === 1} onClick={() => setPage(page - 1)}>
                        Previous
                    </Button>
                    <span className="tabular-nums text-muted-foreground">Page {page}</span>
                    <Button size="inline" variant="outline-muted" disabled={!hasMore} onClick={() => setPage(page + 1)}>
                        Next
                    </Button>
                </div>
            )}
        </div>
    );
}

export function CharacterWalletView({ citizenId }: { citizenId: string }) {
    const query = useEverfallQuery<EverfallCharacterWallet>('character.wallet', { citizenId });

    if (query.error) {
        return <p className="text-xs text-muted-foreground">{errorText(query.error)}</p>;
    }
    if (!query.data) {
        return <GenericSpinner msg="Loading Wallet..." />;
    }
    const cards = Array.isArray(query.data.cards) ? query.data.cards : [];
    if (!cards.length) {
        return <p className="text-xs text-muted-foreground">No cards in their wallets.</p>;
    }
    return (
        <ul className="space-y-0.5 text-xs">
            {cards.map((card, index) => (
                <li key={`${card.slot}-${card.item}-${index}`} className="flex items-baseline justify-between gap-2">
                    <span className="truncate">{card.label}</span>
                    <span className="shrink-0 text-muted-foreground">
                        {[
                            keyLabel(card.status),
                            card.expiresAt ? `Expires ${dateTimeFormatter.format(card.expiresAt * 1000)}` : null,
                        ].filter(Boolean).join(' · ')}
                    </span>
                </li>
            ))}
        </ul>
    );
}

export function CharacterAuditView({ citizenId }: { citizenId: string }) {
    const query = useEverfallQuery<EverfallCharacterAudit>('character.audit', { citizenId });

    if (query.error) {
        return <p className="text-xs text-destructive-inline">Error: {errorText(query.error)}</p>;
    }
    if (!query.data) {
        return <GenericSpinner msg="Loading Change Log..." />;
    }
    const rows = Array.isArray(query.data.rows) ? query.data.rows : [];
    if (!rows.length) {
        return <p className="text-xs text-muted-foreground">No staff changes.</p>;
    }
    return (
        <ul className="space-y-1 text-xs">
            {rows.map((row) => (
                <li key={row.id}>
                    <div className="flex items-baseline justify-between gap-2">
                        <span className="truncate">
                            <span className="font-medium">{keyLabel(row.action)}</span>
                            {row.actorName && <span className="text-muted-foreground"> by {row.actorName}</span>}
                            {row.outcome !== 'succeeded' && <span className="text-destructive-inline"> · {keyLabel(row.outcome)}</span>}
                        </span>
                        <span className="shrink-0 text-muted-foreground">
                            {dateTimeFormatter.format(typeof row.createdAt === 'number' ? row.createdAt : new Date(row.createdAt))}
                        </span>
                    </div>
                    {row.reason && <p className="text-muted-foreground truncate" title={row.reason}>{row.reason}</p>}
                </li>
            ))}
        </ul>
    );
}
