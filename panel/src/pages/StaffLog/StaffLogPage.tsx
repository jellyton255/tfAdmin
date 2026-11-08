import { useState, type FormEvent } from "react";
import { ChevronLeftIcon, ChevronRightIcon, ClipboardListIcon, Loader2Icon, SearchIcon, XIcon } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useEverfallQuery } from "@/hooks/everfall";
import { tsToLocaleDateTimeString } from "@/lib/dateTime";
import { cn } from "@/lib/utils";
import type { EverfallStaffLog, EverfallStaffLogEntry } from "@shared/everfallApiTypes";


const rankLabels = new Map([
    ['everfall.staff', 'Staff'],
    ['everfall.admin', 'Management'],
]);
const originLabels: Record<EverfallStaffLogEntry['origin'], string> = {
    game: 'In Game',
    tfadmin: 'tfAdmin',
    website: 'Website',
};
const smallWords = new Set(['a', 'an', 'and', 'as', 'at', 'by', 'for', 'in', 'of', 'on', 'or', 'to']);

//`give_item` reads as Give Item
const formatAction = (action: string) => action
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((word, i) => i > 0 && smallWords.has(word) ? word : word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');


//MARK: Entry
function EntryRow({ entry }: { entry: EverfallStaffLogEntry }) {
    const management = entry.rank !== 'everfall.staff';
    return (
        <div className="grid grid-cols-[11.5rem_minmax(0,13rem)_8rem_minmax(0,1fr)_5rem] max-lg:grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-0.5 px-3 py-2 border-b last:border-b-0 text-sm hover:bg-muted/40">
            <span className="text-muted-foreground tabular-nums whitespace-nowrap">
                {tsToLocaleDateTimeString(entry.at * 1000, 'short', 'short')}
            </span>
            <span className="flex items-baseline gap-2 min-w-0">
                <span className="font-semibold truncate" title={entry.actor}>{entry.actor}</span>
                <span className={cn(
                    "shrink-0 rounded-sm border px-1.5 text-xs",
                    management ? "border-accent/40 bg-accent/10 text-accent" : "bg-muted text-muted-foreground",
                )}>
                    {rankLabels.get(entry.rank) ?? entry.rank}
                </span>
            </span>
            <span>{formatAction(entry.action)}</span>
            <span className="max-lg:col-span-2 text-muted-foreground whitespace-pre-wrap break-words">{entry.message}</span>
            <span className="max-lg:hidden text-muted-foreground">{originLabels[entry.origin]}</span>
        </div>
    );
}


//MARK: Page
export default function StaffLogPage() {
    const [search, setSearch] = useState('');
    const [applied, setApplied] = useState('');
    //the cursor of every page loaded so far, the last one is the current page
    const [cursors, setCursors] = useState<(number | undefined)[]>([undefined]);
    const before = cursors.at(-1);
    const query = useEverfallQuery<EverfallStaffLog>('staffLog.list', {
        search: applied || undefined,
        before,
    });

    const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        setApplied(search.trim());
        setCursors([undefined]);
    };

    const clearSearch = () => {
        setSearch('');
        setApplied('');
        setCursors([undefined]);
    };

    const loadOlder = () => {
        const cursor = query.data?.before;
        if (!cursor) return;
        setCursors((prev) => [...prev, cursor]);
    };

    return (
        <div className="flex flex-col h-full w-full">
            <PageHeader title="Staff Log" icon={<ClipboardListIcon />} />

            <div className="flex flex-col grow min-h-0 gap-3 px-2 md:px-0">
                <form className="flex flex-wrap items-center gap-2 p-3 rounded-lg border bg-card" onSubmit={handleSubmit}>
                    <Input
                        className="h-9 w-full sm:w-80"
                        placeholder="Staff, Player, or Action"
                        maxLength={64}
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                    />
                    <Button type="submit" size="sm">
                        <SearchIcon className="size-4 mr-1.5" /> Search
                    </Button>
                    {applied && (
                        <Button type="button" size="sm" variant="outline-muted" onClick={clearSearch}>
                            <XIcon className="size-4 mr-1.5" /> Clear
                        </Button>
                    )}
                    <div className="flex flex-wrap items-center gap-2 ml-auto">
                        <Button
                            type="button"
                            size="sm"
                            variant="outline-muted"
                            disabled={cursors.length < 2 || query.isLoading}
                            onClick={() => setCursors((prev) => prev.slice(0, -1))}
                        >
                            <ChevronLeftIcon className="size-4 mr-1" /> Newer
                        </Button>
                        <Button
                            type="button"
                            size="sm"
                            variant="outline-muted"
                            disabled={!query.data?.before || query.isLoading}
                            onClick={loadOlder}
                        >
                            Older <ChevronRightIcon className="size-4 ml-1" />
                        </Button>
                    </div>
                </form>

                {query.error ? (
                    <Alert variant="destructive">
                        <AlertTitle>Failed to Load the Staff Log</AlertTitle>
                        <AlertDescription>{query.error instanceof Error ? query.error.message : String(query.error)}</AlertDescription>
                    </Alert>
                ) : (
                    <div className="relative grow min-h-80 mb-2 bg-card border rounded-lg overflow-hidden">
                        {query.isLoading && (
                            <div className="absolute inset-0 z-10 flex items-center justify-center bg-card/60 text-muted-foreground">
                                <Loader2Icon className="animate-spin size-6 mr-2" /> Loading...
                            </div>
                        )}
                        <div className="absolute inset-0 overflow-y-auto" style={{ scrollbarWidth: 'thin' }}>
                            {query.data && !query.data.entries.length && (
                                <div className="px-3 py-8 text-center text-muted-foreground">
                                    {applied ? 'No matching staff actions.' : 'No staff actions yet.'}
                                </div>
                            )}
                            {query.data?.entries.map((entry) => <EntryRow key={entry.id} entry={entry} />)}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
