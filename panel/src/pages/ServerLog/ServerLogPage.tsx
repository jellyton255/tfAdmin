import { useRef, useState, type FormEvent } from "react";
import useSWRSubscription from "swr/subscription";
import { useAtom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import {
    ChevronLeftIcon,
    ChevronRightIcon,
    ChevronsDownIcon,
    EraserIcon,
    FilterIcon,
    Loader2Icon,
    ScrollTextIcon,
    SearchIcon,
    XIcon,
} from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { txToast } from "@/components/TxToaster";
import { ApiTimeout, useBackendApi } from "@/hooks/fetch";
import { useOpenPlayerModal } from "@/hooks/playerModal";
import { createValidatedStorage, LocalStorageKey } from "@/lib/localStorage";
import { tsToLocaleTimeString } from "@/lib/dateTime";
import { cn, getSocket } from "@/lib/utils";
import type { ServerLogEventType, ServerLogPartialResp, ServerLogSearchResp } from "@shared/serverLogApiTypes";


const MAX_ENTRIES = 500;


//MARK: Event filters
const eventFilters = [
    { key: 'PlayerJoin', label: 'Player Joins', types: ['playerJoining', 'playerJoinDenied'] },
    { key: 'playerDropped', label: 'Player Leaves', types: ['playerDropped'] },
    { key: 'ChatMessage', label: 'Chat Messages', types: ['ChatMessage'] },
    { key: 'DeathNotice', label: 'Player Deaths', types: ['DeathNotice'] },
    { key: 'MenuEvent', label: 'Menu Actions', types: ['MenuEvent'] },
    { key: 'explosionEvent', label: 'Explosions', types: ['explosionEvent'] },
    { key: 'CommandExecuted', label: 'Commands', types: ['CommandExecuted'] },
    { key: 'System', label: 'System Events', types: ['LoggerStarted', 'DebugMessage'] },
];

//Stores the keys of the disabled filters, so new filters default to enabled
const validateStringList = (value: unknown) => {
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is string => typeof item === 'string');
};
const hiddenFiltersAtom = atomWithStorage<string[]>(
    LocalStorageKey.ServerLogFilters,
    [],
    createValidatedStorage(validateStringList, []),
);


//MARK: History state
type HistoryState = {
    events: ServerLogEventType[];
    isLoading: boolean;
    olderExhausted: boolean;
};


//MARK: Search state
type SearchDraft = {
    text: string;
    player: string;
    from: string;
    to: string;
};
const emptySearchDraft: SearchDraft = { text: '', player: '', from: '', to: '' };

type SearchState = {
    draft: SearchDraft;
    types: string | undefined;
    //the `to` of every page loaded so far, the last one is the current page
    pageTos: (number | undefined)[];
    events: ServerLogEventType[];
    isLoading: boolean;
    //`to` of the next older page, when there is one
    cursor: number | null;
};

//datetime-local values are in the browser's time zone
const draftTimeToTs = (value: string) => value ? new Date(value).getTime() : undefined;


//MARK: LogLine
type LogLineProps = {
    event: ServerLogEventType;
    onPlayerClick: (playerId: string) => void;
};

function LogLine({ event, onPlayerClick }: LogLineProps) {
    const playerId = event.src.id;
    const netid = playerId ? playerId.split('#')[1] : null;
    return (
        <div className="px-3 py-0.5 hover:bg-muted/40 break-words">
            <span className="text-muted-foreground tabular-nums">
                [{tsToLocaleTimeString(event.ts, '2-digit', '2-digit', '2-digit')}]
            </span>{' '}
            {playerId ? (
                <button
                    type="button"
                    className="font-semibold text-accent hover:underline"
                    onClick={() => onPlayerClick(playerId)}
                >
                    [{netid}] {event.src.name}
                </button>
            ) : (
                <span className="font-semibold">{event.src.name}</span>
            )}{' '}
            <span>{event.msg}</span>
        </div>
    );
}


//MARK: Page
export default function ServerLogPage() {
    const openPlayerModal = useOpenPlayerModal();
    const scrollRef = useRef<HTMLDivElement>(null);
    const [mode, setMode] = useState<'live' | 'history' | 'search'>('live');
    const [history, setHistory] = useState<HistoryState>({
        events: [],
        isLoading: false,
        olderExhausted: false,
    });
    const [search, setSearch] = useState<SearchState | null>(null);
    const [searchDraft, setSearchDraft] = useState<SearchDraft>(emptySearchDraft);
    const [clearedAt, setClearedAt] = useState(0);
    const [playerSearch, setPlayerSearch] = useState('');
    const [hiddenFilters, setHiddenFilters] = useAtom(hiddenFiltersAtom);
    const [isScrolledUp, setIsScrolledUp] = useState(false);
    const partialApi = useBackendApi<ServerLogPartialResp>({
        method: 'GET',
        path: '/serverLog/partial',
    });
    const searchApi = useBackendApi<ServerLogSearchResp>({
        method: 'GET',
        path: '/serverLog/search',
    });

    //Live mode: subscribe to the serverlog room while in live mode
    const live = useSWRSubscription<ServerLogEventType[], Error, string | null>(
        mode === 'live' ? 'serverlog' : null,
        (_key, { next }) => {
            let buffer: ServerLogEventType[] = [];
            const socket = getSocket(['serverlog']);
            socket.on('connect', () => {
                //the room re-sends the recent buffer on every (re)connection
                buffer = [];
            });
            socket.on('logData', (events) => {
                buffer = buffer.concat(events).slice(-MAX_ENTRIES);
                next(null, buffer);
            });
            socket.on('error', (error) => {
                console.log('ServerLog Socket.IO', error);
            });
            return () => {
                socket.removeAllListeners();
                socket.disconnect();
            };
        },
    );

    const sourceEvents = mode === 'live'
        ? (live.data ?? [])
        : mode === 'search' ? (search?.events ?? []) : history.events;
    const enabledFilters = eventFilters.filter((filter) => !hiddenFilters.includes(filter.key));
    const shownTypes = new Set(enabledFilters.flatMap((filter) => filter.types));
    const searchLower = playerSearch.trim().toLowerCase();
    const visibleEvents = sourceEvents.filter((event) => {
        if (event.ts <= clearedAt) return false;
        if (!shownTypes.has(event.type)) return false;
        if (!searchLower) return true;
        return event.src.name.toLowerCase().includes(searchLower)
            || (event.src.id && event.src.id.split('#')[1] === searchLower);
    });
    const firstTs = sourceEvents.at(0)?.ts;
    const lastTs = sourceEvents.at(-1)?.ts;
    const isLoading = mode === 'live'
        ? !live.data
        : mode === 'search' ? (search?.isLoading ?? false) : history.isLoading;
    const enabledFiltersCount = enabledFilters.length;
    const hasSearchDraft = Object.values(searchDraft).some((value) => value.trim() !== '');
    //narrowed event types also apply to the server search
    const searchTypes = enabledFiltersCount === eventFilters.length
        ? undefined
        : enabledFilters.flatMap((filter) => filter.types).join(',');

    //Handlers
    const goLive = () => {
        setClearedAt(0);
        setSearch(null);
        setMode('live');
    };

    const runSearch = async (draft: SearchDraft, types: string | undefined, pageTos: (number | undefined)[]) => {
        setMode('search');
        setClearedAt(0);
        setSearch((prev) => prev
            ? { ...prev, isLoading: true }
            : { draft, types, pageTos, events: [], cursor: null, isLoading: true });
        const resp = await searchApi({
            queryParams: {
                text: draft.text.trim() || undefined,
                player: draft.player.trim() || undefined,
                types,
                from: draftTimeToTs(draft.from),
                to: pageTos.at(-1),
            },
            timeout: ApiTimeout.REALLY_LONG,
        });
        if (!resp || 'error' in resp) {
            if (resp) txToast.error({ title: 'Search Failed', msg: resp.error });
            setSearch((prev) => prev && ({ ...prev, isLoading: false }));
            return;
        }
        setSearch({
            draft,
            types,
            pageTos,
            events: resp.log,
            isLoading: false,
            cursor: resp.cursor,
        });
    };

    const handleSearchSubmit = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (!hasSearchDraft && searchTypes === undefined) return goLive();
        const fromTs = draftTimeToTs(searchDraft.from);
        const toTs = draftTimeToTs(searchDraft.to);
        if (fromTs !== undefined && toTs !== undefined && fromTs > toTs) {
            txToast.error('The start time must be before the end time.');
            return;
        }
        setSearch(null);
        runSearch(searchDraft, searchTypes, [toTs]);
    };

    const clearSearch = () => {
        setSearchDraft(emptySearchDraft);
        goLive();
    };

    const loadSearchPage = (direction: 'older' | 'newer') => {
        if (!search) return;
        if (direction === 'older') {
            if (search.cursor === null) return;
            runSearch(search.draft, search.types, [...search.pageTos, search.cursor]);
        } else {
            runSearch(search.draft, search.types, search.pageTos.slice(0, -1));
        }
    };

    const loadHistory = async (direction: 'older' | 'newer') => {
        if (mode === 'search') return loadSearchPage(direction);
        const ref = direction === 'older' ? (firstTs ?? Date.now()) : (lastTs ?? Date.now());
        setMode('history');
        setHistory((prev) => ({ ...prev, isLoading: true }));
        const resp = await partialApi({
            queryParams: { dir: direction, ref },
        });
        if (!resp || 'error' in resp) {
            if (resp) txToast.error({ title: 'Failed to Load Log', msg: resp.error });
            setHistory((prev) => ({ ...prev, isLoading: false }));
            return;
        }

        if (direction === 'newer' && resp.boundry) {
            goLive();
            return;
        }
        if (direction === 'older' && resp.boundry && !resp.log.length) {
            txToast.info('No older log entries.');
            setHistory((prev) => ({ ...prev, isLoading: false, olderExhausted: true }));
            return;
        }
        setClearedAt(0);
        setHistory({
            events: resp.log,
            isLoading: false,
            olderExhausted: direction === 'older' && resp.boundry,
        });
    };

    const handleClear = () => {
        setClearedAt(lastTs ?? Date.now());
    };

    const handlePlayerClick = (playerId: string) => {
        const [mutex, netid] = playerId.split('#', 2);
        const netidNum = parseInt(netid);
        if (!mutex || isNaN(netidNum)) return;
        openPlayerModal({ mutex, netid: netidNum });
    };

    const toggleFilter = (key: string, isVisible: boolean) => {
        setHiddenFilters((prev) => isVisible
            ? prev.filter((item) => item !== key)
            : [...prev, key]);
    };

    const scrollToBottom = () => {
        scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const formatRangeTs = (ts: number | undefined) => {
        if (!ts) return '--';
        return new Date(ts).toLocaleString(window.txBrowserLocale, {
            weekday: 'short',
            hour: 'numeric',
            minute: '2-digit',
        });
    };

    return (
        <div className="flex flex-col h-full w-full">
            <PageHeader title="Server Log" icon={<ScrollTextIcon />}>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                    <span className={cn(
                        'font-semibold',
                        mode === 'live' && 'text-success-inline',
                        mode === 'history' && 'text-warning-inline',
                        mode === 'search' && 'text-accent',
                    )}>
                        {mode === 'live' ? 'Live' : mode === 'history' ? 'History' : 'Search Results'}
                    </span>
                    <span className="text-muted-foreground tabular-nums">
                        {formatRangeTs(firstTs)} to {formatRangeTs(lastTs)}
                    </span>
                </div>
            </PageHeader>

            <div className="flex flex-col grow min-h-0 gap-3 px-2 md:px-0">
                <form className="flex flex-wrap items-center gap-2" onSubmit={handleSearchSubmit}>
                    <Input
                        className="h-9 grow basis-48 max-w-sm"
                        placeholder="Search Messages"
                        maxLength={128}
                        value={searchDraft.text}
                        onChange={(e) => setSearchDraft((prev) => ({ ...prev, text: e.target.value }))}
                    />
                    <Input
                        className="h-9 grow basis-48 max-w-sm"
                        placeholder="Player Name or Identifier"
                        maxLength={128}
                        value={searchDraft.player}
                        onChange={(e) => setSearchDraft((prev) => ({ ...prev, player: e.target.value }))}
                    />
                    <div className="flex items-center gap-2">
                        <Label htmlFor="serverlog-search-from" className="text-muted-foreground">From</Label>
                        <Input
                            id="serverlog-search-from"
                            type="datetime-local"
                            className="h-9 w-auto"
                            value={searchDraft.from}
                            onChange={(e) => setSearchDraft((prev) => ({ ...prev, from: e.target.value }))}
                        />
                    </div>
                    <div className="flex items-center gap-2">
                        <Label htmlFor="serverlog-search-to" className="text-muted-foreground">To</Label>
                        <Input
                            id="serverlog-search-to"
                            type="datetime-local"
                            className="h-9 w-auto"
                            value={searchDraft.to}
                            onChange={(e) => setSearchDraft((prev) => ({ ...prev, to: e.target.value }))}
                        />
                    </div>
                    <Button type="submit" size="sm" disabled={isLoading && mode === 'search'}>
                        <SearchIcon className="size-4 mr-1.5" /> Search Logs
                    </Button>
                    {(mode === 'search' || hasSearchDraft) && (
                        <Button type="button" size="sm" variant="outline-muted" onClick={clearSearch}>
                            <XIcon className="size-4 mr-1.5" /> Clear Search
                        </Button>
                    )}
                </form>

                <div className="flex flex-wrap items-center gap-2">
                    <div className="relative grow min-w-52 max-w-sm">
                        <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                        <Input
                            className="pl-9 h-9"
                            placeholder="Filter by Player Name or ID"
                            value={playerSearch}
                            onChange={(e) => setPlayerSearch(e.target.value)}
                        />
                    </div>
                    <Popover>
                        <PopoverTrigger asChild>
                            <Button size="sm" variant="outline-muted">
                                <FilterIcon className="size-4 mr-1.5" />
                                Event Types
                                <span className="ml-1.5 text-muted-foreground tabular-nums">
                                    {enabledFiltersCount}/{eventFilters.length}
                                </span>
                            </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-64" align="start">
                            <div className="grid gap-3">
                                {eventFilters.map((filter) => (
                                    <div key={filter.key} className="flex items-center justify-between gap-4">
                                        <Label htmlFor={`serverlog-filter-${filter.key}`}>{filter.label}</Label>
                                        <Switch
                                            id={`serverlog-filter-${filter.key}`}
                                            checked={!hiddenFilters.includes(filter.key)}
                                            onCheckedChange={(checked) => toggleFilter(filter.key, checked)}
                                        />
                                    </div>
                                ))}
                            </div>
                        </PopoverContent>
                    </Popover>
                    <div className="flex items-center gap-2 ml-auto">
                        <Button
                            size="sm"
                            variant="outline-muted"
                            disabled={isLoading
                                || (mode === 'history' && history.olderExhausted)
                                || (mode === 'search' && search?.cursor == null)}
                            onClick={() => loadHistory('older')}
                        >
                            <ChevronLeftIcon className="size-4 mr-1" /> View Older
                        </Button>
                        <Button
                            size="sm"
                            variant="outline-muted"
                            disabled={isLoading
                                || mode === 'live'
                                || (mode === 'search' && (search?.pageTos.length ?? 0) < 2)}
                            onClick={() => loadHistory('newer')}
                        >
                            View Newer <ChevronRightIcon className="size-4 ml-1" />
                        </Button>
                        {mode !== 'live' && (
                            <Button size="sm" variant="outline-success" onClick={goLive}>
                                Go Live
                            </Button>
                        )}
                        <Button size="sm" variant="outline-muted" onClick={handleClear}>
                            <EraserIcon className="size-4 mr-1.5" /> Clear Log
                        </Button>
                    </div>
                </div>

                <div className="relative grow min-h-80 mb-2 bg-card border rounded-lg overflow-hidden">
                    {isLoading ? (
                        <div className="absolute inset-0 flex items-center justify-center text-muted-foreground">
                            <Loader2Icon className="animate-spin size-6 mr-2" /> Loading...
                        </div>
                    ) : null}
                    {/* column-reverse keeps the view pinned to the newest entry while at the bottom */}
                    <div
                        ref={scrollRef}
                        className="absolute inset-0 flex flex-col-reverse overflow-y-auto py-2 font-mono text-sm"
                        style={{ scrollbarWidth: 'thin' }}
                        onScroll={(e) => setIsScrolledUp(e.currentTarget.scrollTop < -40)}
                    >
                        <div>
                            {!isLoading && !visibleEvents.length && (
                                <div className="px-3 py-8 text-center font-sans text-muted-foreground">
                                    {mode === 'search' ? 'No matching log entries.' : 'No log entries to show.'}
                                </div>
                            )}
                            {visibleEvents.map((event, i) => (
                                <LogLine
                                    key={`${event.ts}-${i}`}
                                    event={event}
                                    onPlayerClick={handlePlayerClick}
                                />
                            ))}
                        </div>
                    </div>
                    {isScrolledUp && (
                        <Button
                            size="sm"
                            variant="secondary"
                            className="absolute bottom-3 right-4"
                            onClick={scrollToBottom}
                        >
                            <ChevronsDownIcon className="size-4 mr-1" /> Jump to Latest
                        </Button>
                    )}
                </div>
            </div>
        </div>
    );
}
