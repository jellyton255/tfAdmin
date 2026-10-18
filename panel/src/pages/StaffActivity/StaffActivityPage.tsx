import { useState } from "react";
import useSWR from "swr";
import { ChevronDownIcon, ChevronRightIcon, Loader2Icon, UserCheckIcon } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useBackendApi } from "@/hooks/fetch";
import { tsToLocaleDateString } from "@/lib/dateTime";
import { cn } from "@/lib/utils";
import type { StaffActivityCounts, StaffActivityMember, StaffActivityResp } from "@shared/staffActivityApiTypes";


const RANGE_OPTIONS = [4, 8, 12, 26];
const countColumns = [
    { key: 'bans', label: 'Bans' },
    { key: 'warns', label: 'Warns' },
    { key: 'kicks', label: 'Kicks' },
    { key: 'revokes', label: 'Revokes' },
    { key: 'notes', label: 'Notes' },
] as const;

const actionCount = (counts: StaffActivityCounts) => countColumns.reduce((sum, col) => sum + counts[col.key], 0);

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
    return actionCount(b.total) - actionCount(a.total)
        || b.total.minutesOnline - a.total.minutesOnline
        || a.name.localeCompare(b.name);
}


//MARK: Rows
function CountCells({ counts }: { counts: StaffActivityCounts }) {
    return (<>
        {countColumns.map((col) => (
            <TableCell key={col.key} className={cn('text-right tabular-nums', !counts[col.key] && 'text-muted-foreground/60')}>
                {counts[col.key]}
            </TableCell>
        ))}
        <TableCell className={cn('text-right tabular-nums', !counts.minutesOnline && 'text-muted-foreground/60')}>
            {formatMinutes(counts.minutesOnline)}
        </TableCell>
    </>);
}

type MemberRowsProps = {
    member: StaffActivityMember;
    weekStarts: number[];
    isOpen: boolean;
    onToggle: () => void;
};
function MemberRows({ member, weekStarts, isOpen, onToggle }: MemberRowsProps) {
    const isIdle = !actionCount(member.total) && !member.total.minutesOnline;
    return (<>
        <TableRow className={cn('cursor-pointer', isIdle && 'text-muted-foreground')} onClick={onToggle}>
            <TableCell className={cn('font-semibold', isIdle && 'text-muted-foreground')}>
                <span className="inline-flex items-center gap-1.5">
                    {isOpen
                        ? <ChevronDownIcon className="size-4 opacity-60" />
                        : <ChevronRightIcon className="size-4 opacity-60" />}
                    {member.name}
                </span>
            </TableCell>
            <CountCells counts={member.total} />
            <TableCell className="text-right tabular-nums whitespace-nowrap">{formatLast(member.lastActionTs)}</TableCell>
            <TableCell className="text-right tabular-nums whitespace-nowrap">{formatLast(member.lastInGameTs)}</TableCell>
        </TableRow>
        {isOpen && [...member.weeks].reverse().map((week, i) => (
            <TableRow key={i} className="bg-muted/30 hover:bg-muted/40 text-sm">
                <TableCell className="pl-10 text-muted-foreground whitespace-nowrap">
                    Week of {formatWeek(weekStarts[weekStarts.length - 1 - i])}
                </TableCell>
                <CountCells counts={week} />
                <TableCell colSpan={2} />
            </TableRow>
        ))}
    </>);
}


//MARK: Page
export default function StaffActivityPage() {
    const [weeks, setWeeks] = useState(8);
    const [openNames, setOpenNames] = useState<string[]>([]);
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

    const staff = swr.data ? [...swr.data.staff].sort(bySummary) : [];
    const weekStarts = swr.data?.weekStarts ?? [];

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

            {swr.error ? (
                <Alert variant="destructive" className="mx-2 w-auto">
                    <AlertTitle>Failed to Load Staff Activity</AlertTitle>
                    <AlertDescription>{swr.error instanceof Error ? swr.error.message : String(swr.error)}</AlertDescription>
                </Alert>
            ) : !swr.data ? (
                <div className="flex items-center justify-center py-16 text-muted-foreground">
                    <Loader2Icon className="animate-spin size-6 mr-2" /> Loading...
                </div>
            ) : (
                <div className="border rounded-lg mx-2 overflow-x-auto bg-card">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Admin</TableHead>
                                {countColumns.map((col) => (
                                    <TableHead key={col.key} className="text-right">{col.label}</TableHead>
                                ))}
                                <TableHead className="text-right whitespace-nowrap">Time in Game</TableHead>
                                <TableHead className="text-right whitespace-nowrap">Last Action</TableHead>
                                <TableHead className="text-right whitespace-nowrap">Last in Game</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {staff.map((member) => (
                                <MemberRows
                                    key={member.name}
                                    member={member}
                                    weekStarts={weekStarts}
                                    isOpen={openNames.includes(member.name)}
                                    onToggle={() => toggleOpen(member.name)}
                                />
                            ))}
                        </TableBody>
                    </Table>
                </div>
            )}
        </div>
    );
}
