import { useState } from "react";
import useSWR from "swr";
import { ChevronDownIcon, ChevronRightIcon, Loader2Icon, UserCheckIcon } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import MainPageLink from "@/components/MainPageLink";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useBackendApi } from "@/hooks/fetch";
import { tsToLocaleDateString } from "@/lib/dateTime";
import { cn } from "@/lib/utils";
import type { StaffActivityCounts, StaffActivityData, StaffActivityMember, StaffActivityResp } from "@shared/staffActivityApiTypes";


const RANGE_OPTIONS = [4, 8, 12, 26];

type SourceKey = keyof StaffActivityData['sources'];
type Column = {
    label: string;
    source?: SourceKey;
    value: (counts: StaffActivityCounts) => number;
    isMinutes?: boolean;
};
type View = {
    key: string;
    label: string;
    source?: SourceKey;
    columns: Column[];
    //the member's last-seen timestamp shown after the counts
    last?: { label: string; pick: (member: StaffActivityMember) => number | null };
};

const moderationCount = (c: StaffActivityCounts) => c.bans + c.warns + c.kicks + c.revokes + c.notes;
const ticketMessages = (c: StaffActivityCounts) => c.ticketReplies + c.ticketNotes + c.staffThreadMessages;
const lastAction = { label: 'Last Action', pick: (member: StaffActivityMember) => member.lastActionTs };
const lastSeen = { label: 'Last in Game', pick: (member: StaffActivityMember) => member.lastInGameTs };

const views: View[] = [
    {
        key: 'overview',
        label: 'Overview',
        columns: [
            { label: 'Moderation', value: moderationCount },
            { label: 'Ticket Messages', source: 'tickets', value: ticketMessages },
            { label: 'Tickets Closed', source: 'tickets', value: (c) => c.ticketsClosed },
            { label: 'Discord Messages', source: 'discord', value: (c) => c.discordMessages },
            { label: 'Voice', source: 'discord', value: (c) => c.voiceMinutes, isMinutes: true },
            { label: 'In Game', value: (c) => c.minutesOnline, isMinutes: true },
        ],
        last: lastAction,
    },
    {
        key: 'moderation',
        label: 'Moderation',
        columns: [
            { label: 'Bans', value: (c) => c.bans },
            { label: 'Warns', value: (c) => c.warns },
            { label: 'Kicks', value: (c) => c.kicks },
            { label: 'Revokes', value: (c) => c.revokes },
            { label: 'Notes', value: (c) => c.notes },
        ],
        last: lastAction,
    },
    {
        key: 'tickets',
        label: 'Tickets',
        source: 'tickets',
        columns: [
            { label: 'Replies', value: (c) => c.ticketReplies },
            { label: 'Internal Notes', value: (c) => c.ticketNotes },
            { label: 'Staff Thread', value: (c) => c.staffThreadMessages },
            { label: 'Closed', value: (c) => c.ticketsClosed },
        ],
    },
    {
        key: 'discord',
        label: 'Discord',
        source: 'discord',
        columns: [
            { label: 'Messages', value: (c) => c.discordMessages },
            { label: 'Voice', value: (c) => c.voiceMinutes, isMinutes: true },
        ],
    },
    {
        key: 'game',
        label: 'In Game',
        columns: [
            { label: 'Time in Game', value: (c) => c.minutesOnline, isMinutes: true },
        ],
        last: lastSeen,
    },
];
const sourceLabels = { tickets: 'Ticket Activity', discord: 'Discord Activity' } as const;

//everything a staff member did, minutes aside
const activityScore = (counts: StaffActivityCounts) => moderationCount(counts) + ticketMessages(counts)
    + counts.ticketsClosed + counts.discordMessages;
const minutesTotal = (counts: StaffActivityCounts) => counts.minutesOnline + counts.voiceMinutes;

function formatMinutes(minutes: number) {
    if (!minutes) return '0m';
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return hours ? `${hours}h ${rest}m` : `${rest}m`;
}

//week starts are UTC midnights
const formatWeek = (ts: number) => new Date(ts).toLocaleDateString(window.txBrowserLocale, {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
});

const formatLast = (ts: number | null) => ts ? tsToLocaleDateString(ts, 'medium') : 'Never';

function bySummary(a: StaffActivityMember, b: StaffActivityMember) {
    return activityScore(b.total) - activityScore(a.total)
        || minutesTotal(b.total) - minutesTotal(a.total)
        || a.name.localeCompare(b.name);
}


//MARK: Rows
type CountCellsProps = {
    view: View;
    counts: StaffActivityCounts;
    member?: StaffActivityMember;
};
function CountCells({ view, counts, member }: CountCellsProps) {
    return (<>
        {view.columns.map((col) => {
            const value = col.value(counts);
            return (
                <TableCell key={col.label} className={cn('text-right tabular-nums whitespace-nowrap', !value && 'text-muted-foreground/60')}>
                    {col.isMinutes ? formatMinutes(value) : value}
                </TableCell>
            );
        })}
        {view.last && (
            <TableCell className="text-right tabular-nums whitespace-nowrap">
                {member ? formatLast(view.last.pick(member)) : null}
            </TableCell>
        )}
    </>);
}

type MemberRowsProps = {
    member: StaffActivityMember;
    view: View;
    weekStarts: number[];
    isOpen: boolean;
    onToggle: () => void;
};
function MemberRows({ member, view, weekStarts, isOpen, onToggle }: MemberRowsProps) {
    const isIdle = !activityScore(member.total) && !minutesTotal(member.total);
    return (<>
        <TableRow className={cn('cursor-pointer', isIdle && 'text-muted-foreground')} onClick={onToggle}>
            <TableCell className="font-semibold whitespace-nowrap">
                <span className="inline-flex items-center gap-1.5">
                    {isOpen
                        ? <ChevronDownIcon className="size-4 opacity-60" />
                        : <ChevronRightIcon className="size-4 opacity-60" />}
                    {member.name}
                </span>
            </TableCell>
            <CountCells view={view} counts={member.total} member={member} />
        </TableRow>
        {isOpen && [...member.weeks].reverse().map((week, i) => (
            <TableRow key={i} className="bg-muted/30 hover:bg-muted/40 text-sm">
                <TableCell className="py-2 pl-10 text-muted-foreground whitespace-nowrap">
                    Week of {formatWeek(weekStarts[weekStarts.length - 1 - i])}
                </TableCell>
                <CountCells view={view} counts={week} />
            </TableRow>
        ))}
    </>);
}


//MARK: Page
export default function StaffActivityPage() {
    const [weeks, setWeeks] = useState(8);
    const [openNames, setOpenNames] = useState<string[]>([]);
    const [viewKey, setViewKey] = useState('overview');
    const activityApi = useBackendApi<StaffActivityResp>({
        method: 'GET',
        path: '/staffActivity',
    });
    const swr = useSWR(`/staffActivity?weeks=${weeks}`, async () => {
        const resp = await activityApi({ queryParams: { weeks } });
        if (!resp) throw new Error('No data returned.');
        if ('error' in resp) throw new Error(resp.error);
        return resp;
    }, {
        revalidateOnFocus: false,
        keepPreviousData: true,
    });

    const toggleOpen = (name: string) => {
        setOpenNames((prev) => prev.includes(name) ? prev.filter((item) => item !== name) : [...prev, name]);
    };

    const data = swr.data;
    const staff = data ? [...data.staff].sort(bySummary) : [];
    const weekStarts = data?.weekStarts ?? [];
    const isShown = (source?: SourceKey) => !source || data?.sources[source].state !== 'off';
    const shownViews = views
        .filter((item) => isShown(item.source))
        .map((item) => ({ ...item, columns: item.columns.filter((col) => isShown(col.source)) }));
    const view = shownViews.find((item) => item.key === viewKey) ?? shownViews[0];
    const sourceErrors = data
        ? (['tickets', 'discord'] as const).flatMap((source) => {
            const status = data.sources[source];
            return status.state === 'error' ? [{ source, message: status.message }] : [];
        })
        : [];
    const isSourceOff = data
        ? data.sources.tickets.state === 'off' || data.sources.discord.state === 'off'
        : false;

    return (
        <div className="flex flex-col h-full w-full gap-4 max-w-screen-xl mx-auto">
            <PageHeader title="Staff Activity" icon={<UserCheckIcon />}>
                <Select value={String(weeks)} onValueChange={(value) => setWeeks(Number(value))}>
                    <SelectTrigger className="w-36 h-8">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        {RANGE_OPTIONS.map((option) => (
                            <SelectItem key={option} value={String(option)} className="cursor-pointer">
                                Last {option} Weeks
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </PageHeader>

            {sourceErrors.map(({ source, message }) => (
                <Alert key={source} variant="destructive" className="mx-2 w-auto">
                    <AlertTitle>{sourceLabels[source]} Unavailable</AlertTitle>
                    <AlertDescription>{message}</AlertDescription>
                </Alert>
            ))}

            {swr.error ? (
                <Alert variant="destructive" className="mx-2 w-auto">
                    <AlertTitle>Failed to Load Staff Activity</AlertTitle>
                    <AlertDescription>{swr.error instanceof Error ? swr.error.message : String(swr.error)}</AlertDescription>
                </Alert>
            ) : !data ? (
                <div className="flex items-center justify-center py-16 text-muted-foreground">
                    <Loader2Icon className="animate-spin size-6 mr-2" /> Loading...
                </div>
            ) : (
                <div className="flex flex-col gap-3 mx-2">
                    <Tabs value={view.key} onValueChange={setViewKey}>
                        <TabsList>
                            {shownViews.map((item) => (
                                <TabsTrigger key={item.key} value={item.key}>{item.label}</TabsTrigger>
                            ))}
                        </TabsList>
                    </Tabs>
                    <div className="border rounded-lg overflow-x-auto bg-card">
                        <Table>
                            <TableHeader>
                                <TableRow className="hover:bg-transparent">
                                    <TableHead>Admin</TableHead>
                                    {view.columns.map((col) => (
                                        <TableHead key={col.label} className="text-right whitespace-nowrap">{col.label}</TableHead>
                                    ))}
                                    {view.last && (
                                        <TableHead className="text-right whitespace-nowrap">{view.last.label}</TableHead>
                                    )}
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {staff.map((member) => (
                                    <MemberRows
                                        key={member.name}
                                        member={member}
                                        view={view}
                                        weekStarts={weekStarts}
                                        isOpen={openNames.includes(member.name)}
                                        onToggle={() => toggleOpen(member.name)}
                                    />
                                ))}
                            </TableBody>
                        </Table>
                    </div>
                </div>
            )}

            {isSourceOff && (
                <p className="mx-2 text-sm text-muted-foreground">
                    Connect tickets and Discord in{' '}
                    <MainPageLink href="/settings#staff-activity" className="text-accent hover:underline">
                        Settings
                    </MainPageLink>.
                </p>
            )}
        </div>
    );
}
