import { useState } from "react";
import { BriefcaseIcon, Loader2Icon, PlusIcon } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { txToast } from "@/components/TxToaster";
import { useOpenConfirmDialog, useOpenPromptDialog } from "@/hooks/dialogs";
import { useEverfallPermissions, useEverfallQuery, useEverfallRequest } from "@/hooks/everfall";
import { cn } from "@/lib/utils";
import type { EverfallGroup, EverfallGroupList, EverfallGroupMembers, EverfallGroupType, EverfallRemovedJobs } from "@shared/everfallApiTypes";


const numberFormatter = new Intl.NumberFormat('en-US');

function errorText(error: unknown) {
    return error instanceof Error ? error.message : String(error);
}

function Loading() {
    return (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
            <Loader2Icon className="animate-spin size-6 mr-2" /> Loading...
        </div>
    );
}


//MARK: Members
type GroupMembersCardProps = {
    groupType: EverfallGroupType;
    group: EverfallGroup;
    canManage: boolean;
    onChanged: () => void;
};
function GroupMembersCard({ groupType, group, canManage, onChanged }: GroupMembersCardProps) {
    const [page, setPage] = useState(1);
    const query = useEverfallQuery<EverfallGroupMembers>('groups.members', { groupType, groupId: group.id, page });
    const everfallRequest = useEverfallRequest();
    const openPromptDialog = useOpenPromptDialog();
    const openConfirmDialog = useOpenConfirmDialog();
    const grades = Object.values(group.grades);
    const rows = query.data ? Object.values(query.data.rows) : [];
    const gradeName = (grade: number) => grades.find((item) => item.grade === grade)?.name ?? `Grade ${grade}`;

    async function change(operation: string, payload: Record<string, unknown>, loading: string, done: string) {
        const toastId = txToast.loading(loading);
        try {
            await everfallRequest(operation, { groupType, groupId: group.id, ...payload });
            txToast.success(done, { id: toastId });
        } catch (error) {
            txToast.error(errorText(error), { id: toastId });
        }
        query.mutate();
        onChanged();
    }

    function handleAdd() {
        const lowest = grades[0];
        if (!lowest) return;
        openPromptDialog({
            title: `Add Member to ${group.label}`,
            message: `Type the character's citizen ID. They join as ${lowest.name}.`,
            placeholder: 'ABC12345',
            submitLabel: 'Add',
            required: true,
            onSubmit: (input) => {
                const citizenId = input.trim().toUpperCase();
                change('groups.setMember', { citizenId, grade: lowest.grade }, 'Adding member...', `Added ${citizenId}.`);
            },
        });
    }

    function handleRemove(member: EverfallGroupMembers['rows'][number]) {
        openConfirmDialog({
            title: `Remove ${member.fullName}`,
            message: `Remove ${member.fullName} from ${group.label}?`,
            actionLabel: 'Remove',
            confirmBtnVariant: 'destructive',
            onConfirm: () => {
                change('groups.removeMember', { citizenId: member.citizenId }, 'Removing member...', `Removed ${member.fullName}.`);
            },
        });
    }

    return (
        <div className="min-w-0 border rounded-lg bg-card overflow-x-auto">
            <div className="flex items-center justify-between gap-2 px-4 py-3 border-b">
                <h2 className="font-semibold truncate">
                    {group.label}
                    <span className="ml-2 text-xs font-mono font-normal text-muted-foreground">{group.id}</span>
                </h2>
                {canManage && grades.length > 0 && (
                    <Button size="sm" variant="outline" onClick={handleAdd}>
                        <PlusIcon className="size-4 mr-1" /> Add Member
                    </Button>
                )}
            </div>
            {query.error ? (
                <Alert variant="destructive" className="m-4 w-auto">
                    <AlertTitle>Failed to Load Members</AlertTitle>
                    <AlertDescription>{errorText(query.error)}</AlertDescription>
                </Alert>
            ) : !query.data ? <Loading /> : (<>
                <Table>
                    <TableHeader>
                        <TableRow className="hover:bg-transparent">
                            <TableHead>Character</TableHead>
                            <TableHead className="whitespace-nowrap">Citizen ID</TableHead>
                            <TableHead>Grade</TableHead>
                            {canManage && <TableHead />}
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {rows.map((member) => (
                            <TableRow key={member.citizenId}>
                                <TableCell className="font-semibold whitespace-nowrap">
                                    {member.fullName}
                                    {member.online && <span className="ml-2 text-xs font-normal text-success-inline">Online</span>}
                                </TableCell>
                                <TableCell className="font-mono text-xs">{member.citizenId}</TableCell>
                                <TableCell className="py-1">
                                    {canManage ? (
                                        <Select
                                            value={String(member.grade)}
                                            onValueChange={(value) => change(
                                                'groups.setMember',
                                                { citizenId: member.citizenId, grade: Number(value) },
                                                'Changing grade...',
                                                `${member.fullName} is now ${gradeName(Number(value))}.`,
                                            )}
                                        >
                                            <SelectTrigger className="w-36 h-8">
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {grades.map((item) => (
                                                    <SelectItem key={item.grade} value={String(item.grade)} className="cursor-pointer">
                                                        {item.name}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    ) : gradeName(member.grade)}
                                </TableCell>
                                {canManage && (
                                    <TableCell className="text-right py-1">
                                        <Button size="sm" variant="ghost" onClick={() => handleRemove(member)}>Remove</Button>
                                    </TableCell>
                                )}
                            </TableRow>
                        ))}
                        {!rows.length && (
                            <TableRow className="hover:bg-transparent">
                                <TableCell colSpan={canManage ? 4 : 3} className="text-center text-muted-foreground py-8">
                                    This group has no members.
                                </TableCell>
                            </TableRow>
                        )}
                    </TableBody>
                </Table>
                {(page > 1 || query.data.hasMore) && (
                    <div className="flex items-center justify-end gap-2 px-4 py-2 border-t text-sm">
                        <span className="text-muted-foreground mr-auto">Page {page}</span>
                        <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                            Previous
                        </Button>
                        <Button size="sm" variant="outline" disabled={!query.data.hasMore} onClick={() => setPage(page + 1)}>
                            Next
                        </Button>
                    </div>
                )}
            </>)}
        </div>
    );
}


//MARK: Removed Jobs
/** Jobs deleted from the job list that characters still hold; cleanup moves them to Unemployed. */
function RemovedJobsCard({ onChanged }: { onChanged: () => void }) {
    const query = useEverfallQuery<EverfallRemovedJobs>('groups.removedJobs');
    const everfallRequest = useEverfallRequest();
    const openConfirmDialog = useOpenConfirmDialog();
    const jobs = query.data ? Object.values(query.data.jobs) : [];
    if (!jobs.length) return null;

    function handleCleanup(job: { name: string; members: number }) {
        openConfirmDialog({
            title: 'Clean Up Removed Job',
            message: `Remove ${job.name} from ${numberFormatter.format(job.members)} ${job.members === 1 ? 'character' : 'characters'}? Anyone with it as their main job goes back to Unemployed.`,
            actionLabel: 'Clean Up',
            confirmBtnVariant: 'destructive',
            onConfirm: async () => {
                const toastId = txToast.loading(`Cleaning up ${job.name}...`);
                try {
                    const result = await everfallRequest<{ cleaned: number; failed: number }>('groups.cleanupRemovedJob', { jobName: job.name });
                    const text = `Cleared ${job.name} from ${numberFormatter.format(result.cleaned)} ${result.cleaned === 1 ? 'character' : 'characters'}.`;
                    if (result.failed) {
                        txToast.warning(`${text} ${numberFormatter.format(result.failed)} could not be changed.`, { id: toastId });
                    } else {
                        txToast.success(text, { id: toastId });
                    }
                } catch (error) {
                    txToast.error(errorText(error), { id: toastId });
                }
                query.mutate();
                onChanged();
            },
        });
    }

    return (
        <div className="min-w-0 border border-warning/40 rounded-lg bg-card overflow-hidden">
            <div className="px-4 py-2.5 border-b text-sm font-semibold">Removed Jobs</div>
            <Table>
                <TableHeader>
                    <TableRow className="hover:bg-transparent">
                        <TableHead>Job</TableHead>
                        <TableHead className="text-right">Characters</TableHead>
                        <TableHead />
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {jobs.map((job) => (
                        <TableRow key={job.name}>
                            <TableCell className="font-mono">{job.name}</TableCell>
                            <TableCell className="text-right tabular-nums">{numberFormatter.format(job.members)}</TableCell>
                            <TableCell className="text-right">
                                <Button size="sm" variant="outline-destructive" onClick={() => handleCleanup(job)}>Clean Up</Button>
                            </TableCell>
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
        </div>
    );
}


//MARK: Page
export default function GroupsPage() {
    const { can, data: permissions } = useEverfallPermissions();
    const [groupType, setGroupType] = useState<EverfallGroupType>('job');
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const canView = can('ViewGroups');
    const list = useEverfallQuery<EverfallGroupList>(canView ? 'groups.list' : null);
    const groups = list.data ? Object.values(groupType === 'job' ? list.data.jobs : list.data.gangs) : [];
    const selected = groups.find((group) => group.id === selectedId);

    function handleTypeChange(value: string) {
        setGroupType(value === 'gang' ? 'gang' : 'job');
        setSelectedId(null);
    }

    return (
        <div className="flex flex-col w-full gap-4 pb-4 [&>header]:mb-0">
            <PageHeader title="Groups" icon={<BriefcaseIcon />} />

            {permissions && !canView ? (
                <Alert variant="destructive" className="mx-2 md:mx-0 w-auto">
                    <AlertTitle>No Access</AlertTitle>
                    <AlertDescription>Your Everfall staff rank does not include ViewGroups.</AlertDescription>
                </Alert>
            ) : list.error ? (
                <Alert variant="destructive" className="mx-2 md:mx-0 w-auto">
                    <AlertTitle>Failed to Load Groups</AlertTitle>
                    <AlertDescription>{errorText(list.error)}</AlertDescription>
                </Alert>
            ) : !list.data ? <Loading /> : (
                <div className="flex flex-col gap-3 mx-2 md:mx-0">
                    <Tabs value={groupType} onValueChange={handleTypeChange}>
                        <TabsList>
                            <TabsTrigger value="job">Jobs</TabsTrigger>
                            <TabsTrigger value="gang">Gangs</TabsTrigger>
                        </TabsList>
                    </Tabs>
                    {groupType === 'job' && can('ManageGroups') && <RemovedJobsCard onChanged={() => list.mutate()} />}
                    <div className="grid gap-4 lg:grid-cols-[minmax(12rem,16rem)_1fr] items-start">
                        <div className="min-w-0 border rounded-lg bg-card overflow-y-auto max-h-[70vh]">
                            <Table>
                                <TableHeader>
                                    <TableRow className="hover:bg-transparent">
                                        <TableHead>{groupType === 'job' ? 'Job' : 'Gang'}</TableHead>
                                        <TableHead className="text-right">Members</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {groups.map((group) => (
                                        <TableRow
                                            key={group.id}
                                            className={cn('cursor-pointer', group.id === selectedId && 'bg-muted')}
                                            onClick={() => setSelectedId(group.id)}
                                        >
                                            <TableCell className="font-semibold">{group.label}</TableCell>
                                            <TableCell className={cn('text-right tabular-nums', !group.members && 'text-muted-foreground/60')}>
                                                {numberFormatter.format(group.members)}
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </div>
                        {selected && (
                            <GroupMembersCard
                                key={`${groupType}:${selected.id}`}
                                groupType={groupType}
                                group={selected}
                                canManage={can('ManageGroups')}
                                onChanged={() => list.mutate()}
                            />
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
