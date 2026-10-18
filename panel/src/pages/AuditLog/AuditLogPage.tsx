import { useState, type FormEvent } from "react";
import useSWR from "swr";
import {
    ChevronLeftIcon,
    ChevronRightIcon,
    FilterIcon,
    Loader2Icon,
    SearchIcon,
    ShieldCheckIcon,
    XIcon,
} from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ApiTimeout, useBackendApi } from "@/hooks/fetch";
import { useOpenActionModal } from "@/hooks/actionModal";
import { tsToLocaleDateTimeString } from "@/lib/dateTime";
import { ADMIN_LOG_CATEGORIES, type AdminLogCategory, type AdminLogEntry, type AdminLogSearchResp } from "@shared/adminLogApiTypes";


const categoryLabels = new Map<string, string>(ADMIN_LOG_CATEGORIES.map((c) => [c.key, c.label]));
const actionIdRegex = /\b([BWKS][1-9A-HJ-NP-Z]{3}-[1-9A-HJ-NP-Z]{4})\b/;

type SearchFields = {
    text: string;
    admin: string;
    from: string;
    to: string;
};
const emptyFields: SearchFields = { text: '', admin: '', from: '', to: '' };

//datetime-local values are in the browser's time zone
const fieldTimeToTs = (value: string) => value ? new Date(value).getTime() : undefined;


//MARK: Entry
type EntryMessageProps = {
    msg: string;
    onActionClick: (actionId: string) => void;
};

//Action ids in the message open the action window
function EntryMessage({ msg, onActionClick }: EntryMessageProps) {
    const parts = msg.split(actionIdRegex);
    return (
        <span className="whitespace-pre-wrap break-words">
            {parts.map((part, i) => i % 2 ? (
                <button
                    key={i}
                    type="button"
                    className="font-mono text-accent hover:underline"
                    onClick={() => onActionClick(part)}
                >
                    {part}
                </button>
            ) : part)}
        </span>
    );
}

function EntryRow({ entry, onActionClick }: { entry: AdminLogEntry; onActionClick: (actionId: string) => void }) {
    return (
        <div className="grid grid-cols-[11.5rem_minmax(0,9rem)_6.5rem_minmax(0,1fr)] max-md:grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-0.5 px-3 py-2 border-b last:border-b-0 text-sm hover:bg-muted/40">
            <span className="text-muted-foreground tabular-nums whitespace-nowrap">
                {tsToLocaleDateTimeString(entry.ts, 'short', 'medium')}
            </span>
            <span className="font-semibold truncate" title={entry.author}>{entry.author}</span>
            <span className="text-muted-foreground">
                {categoryLabels.get(entry.category) ?? entry.category}
            </span>
            <span className="max-md:col-span-2">
                <EntryMessage msg={entry.msg} onActionClick={onActionClick} />
            </span>
        </div>
    );
}


//MARK: Page
export default function AuditLogPage() {
    const openActionModal = useOpenActionModal();
    const [fields, setFields] = useState<SearchFields>(emptyFields);
    const [applied, setApplied] = useState<SearchFields>(emptyFields);
    const [categories, setCategories] = useState<AdminLogCategory[]>([]);
    //the `to` of every page loaded so far, the last one is the current page
    const [pageTos, setPageTos] = useState<(number | undefined)[]>([undefined]);
    const searchApi = useBackendApi<AdminLogSearchResp>({
        method: 'GET',
        path: '/adminLog/search',
    });

    const pageTo = pageTos.at(-1) ?? fieldTimeToTs(applied.to);
    const queryParams = {
        text: applied.text.trim() || undefined,
        admin: applied.admin.trim() || undefined,
        categories: categories.length ? categories.join(',') : undefined,
        from: fieldTimeToTs(applied.from),
        to: pageTo,
    };
    const swr = useSWR(['/adminLog/search', JSON.stringify(queryParams)], async () => {
        const resp = await searchApi({ queryParams, timeout: ApiTimeout.REALLY_LONG });
        if (!resp) throw new Error('No data returned.');
        if ('error' in resp) throw new Error(resp.error);
        return resp;
    }, {
        revalidateOnFocus: false,
        keepPreviousData: true,
    });

    const newestFirst = swr.data ? [...swr.data.log].reverse() : [];
    const isFiltered = Object.values(applied).some((value) => value.trim() !== '') || categories.length > 0;

    const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        setApplied(fields);
        setPageTos([undefined]);
    };

    const clearSearch = () => {
        setFields(emptyFields);
        setApplied(emptyFields);
        setCategories([]);
        setPageTos([undefined]);
    };

    const toggleCategory = (key: AdminLogCategory, checked: boolean) => {
        setCategories((prev) => checked ? [...prev, key] : prev.filter((item) => item !== key));
        setPageTos([undefined]);
    };

    const loadOlder = () => {
        const cursor = swr.data?.cursor;
        if (cursor == null) return;
        setPageTos((prev) => [...prev, cursor]);
    };

    return (
        <div className="flex flex-col h-full w-full">
            <PageHeader title="Audit Log" icon={<ShieldCheckIcon />} />

            <div className="flex flex-col grow min-h-0 gap-3 px-2 md:px-0">
                <form className="flex flex-wrap items-center gap-2" onSubmit={handleSubmit}>
                    <Input
                        className="h-9 grow basis-48 max-w-sm"
                        placeholder="Search Messages"
                        maxLength={128}
                        value={fields.text}
                        onChange={(e) => setFields((prev) => ({ ...prev, text: e.target.value }))}
                    />
                    <Input
                        className="h-9 grow basis-40 max-w-56"
                        placeholder="Admin Name"
                        maxLength={128}
                        value={fields.admin}
                        onChange={(e) => setFields((prev) => ({ ...prev, admin: e.target.value }))}
                    />
                    <div className="flex items-center gap-2">
                        <Label htmlFor="auditlog-from" className="text-muted-foreground">From</Label>
                        <Input
                            id="auditlog-from"
                            type="datetime-local"
                            className="h-9 w-auto"
                            value={fields.from}
                            onChange={(e) => setFields((prev) => ({ ...prev, from: e.target.value }))}
                        />
                    </div>
                    <div className="flex items-center gap-2">
                        <Label htmlFor="auditlog-to" className="text-muted-foreground">To</Label>
                        <Input
                            id="auditlog-to"
                            type="datetime-local"
                            className="h-9 w-auto"
                            value={fields.to}
                            onChange={(e) => setFields((prev) => ({ ...prev, to: e.target.value }))}
                        />
                    </div>
                    <Popover>
                        <PopoverTrigger asChild>
                            <Button type="button" size="sm" variant="outline-muted">
                                <FilterIcon className="size-4 mr-1.5" />
                                Categories
                                {categories.length > 0 && (
                                    <span className="ml-1.5 text-muted-foreground tabular-nums">{categories.length}</span>
                                )}
                            </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-64 max-h-[70vh] overflow-y-auto" align="start">
                            <div className="grid gap-3">
                                {ADMIN_LOG_CATEGORIES.map((category) => (
                                    <div key={category.key} className="flex items-center justify-between gap-4">
                                        <Label htmlFor={`auditlog-category-${category.key}`}>{category.label}</Label>
                                        <Switch
                                            id={`auditlog-category-${category.key}`}
                                            checked={categories.includes(category.key)}
                                            onCheckedChange={(checked) => toggleCategory(category.key, checked)}
                                        />
                                    </div>
                                ))}
                            </div>
                        </PopoverContent>
                    </Popover>
                    <Button type="submit" size="sm">
                        <SearchIcon className="size-4 mr-1.5" /> Search
                    </Button>
                    {isFiltered && (
                        <Button type="button" size="sm" variant="outline-muted" onClick={clearSearch}>
                            <XIcon className="size-4 mr-1.5" /> Clear
                        </Button>
                    )}
                    <div className="flex items-center gap-2 ml-auto">
                        <Button
                            type="button"
                            size="sm"
                            variant="outline-muted"
                            disabled={pageTos.length < 2 || swr.isLoading}
                            onClick={() => setPageTos((prev) => prev.slice(0, -1))}
                        >
                            <ChevronLeftIcon className="size-4 mr-1" /> Newer
                        </Button>
                        <Button
                            type="button"
                            size="sm"
                            variant="outline-muted"
                            disabled={swr.data?.cursor == null || swr.isLoading}
                            onClick={loadOlder}
                        >
                            Older <ChevronRightIcon className="size-4 ml-1" />
                        </Button>
                    </div>
                </form>

                {swr.error ? (
                    <Alert variant="destructive">
                        <AlertTitle>Failed to Load the Audit Log</AlertTitle>
                        <AlertDescription>{swr.error instanceof Error ? swr.error.message : String(swr.error)}</AlertDescription>
                    </Alert>
                ) : (
                    <div className="relative grow min-h-80 mb-2 bg-card border rounded-lg overflow-hidden">
                        {(swr.isLoading || swr.isValidating) && (
                            <div className="absolute inset-0 z-10 flex items-center justify-center bg-card/60 text-muted-foreground">
                                <Loader2Icon className="animate-spin size-6 mr-2" /> Loading...
                            </div>
                        )}
                        <div className="absolute inset-0 overflow-y-auto" style={{ scrollbarWidth: 'thin' }}>
                            {swr.data && !newestFirst.length && (
                                <div className="px-3 py-8 text-center text-muted-foreground">
                                    {isFiltered ? 'No matching entries.' : 'No entries yet.'}
                                </div>
                            )}
                            {newestFirst.map((entry, i) => (
                                <EntryRow key={`${entry.ts}-${i}`} entry={entry} onActionClick={openActionModal} />
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
