import { useState, type KeyboardEvent } from "react";
import useSWR from "swr";
import { useAtom } from "jotai";
import { useDebounceValue } from "usehooks-ts";
import { navigate as setLocation } from "wouter/use-browser-location";
import { FileTextIcon, GavelIcon, Loader2Icon, SearchIcon, UserIcon } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { useBackendApi } from "@/hooks/fetch";
import { quickSearchOpenAtom } from "@/hooks/dialogs";
import { useAdminPerms } from "@/hooks/auth";
import { useOpenPlayerModal } from "@/hooks/playerModal";
import { useOpenActionModal } from "@/hooks/actionModal";
import { cn } from "@/lib/utils";
import { allRoutes } from "./MainRouter";
import type { QuickSearchResp } from "@shared/quickSearchApiTypes";


type ResultItem = {
    key: string;
    group: 'Pages' | 'Players' | 'Actions';
    icon: React.ReactNode;
    label: string;
    detail: string | null;
    onSelect: () => void;
};

const actionTypeLabels = { ban: 'Ban', warn: 'Warn', kick: 'Kick', sanction: 'Sanction' } as const;


/**
 * Ctrl+K search for players (name, identifier, citizen ID), actions by id and panel pages.
 */
export default function QuickSearchDialog() {
    const [isOpen, setIsOpen] = useAtom(quickSearchOpenAtom);
    const [query, setQuery] = useState('');
    const [activeIndex, setActiveIndex] = useState(0);
    const [debouncedQuery] = useDebounceValue(query.trim(), 250);
    const { hasPerm } = useAdminPerms();
    const openPlayerModal = useOpenPlayerModal();
    const openActionModal = useOpenActionModal();
    const searchApi = useBackendApi<QuickSearchResp>({
        method: 'GET',
        path: '/quickSearch',
    });
    const swr = useSWR(isOpen && debouncedQuery ? ['/quickSearch', debouncedQuery] : null, async () => {
        const resp = await searchApi({ queryParams: { q: debouncedQuery } });
        if (!resp) throw new Error('No data returned.');
        if ('error' in resp) throw new Error(resp.error);
        return resp;
    }, {
        revalidateOnFocus: false,
        keepPreviousData: true,
    });

    const close = () => {
        setIsOpen(false);
        setQuery('');
        setActiveIndex(0);
    };

    const lowerQuery = query.trim().toLowerCase();
    const pageItems: ResultItem[] = lowerQuery ? allRoutes
        .filter((route) => route.title.toLowerCase().includes(lowerQuery))
        .filter((route) => !route.permission || hasPerm(route.permission))
        .slice(0, 5)
        .map((route) => ({
            key: `page:${route.path}`,
            group: 'Pages',
            icon: <FileTextIcon className="size-4" />,
            label: route.title,
            detail: null,
            onSelect: () => setLocation(route.path),
        })) : [];
    //results of an older query stay until the new ones arrive, but never under an empty box
    const data = debouncedQuery && query.trim() ? swr.data : undefined;
    const playerItems: ResultItem[] = (data?.players ?? []).map((player) => ({
        key: `player:${player.license}`,
        group: 'Players',
        icon: <UserIcon className={cn('size-4', player.isOnline && 'text-success-inline')} />,
        label: player.displayName,
        detail: player.matched,
        onSelect: () => openPlayerModal({ license: player.license }),
    }));
    const actionItems: ResultItem[] = (data?.actions ?? []).map((action) => ({
        key: `action:${action.id}`,
        group: 'Actions',
        icon: <GavelIcon className="size-4" />,
        label: `${action.id} · ${actionTypeLabels[action.type]}${action.playerName ? ` · ${action.playerName}` : ''}`,
        detail: action.reason,
        onSelect: () => openActionModal(action.id),
    }));
    const items = [...actionItems, ...playerItems, ...pageItems];
    const selectedIndex = Math.min(activeIndex, Math.max(items.length - 1, 0));

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
        } else if (event.key === 'Enter' && items[selectedIndex]) {
            event.preventDefault();
            selectItem(items[selectedIndex]);
        }
    };

    const isSearching = !!query.trim() && (query.trim() !== debouncedQuery || swr.isValidating);
    const hasNoResults = !!debouncedQuery && !!data && !items.length && !isSearching;

    return (
        <Dialog open={isOpen} onOpenChange={(open) => open ? setIsOpen(true) : close()}>
            <DialogContent className="top-[15%] translate-y-0 data-[state=open]:slide-in-from-top-[10%] data-[state=closed]:slide-out-to-top-[10%] max-w-xl gap-0 p-0 overflow-hidden">
                <DialogTitle className="sr-only">Quick Search</DialogTitle>
                <div className="flex items-center gap-3 px-4 border-b">
                    {isSearching
                        ? <Loader2Icon className="size-5 shrink-0 animate-spin text-muted-foreground" />
                        : <SearchIcon className="size-5 shrink-0 text-muted-foreground" />}
                    <input
                        autoFocus
                        className="h-14 w-full bg-transparent text-base outline-none placeholder:text-muted-foreground pr-8"
                        placeholder="Player Name, Identifier, Citizen ID, Action ID or Page"
                        maxLength={128}
                        value={query}
                        onChange={(e) => {
                            setQuery(e.target.value);
                            setActiveIndex(0);
                        }}
                        onKeyDown={handleKeyDown}
                    />
                </div>
                <div className="max-h-[60vh] overflow-y-auto py-1" style={{ scrollbarWidth: 'thin' }}>
                    {items.map((item, i) => (
                        <div key={item.key}>
                            {item.group !== items[i - 1]?.group && (
                                <div className="px-4 pt-2 pb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                    {item.group}
                                </div>
                            )}
                            <button
                                type="button"
                                className={cn(
                                    'w-full flex items-center gap-3 px-4 py-2 text-left',
                                    i === selectedIndex && 'bg-secondary',
                                )}
                                onMouseMove={() => setActiveIndex(i)}
                                onClick={() => selectItem(item)}
                            >
                                <span className="shrink-0 text-muted-foreground">{item.icon}</span>
                                <span className="min-w-0 flex-1">
                                    <span className="block truncate">{item.label}</span>
                                    {item.detail && (
                                        <span className="block truncate text-xs text-muted-foreground">{item.detail}</span>
                                    )}
                                </span>
                            </button>
                        </div>
                    ))}
                    {data?.citizenIdNotice && (
                        <div className="px-4 py-2 text-xs text-warning-inline">{data.citizenIdNotice}</div>
                    )}
                    {swr.error && debouncedQuery && (
                        <div className="px-4 py-3 text-sm text-destructive-inline">
                            {swr.error instanceof Error ? swr.error.message : String(swr.error)}
                        </div>
                    )}
                    {hasNoResults && !swr.error && (
                        <div className="px-4 py-6 text-center text-sm text-muted-foreground">No results.</div>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
}
