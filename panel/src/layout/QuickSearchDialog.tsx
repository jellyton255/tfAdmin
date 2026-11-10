import { useState, type KeyboardEvent, type ReactNode } from "react";
import useSWR from "swr";
import { useAtom, useAtomValue } from "jotai";
import { useDebounceValue } from "usehooks-ts";
import { navigate as setLocation } from "wouter/use-browser-location";
import {
    PiArrowElbowDownLeft, PiArrowsDownUp, PiBank, PiCertificate, PiFileText, PiGavel, PiMagnifyingGlass,
    PiPrinter, PiSpinnerGap, PiUser,
} from "react-icons/pi";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { useAuthedFetcher, useBackendApi } from "@/hooks/fetch";
import { quickSearchOpenAtom } from "@/hooks/dialogs";
import { useAdminPerms } from "@/hooks/auth";
import { useOpenPlayerModal } from "@/hooks/playerModal";
import { useOpenActionModal } from "@/hooks/actionModal";
import { playerlistAtom } from "@/hooks/playerlist";
import { useEverfallPermissions, useEverfallQuery } from "@/hooks/everfall";
import { useAddRecentLookup, useClearRecentLookups, useRecentLookups, type RecentLookup } from "@/hooks/recentLookups";
import { cn } from "@/lib/utils";
import { allRoutes, type RouteType } from "./MainRouter";
import QuickSearchPreview, { type PreviewTarget } from "./QuickSearchPreview";
import type { QuickSearchResp } from "@shared/quickSearchApiTypes";
import type { WhitelistRequestsResp } from "@shared/whitelistApiTypes";


type ResultItem = {
    key: string;
    group: string;
    icon: ReactNode;
    label: string;
    detail: string | null;
    /** right-aligned: a count, an ID or a time */
    aside?: ReactNode;
    preview: PreviewTarget;
    onSelect: () => void;
};

const actionTypeLabels = { ban: 'Ban', warn: 'Warn', kick: 'Kick', sanction: 'Sanction' } as const;
const ONLINE_LIMIT = 6;
// pages staff open most, offered with nothing typed
const GO_TO_PATHS = ['/players', '/history', '/staff-log', '/allowlist', '/groups', '/banking'];
const shortcutLabel = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘K' : 'Ctrl K';

function timeAgo(ts: number) {
    const minutes = Math.round((Date.now() - ts) / 60_000);
    if (minutes < 1) return 'Now';
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.round(hours / 24)}d ago`;
}

function Count({ value, tone }: { value: number | undefined; tone: 'warning' | 'danger' | 'info' }) {
    if (value === undefined) return null;
    return (
        <span className={cn(
            'inline-flex h-5 min-w-6 items-center justify-center rounded-full border px-1.5 text-xs font-bold tabular-nums',
            !value ? 'border-border bg-muted/40 text-muted-foreground'
                : tone === 'danger' ? 'border-destructive/40 bg-destructive/10 text-destructive-inline'
                    : tone === 'warning' ? 'border-warning/40 bg-warning/10 text-warning-inline'
                        : 'border-info/40 bg-info/10 text-info-inline',
        )}>
            {value}
        </span>
    );
}

function Kbd({ children }: { children: ReactNode }) {
    return (
        <kbd className="inline-flex h-5 min-w-5 shrink-0 items-center whitespace-nowrap justify-center rounded border border-b-2 bg-muted px-1 font-sans text-[0.6875rem] font-semibold text-muted-foreground [&_svg]:size-3">
            {children}
        </kbd>
    );
}

/** Queues waiting on staff, each with a live count. Fetched only while the palette is open. */
function useAttentionItems(open: (path: string, title: string) => void): ResultItem[] {
    const authedFetcher = useAuthedFetcher();
    const { hasPerm } = useAdminPerms();
    const { can } = useEverfallPermissions();
    const canWhitelist = hasPerm('players.whitelist');
    const whitelist = useSWR(
        canWhitelist ? '/whitelist/requests' : null,
        (url: string) => authedFetcher<WhitelistRequestsResp>(url),
        { revalidateOnFocus: false },
    );
    const papers = useEverfallQuery<{ pendingCount: number }>(can('ReviewPapers') ? 'papers.list' : null, {
        status: 'pending_review', search: '', limit: 1, offset: 0, sort: 'oldest',
    });
    const alerts = useEverfallQuery<{ total: number }>(can('ViewBanking') ? 'banking.alerts' : null, {
        query: '', page: 1, pageSize: 1, status: 'open',
    });

    const queue = (key: string, icon: ReactNode, label: string, path: string, value: number | undefined, tone: 'warning' | 'danger' | 'info'): ResultItem => ({
        key: `queue:${key}`,
        group: 'Needs Attention',
        icon,
        label,
        detail: null,
        aside: <Count value={value} tone={tone} />,
        preview: { kind: 'other', icon, title: label, detail: value === undefined ? null : `${value} waiting.` },
        onSelect: () => open(path, label),
    });
    return [
        canWhitelist && queue('whitelist', <PiCertificate />, 'Whitelist Requests', '/allowlist',
            whitelist.data && 'cntTotal' in whitelist.data ? whitelist.data.cntTotal : undefined, 'info'),
        can('ReviewPapers') && queue('papers', <PiPrinter />, 'Paper Requests', '/staff-queues', papers.data?.pendingCount, 'warning'),
        can('ViewBanking') && queue('banking', <PiBank />, 'Banking Alerts', '/banking', alerts.data?.total, 'danger'),
    ].filter((item): item is ResultItem => !!item);
}


/**
 * Ctrl+K: search players (name, identifier, citizen ID), actions by ID and pages. With nothing typed
 * it shows recent lookups, queues waiting on staff and who is online. The highlighted player shows
 * on the right with quick actions.
 */
function QuickSearchBody({ close }: { close: () => void }) {
    const [query, setQuery] = useState('');
    const [activeIndex, setActiveIndex] = useState(0);
    const [debouncedQuery] = useDebounceValue(query.trim(), 250);
    const { hasPerm } = useAdminPerms();
    const openPlayerModal = useOpenPlayerModal();
    const openActionModal = useOpenActionModal();
    const playerlist = useAtomValue(playerlistAtom);
    const recent = useRecentLookups();
    const addRecent = useAddRecentLookup();
    const clearRecent = useClearRecentLookups();
    const searchApi = useBackendApi<QuickSearchResp>({ method: 'GET', path: '/quickSearch' });
    const swr = useSWR(debouncedQuery ? ['/quickSearch', debouncedQuery] : null, async () => {
        const resp = await searchApi({ queryParams: { q: debouncedQuery } });
        if (!resp) throw new Error('No data returned.');
        if ('error' in resp) throw new Error(resp.error);
        return resp;
    }, {
        revalidateOnFocus: false,
        keepPreviousData: true,
    });

    function openPlayer(license: string, name: string) {
        addRecent({ kind: 'player', license, name, ts: Date.now() });
        openPlayerModal({ license });
    }
    function openPage(path: string, title: string) {
        addRecent({ kind: 'page', path, title, ts: Date.now() });
        setLocation(path);
    }
    function openAction(id: string, label: string) {
        addRecent({ kind: 'action', id, label, ts: Date.now() });
        openActionModal(id);
    }

    function playerItem(group: string, license: string, name: string, detail: string | null, isOnline: boolean, aside?: ReactNode): ResultItem {
        return {
            key: `${group}:player:${license}`,
            group,
            icon: <PiUser className={cn(isOnline && 'text-success-inline')} />,
            label: name,
            detail,
            aside,
            preview: { kind: 'player', license },
            onSelect: () => openPlayer(license, name),
        };
    }
    function recentItem(lookup: RecentLookup): ResultItem {
        const aside = <span className="text-xs text-muted-foreground">{timeAgo(lookup.ts)}</span>;
        if (lookup.kind === 'player') return playerItem('Recent', lookup.license, lookup.name, null, onlineLicenses.has(lookup.license), aside);
        if (lookup.kind === 'action') {
            return {
                key: `recent:action:${lookup.id}`, group: 'Recent', icon: <PiGavel />, label: lookup.label, detail: null, aside,
                preview: { kind: 'other', icon: <PiGavel />, title: lookup.label, detail: null },
                onSelect: () => openAction(lookup.id, lookup.label),
            };
        }
        return {
            key: `recent:page:${lookup.path}`, group: 'Recent', icon: <PiFileText />, label: lookup.title, detail: null, aside,
            preview: { kind: 'other', icon: <PiFileText />, title: lookup.title, detail: null },
            onSelect: () => openPage(lookup.path, lookup.title),
        };
    }

    const onlineLicenses = new Set(playerlist.map((player) => player.license));
    const attentionItems = useAttentionItems(openPage);
    const trimmed = query.trim();
    const lowerQuery = trimmed.toLowerCase();
    let items: ResultItem[];
    if (!trimmed) {
        const onlineItems = playerlist
            .filter((player): player is typeof player & { license: string } => !!player.license)
            .slice(-ONLINE_LIMIT)
            .reverse()
            .map((player) => playerItem('Online Now', player.license, player.displayName, null, true,
                <span className="font-mono text-xs text-muted-foreground">{player.netid}</span>));
        const goToItems: ResultItem[] = GO_TO_PATHS
            .map((path) => allRoutes.find((route) => route.path === path))
            .filter((route): route is RouteType => !!route && (!route.permission || hasPerm(route.permission)))
            .map((route) => ({
                key: `goto:${route.path}`,
                group: 'Go To',
                icon: <PiFileText />,
                label: route.title,
                detail: null,
                preview: { kind: 'other', icon: <PiFileText />, title: route.title, detail: route.path },
                onSelect: () => openPage(route.path, route.title),
            }));
        items = [...recent.map(recentItem), ...attentionItems, ...onlineItems, ...goToItems];
    } else {
        const pageItems: ResultItem[] = allRoutes
            .filter((route) => route.title.toLowerCase().includes(lowerQuery))
            .filter((route) => !route.permission || hasPerm(route.permission))
            .slice(0, 5)
            .map((route) => ({
                key: `page:${route.path}`,
                group: 'Pages',
                icon: <PiFileText />,
                label: route.title,
                detail: null,
                preview: { kind: 'other', icon: <PiFileText />, title: route.title, detail: route.path },
                onSelect: () => openPage(route.path, route.title),
            }));
        //results of an older query stay until the new ones arrive, but never under an empty box
        const data = debouncedQuery ? swr.data : undefined;
        const playerItems = (data?.players ?? []).map((player) => playerItem('Players', player.license, player.displayName, player.matched ?? `${player.license.slice(0, 8)}…`, player.isOnline));
        const actionItems: ResultItem[] = (data?.actions ?? []).map((action) => {
            const label = `${action.id} · ${actionTypeLabels[action.type]}${action.playerName ? ` · ${action.playerName}` : ''}`;
            return {
                key: `action:${action.id}`,
                group: 'Actions',
                icon: <PiGavel />,
                label,
                detail: action.reason,
                preview: { kind: 'other', icon: <PiGavel />, title: label, detail: action.reason },
                onSelect: () => openAction(action.id, label),
            };
        });
        items = [...actionItems, ...playerItems, ...pageItems];
    }
    const selectedIndex = Math.min(activeIndex, Math.max(items.length - 1, 0));
    const selected = items[selectedIndex];

    const selectItem = (item: ResultItem) => {
        close();
        item.onSelect();
    };

    const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
        if (event.key === 'ArrowDown') {
            event.preventDefault();
            setActiveIndex((selectedIndex + 1) % Math.max(items.length, 1));
        } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            setActiveIndex((selectedIndex - 1 + items.length) % Math.max(items.length, 1));
        } else if (event.key === 'Enter' && selected) {
            event.preventDefault();
            selectItem(selected);
        }
    };

    const isSearching = !!trimmed && (trimmed !== debouncedQuery || swr.isValidating);
    const searchData = trimmed && debouncedQuery ? swr.data : undefined;
    const hasNoResults = !!trimmed && !!searchData && !items.length && !isSearching;

    return (<>
        <div className="flex h-14 shrink-0 items-center gap-3 border-b border-foreground/10 bg-foreground/[0.03] px-4">
            {isSearching
                ? <PiSpinnerGap className="size-5 shrink-0 animate-spin text-muted-foreground" />
                : <PiMagnifyingGlass className="size-5 shrink-0 text-muted-foreground" />}
            <input
                autoFocus
                className="h-full w-full bg-transparent text-base outline-none placeholder:text-muted-foreground"
                placeholder="Player Name, Identifier, Citizen ID, Action ID or Page"
                maxLength={128}
                value={query}
                onChange={(e) => {
                    setQuery(e.target.value);
                    setActiveIndex(0);
                }}
                onKeyDown={handleKeyDown}
            />
            <Kbd>{shortcutLabel}</Kbd>
        </div>
        <div className="flex min-h-[24rem] grow overflow-hidden">
            <div className="min-w-0 grow overflow-y-auto p-1.5" style={{ scrollbarWidth: 'thin' }}>
                {items.map((item, i) => (
                    <div key={item.key}>
                        {item.group !== items[i - 1]?.group && (
                            <div className={cn(
                                'flex items-center justify-between px-2.5 pb-1 pt-2.5 text-[0.6875rem] font-semibold uppercase tracking-wider text-muted-foreground',
                                i > 0 && 'mt-1 border-t border-foreground/5',
                            )}>
                                {item.group}
                                {item.group === 'Recent' && (
                                    <button type="button" className="normal-case tracking-normal hover:text-foreground" onClick={clearRecent}>
                                        Clear
                                    </button>
                                )}
                                {item.group === 'Online Now' && (
                                    <span className="normal-case tracking-normal">{playerlist.length} online</span>
                                )}
                            </div>
                        )}
                        <button
                            type="button"
                            className={cn(
                                'flex h-10 w-full items-center gap-2.5 rounded-md px-2.5 text-left outline-none',
                                i === selectedIndex && 'bg-secondary shadow-[inset_0_0_0_1px_hsl(var(--border))]',
                            )}
                            onMouseMove={() => setActiveIndex(i)}
                            onClick={() => selectItem(item)}
                        >
                            <span className="flex size-6 shrink-0 items-center justify-center rounded border bg-muted/40 text-muted-foreground [&_svg]:size-3.5">
                                {item.icon}
                            </span>
                            <span className="min-w-0 shrink truncate text-sm font-medium">{item.label}</span>
                            {item.detail && <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{item.detail}</span>}
                            <span className="ml-auto flex shrink-0 items-center gap-2">{item.aside}</span>
                        </button>
                    </div>
                ))}
                {searchData?.citizenIdNotice && (
                    <div className="px-2.5 py-2 text-xs text-warning-inline">{searchData.citizenIdNotice}</div>
                )}
                {swr.error && debouncedQuery && (
                    <div className="px-2.5 py-3 text-sm text-destructive-inline">
                        {swr.error instanceof Error ? swr.error.message : String(swr.error)}
                    </div>
                )}
                {hasNoResults && !swr.error && (
                    <div className="px-2.5 py-8 text-center text-sm text-muted-foreground">No results.</div>
                )}
            </div>
            <aside className="hidden w-[21rem] shrink-0 overflow-y-auto border-l bg-background/50 md:block">
                <QuickSearchPreview
                    target={selected?.preview ?? null}
                    onOpen={() => selected && selectItem(selected)}
                />
            </aside>
        </div>
        <div className="flex h-10 shrink-0 items-center gap-4 border-t bg-background/50 px-4 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5"><Kbd><PiArrowsDownUp /></Kbd> Move</span>
            <span className="flex items-center gap-1.5"><Kbd><PiArrowElbowDownLeft /></Kbd> Open</span>
            <span className="ml-auto flex items-center gap-1.5"><Kbd>Esc</Kbd> Close</span>
        </div>
    </>);
}

export default function QuickSearchDialog() {
    const [isOpen, setIsOpen] = useAtom(quickSearchOpenAtom);
    return (
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogContent className="ef-type top-[12%] flex max-h-[min(40rem,84vh)] max-w-[min(60rem,calc(100vw-2rem))] translate-y-0 flex-col gap-0 overflow-hidden rounded-xl border-foreground/15 bg-card p-0 font-sans shadow-[0_30px_80px_-10px_rgb(0_0_0/0.85)] data-[state=open]:slide-in-from-top-[10%] data-[state=closed]:slide-out-to-top-[10%] [&>button:last-child]:hidden">
                <DialogTitle className="sr-only">Quick Search</DialogTitle>
                <QuickSearchBody close={() => setIsOpen(false)} />
            </DialogContent>
        </Dialog>
    );
}
