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


/** The views of a character: the saved vehicles and inventory, then ef_administration's sections. */
export type CharacterView = 'vehicles' | 'inventory' | Exclude<EverfallCharacterSectionName, 'vehicles'> | 'wallet' | 'audit';

const sectionViews: { view: CharacterView; label: string; permission: string | null }[] = [
    { view: 'vehicles', label: 'Vehicles', permission: null },
    { view: 'inventory', label: 'Inventory', permission: null },
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

export function CharacterViewTabs({ view, onViewChange, can }: {
    view: CharacterView;
    onViewChange: (view: CharacterView) => void;
    can: (permission: string) => boolean;
}) {
    return (
        <div className="flex gap-5 overflow-x-auto border-b px-4">
            {sectionViews.filter((entry) => entry.permission === null || can(entry.permission)).map((entry) => (
                <button
                    key={entry.view}
                    type="button"
                    aria-pressed={view === entry.view}
                    onClick={() => onViewChange(entry.view)}
                    className={cn(
                        '-mb-px shrink-0 whitespace-nowrap border-b-2 py-2.5 text-sm outline-none transition-colors',
                        view === entry.view
                            ? 'border-foreground font-medium text-foreground'
                            : 'border-transparent text-muted-foreground hover:text-foreground focus-visible:text-foreground'
                    )}
                >
                    {entry.label}
                </button>
            ))}
        </div>
    );
}

function SourceTable({ source, rowAction }: {
    source: EverfallCharacterSectionSource;
    rowAction?: (row: Record<string, unknown>) => ReactNode;
}) {
    // Lua sends an empty table for a source with no rows, which may arrive as {}.
    const rows = Array.isArray(source.rows) ? source.rows : [];
    // Each source has its own columns; take them from every row in order of appearance.
    const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
    return (
        <section className="min-w-0 border-t first:border-t-0">
            <h4 className="flex items-baseline gap-2 px-4 pb-1 pt-3 text-xs font-semibold">
                {source.label} <span className="font-normal tabular-nums text-muted-foreground">{source.count}</span>
            </h4>
            {!source.available ? (
                <p className="px-4 pb-3 text-sm text-muted-foreground">{source.error ?? 'Unavailable on this server.'}</p>
            ) : !rows.length ? (
                <p className="px-4 pb-3 text-sm text-muted-foreground">None</p>
            ) : (
                <div className="overflow-x-auto pb-1">
                    <table className="w-full text-sm">
                        <thead><tr>
                            {columns.map((key) => (
                                <th key={key} className="whitespace-nowrap px-4 py-1.5 text-left text-[0.6875rem] font-semibold uppercase tracking-wider text-muted-foreground">
                                    {keyLabel(key)}
                                </th>
                            ))}
                            {rowAction && <th />}
                        </tr></thead>
                        <tbody>
                            {rows.map((row, index) => (
                                <tr key={index} className="hover:bg-muted/30">
                                    {columns.map((key) => {
                                        const text = formatValue(key, row[key]);
                                        return (
                                            <td key={key} title={text} className="max-w-64 truncate border-t px-4 py-1.5 tabular-nums">
                                                {text}
                                            </td>
                                        );
                                    })}
                                    {rowAction && <td className="border-t px-4 py-1.5 text-right">{rowAction(row)}</td>}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
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
        return <p className="px-4 py-6 text-center text-sm text-destructive-inline">Error: {errorText(query.error)}</p>;
    }
    if (!query.data) {
        return <div className="py-6"><GenericSpinner msg="Loading Section..." /></div>;
    }

    const { adapters, pageSize } = query.data;
    const hasMore = adapters.some((source) => source.count > page * pageSize);
    return (
        <div className="flex flex-col">
            {adapters.map((source) => (
                <SourceTable
                    key={source.id}
                    source={source}
                    rowAction={rowAction && ((row) => rowAction(source, row))}
                />
            ))}
            {(page > 1 || hasMore) && (
                <div className="flex items-center justify-end gap-2 border-t px-4 py-2 text-xs">
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
        return <p className="px-4 py-6 text-center text-sm text-muted-foreground">{errorText(query.error)}</p>;
    }
    if (!query.data) {
        return <div className="py-6"><GenericSpinner msg="Loading Wallet..." /></div>;
    }
    const cards = Array.isArray(query.data.cards) ? query.data.cards : [];
    if (!cards.length) {
        return <p className="px-4 py-6 text-center text-sm text-muted-foreground">No cards in their wallets.</p>;
    }
    return (
        <ul className="text-sm">
            {cards.map((card, index) => (
                <li key={`${card.slot}-${card.item}-${index}`} className="flex items-baseline justify-between gap-2 border-t px-4 py-2 first:border-t-0">
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
        return <p className="px-4 py-6 text-center text-sm text-destructive-inline">Error: {errorText(query.error)}</p>;
    }
    if (!query.data) {
        return <div className="py-6"><GenericSpinner msg="Loading Change Log..." /></div>;
    }
    const rows = Array.isArray(query.data.rows) ? query.data.rows : [];
    if (!rows.length) {
        return <p className="px-4 py-6 text-center text-sm text-muted-foreground">No staff changes.</p>;
    }
    return (
        <ul className="text-sm">
            {rows.map((row) => (
                <li key={row.id} className="border-t px-4 py-2 first:border-t-0">
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
