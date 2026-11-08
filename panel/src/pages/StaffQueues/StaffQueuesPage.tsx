import { useState } from "react";
import { InboxIcon } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useOpenPromptDialog } from "@/hooks/dialogs";
import { useEverfallAction, useEverfallPermissions, useEverfallQuery } from "@/hooks/everfall";
import AllowlistSection from "@/pages/Allowlist/AllowlistSection";

/**
 * Everfall: ef_papers' print request review, run through ef_administration as the admin's connected
 * character (papers.* operations in modules/tfadmin-bridge/sv_queues.lua).
 * Shapes follow ef_administration web/src/features/paper-requests/types.ts.
 */
type PaperRequest = {
    id: string;
    title: string;
    requesterName: string;
    copies: number;
    status: string;
    revision: number;
    submittedAt: number;
    thumbnailUrl?: string;
    estimatedTotal: number;
};
type PaperRequestList = { requests: PaperRequest[]; total: number; pendingCount: number };

const PAGE_SIZE = 40;
const STATUS_LABELS: Record<string, string> = {
    pending_review: 'Needs Review',
    changes_requested: 'Changes Requested',
    approved: 'Approved',
    rejected: 'Rejected',
    printing: 'Printing',
    fulfilled: 'Printed',
    cancelled: 'Cancelled',
};
const COVERAGE_LABELS: Record<string, string> = {
    light: 'Mostly Blank',
    normal: 'Typical Page',
    heavy: 'Full-Page or Dark',
};

const moneyFormat = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const dateFormat = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' });


function ApproveDialog({ request, onClose, onDone }: {
    request: PaperRequest;
    onClose: () => void;
    onDone: () => void;
}) {
    const everfallAction = useEverfallAction();
    const [coverageBand, setCoverageBand] = useState('normal');
    const [note, setNote] = useState('');

    const handleApprove = async () => {
        onClose();
        const data = await everfallAction('papers.approve', {
            requestId: request.id,
            expectedRevision: request.revision,
            coverageBand,
            note: note.trim(),
        }, { loading: 'Approving...', success: 'Paper request approved.' });
        if (data) onDone();
    };

    return (
        <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
            <DialogContent className="max-w-md">
                <DialogHeader>
                    <DialogTitle>Approve {request.title}?</DialogTitle>
                </DialogHeader>
                <div className="flex flex-col gap-4">
                    <div className="flex flex-col gap-2">
                        <Label>Ink Coverage</Label>
                        <Select value={coverageBand} onValueChange={setCoverageBand}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                                {Object.entries(COVERAGE_LABELS).map(([band, label]) => (
                                    <SelectItem key={band} value={band} className="cursor-pointer">{label}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="flex flex-col gap-2">
                        <Label htmlFor="paper-approve-note">Note</Label>
                        <Textarea id="paper-approve-note" value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} />
                    </div>
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={onClose}>Cancel</Button>
                    <Button onClick={handleApprove}>Approve</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

function PaperRequestsQueue() {
    const [status, setStatus] = useState('pending_review');
    const [search, setSearch] = useState('');
    const [searchQuery, setSearchQuery] = useState('');
    const [page, setPage] = useState(1);
    const [approving, setApproving] = useState<PaperRequest | null>(null);
    const list = useEverfallQuery<PaperRequestList>('papers.list', {
        status,
        search: searchQuery,
        limit: PAGE_SIZE,
        offset: (page - 1) * PAGE_SIZE,
        sort: 'oldest',
    });
    const openPromptDialog = useOpenPromptDialog();
    const everfallAction = useEverfallAction();
    const pages = list.data ? Math.max(1, Math.ceil(list.data.total / PAGE_SIZE)) : 1;

    const handleSearch = (event: React.FormEvent) => {
        event.preventDefault();
        setSearchQuery(search.trim());
        setPage(1);
    };

    const handleNoteDecision = (request: PaperRequest, operation: string, title: string, submitLabel: string, success: string) => {
        openPromptDialog({
            title,
            message: 'The requester sees this note.',
            placeholder: 'Note',
            isMultiline: true,
            submitLabel,
            required: true,
            onSubmit: async (note) => {
                const data = await everfallAction(operation, {
                    requestId: request.id,
                    expectedRevision: request.revision,
                    note: note.trim(),
                }, { loading: 'Saving...', success });
                if (data) list.mutate();
            },
        });
    };

    return (<>
        <AllowlistSection
            title="Paper Requests"
            count={list.data ? `${list.data.pendingCount} Need Review` : undefined}
            error={list.error}
            isLoading={!list.data}
            emptyMessage={list.data?.requests.length === 0 ? 'No paper requests with this status.' : null}
            controls={(
                <div className="flex flex-wrap gap-2">
                    <form className="flex gap-2" onSubmit={handleSearch}>
                        <Input
                            className="h-8 w-48"
                            placeholder="Title or requester"
                            value={search}
                            onChange={(event) => setSearch(event.target.value)}
                        />
                        <Button size="sm" type="submit">Search</Button>
                    </form>
                    <Select value={status} onValueChange={(value) => { setStatus(value); setPage(1); }}>
                        <SelectTrigger className="w-44 h-8"><SelectValue /></SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all" className="cursor-pointer">All Statuses</SelectItem>
                            {Object.entries(STATUS_LABELS).map(([value, label]) => (
                                <SelectItem key={value} value={value} className="cursor-pointer">{label}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
            )}
            footer={pages > 1 && (
                <div className="flex items-center justify-end gap-2 px-4 py-2 border-t text-sm text-muted-foreground">
                    <span className="tabular-nums">Page {page} of {pages}</span>
                    <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
                    <Button size="sm" variant="outline" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</Button>
                </div>
            )}
        >
            <div className="overflow-x-auto">
                <Table>
                    <TableHeader>
                        <TableRow className="hover:bg-transparent">
                            <TableHead>Request</TableHead>
                            <TableHead className="text-right">Copies</TableHead>
                            <TableHead className="text-right">Estimate</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead />
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {list.data?.requests.map((request) => (
                            <TableRow key={request.id}>
                                <TableCell>
                                    <div className="flex items-center gap-3 min-w-0">
                                        {request.thumbnailUrl ? (
                                            <a href={request.thumbnailUrl} target="_blank" rel="noopener noreferrer" className="shrink-0">
                                                <img src={request.thumbnailUrl} alt="" className="size-10 rounded border object-cover bg-muted" />
                                            </a>
                                        ) : null}
                                        <div className="min-w-0">
                                            <div className="font-medium truncate">{request.title}</div>
                                            <div className="text-xs text-muted-foreground truncate">
                                                {request.requesterName} · {dateFormat.format(new Date(request.submittedAt * 1000))}
                                            </div>
                                        </div>
                                    </div>
                                </TableCell>
                                <TableCell className="text-right tabular-nums">{request.copies}</TableCell>
                                <TableCell className="text-right tabular-nums">{moneyFormat.format(request.estimatedTotal)}</TableCell>
                                <TableCell className="whitespace-nowrap">{STATUS_LABELS[request.status] ?? request.status}</TableCell>
                                <TableCell className="text-right whitespace-nowrap space-x-2">
                                    {request.status === 'pending_review' && (<>
                                        <Button size="sm" variant="outline" onClick={() => setApproving(request)}>Approve</Button>
                                        <Button size="sm" variant="outline" onClick={() => handleNoteDecision(
                                            request, 'papers.requestChanges', `Request Changes to ${request.title}?`, 'Request Changes', 'Changes requested.',
                                        )}>
                                            Request Changes
                                        </Button>
                                        <Button size="sm" variant="outline" onClick={() => handleNoteDecision(
                                            request, 'papers.reject', `Reject ${request.title}?`, 'Reject', 'Paper request rejected.',
                                        )}>
                                            Reject
                                        </Button>
                                    </>)}
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </div>
        </AllowlistSection>
        {approving && (
            <ApproveDialog request={approving} onClose={() => setApproving(null)} onDone={() => list.mutate()} />
        )}
    </>);
}


export default function StaffQueuesPage() {
    const { can, isLoading, lacks } = useEverfallPermissions();
    return (
        <div className="flex flex-col w-full gap-4 pb-4 [&>header]:mb-0">
            <PageHeader title="Staff Queues" icon={<InboxIcon />} />
            <div className="flex flex-col gap-4 mx-2 md:mx-0">
                {isLoading || !can('ReviewPapers') ? (
                    <AllowlistSection
                        title="Paper Requests"
                        isLoading={isLoading}
                        emptyMessage={lacks('Review Papers')}
                    />
                ) : (
                    <PaperRequestsQueue />
                )}
            </div>
        </div>
    );
}
