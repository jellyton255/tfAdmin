import { useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import { CheckIcon, Loader2Icon, SearchIcon, XIcon } from "lucide-react";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import Avatar from "@/components/Avatar";
import { useBackendApi } from "@/hooks/fetch";
import { useOpenConfirmDialog } from "@/hooks/dialogs";
import { tsToLocaleDateTimeString } from "@/lib/dateTime";
import type { GenericApiOkResp } from "@shared/genericApiTypes";
import type { WhitelistRequestsResp } from "@shared/whitelistApiTypes";
import type { DatabaseWhitelistRequestsType } from "../../../../core/modules/Database/databaseTypes";

export const APPROVALS_SWR_KEY = '/whitelist/approvals';
const REQUESTS_SWR_KEY = '/whitelist/requests';

//The legacy page kept the search string in the url hash, links still use it
function getInitialSearch() {
    return decodeURIComponent(window.location.hash.slice(1)).trim();
}

function setUrlHash(search: string) {
    const newUrl = new URL(window.location.toString());
    newUrl.hash = search ? encodeURIComponent(search) : '';
    window.history.replaceState({}, '', newUrl);
}


export default function AllowlistRequestsCard({ canManage }: { canManage: boolean }) {
    const [searchInput, setSearchInput] = useState(getInitialSearch);
    const [activeSearch, setActiveSearch] = useState(getInitialSearch);
    const [page, setPage] = useState(1);
    const openConfirmDialog = useOpenConfirmDialog();
    const { mutate: globalMutate } = useSWRConfig();

    const listApi = useBackendApi<WhitelistRequestsResp>({
        method: 'GET',
        path: REQUESTS_SWR_KEY,
    });
    const actionApi = useBackendApi<GenericApiOkResp>({
        method: 'POST',
        path: '/whitelist/requests/:action',
    });

    const swr = useSWR([REQUESTS_SWR_KEY, activeSearch, page], async () => {
        const resp = await listApi({
            queryParams: { searchString: activeSearch || undefined, page },
        });
        if (!resp) throw new Error('No data returned.');
        if ('error' in resp) throw new Error(resp.error);
        return resp;
    }, { keepPreviousData: true });

    const applySearch = (value: string) => {
        const search = value.trim();
        setSearchInput(search);
        setActiveSearch(search);
        setPage(1);
        setUrlHash(search);
    };

    const handleSearchSubmit = (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        applySearch(searchInput);
    };

    const runAction = async (action: 'approve' | 'deny' | 'deny_all', data: object, successMsg: string) => {
        await actionApi({
            pathParams: { action },
            data,
            toastLoadingMessage: 'Processing...',
            genericHandler: { successMsg },
        });
        swr.mutate();
        if (action === 'approve') globalMutate(APPROVALS_SWR_KEY);
    };

    const handleApprove = (req: DatabaseWhitelistRequestsType) => {
        runAction('approve', { reqId: req.id }, `Approved ${req.playerDisplayName}.`);
    };

    const handleDeny = (req: DatabaseWhitelistRequestsType) => {
        runAction('deny', { reqId: req.id }, `Denied ${req.playerDisplayName}.`);
    };

    const handleDenyAll = () => {
        if (!swr.data) return;
        const newestVisible = swr.data.newest;
        openConfirmDialog({
            title: 'Deny All Allowlist Requests?',
            message: 'Players can still try to join again, and will receive a new request ID.',
            actionLabel: 'Deny All',
            confirmBtnVariant: 'destructive',
            onConfirm: () => runAction('deny_all', { newestVisible }, 'Denied all requests.'),
        });
    };

    const data = swr.data;
    const isFiltered = !!data && data.cntFiltered !== data.cntTotal;
    const counter = !data ? '' : isFiltered ? `${data.cntFiltered} of ${data.cntTotal}` : data.cntTotal.toString();

    return (
        <Card className="flex flex-col">
            <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 space-y-0">
                <div className="space-y-1.5">
                    <CardTitle className="text-lg">
                        Requests {counter && <span className="text-muted-foreground font-normal">({counter})</span>}
                    </CardTitle>
                    <CardDescription>Players who tried to join without being allowlisted.</CardDescription>
                </div>
                <form className="flex items-center gap-2" onSubmit={handleSearchSubmit}>
                    <Input
                        className="h-8 w-48"
                        placeholder="Player name, R1234"
                        value={searchInput}
                        onChange={(e) => setSearchInput(e.target.value)}
                    />
                    {activeSearch ? (
                        <Button type="button" size="sm" variant="outline" onClick={() => applySearch('')}>
                            <XIcon className="size-4 mr-1" /> Clear
                        </Button>
                    ) : (
                        <Button type="submit" size="sm" variant="outline">
                            <SearchIcon className="size-4 mr-1" /> Search
                        </Button>
                    )}
                </form>
            </CardHeader>

            <CardContent className="flex-1">
                {swr.error ? (
                    <div className="text-center py-10 text-destructive">
                        {(swr.error as Error).message}
                    </div>
                ) : !data ? (
                    <div className="flex items-center justify-center py-10 text-muted-foreground">
                        <Loader2Icon className="animate-spin size-6 mr-2" /> Loading...
                    </div>
                ) : !data.requests.length ? (
                    <div className="text-center py-10 text-muted-foreground border rounded-lg border-dashed">
                        {activeSearch ? 'No requests match this search.' : 'No pending requests.'}
                    </div>
                ) : (
                    <div className="border rounded-lg overflow-x-auto">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>ID</TableHead>
                                    <TableHead>Name</TableHead>
                                    <TableHead>Discord</TableHead>
                                    <TableHead>Last Attempt</TableHead>
                                    <TableHead className="text-right">Actions</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {data.requests.map((req) => (
                                    <TableRow key={req.id}>
                                        <TableCell className="font-mono">{req.id}</TableCell>
                                        <TableCell
                                            className="max-w-[10rem] truncate"
                                            title={`${req.playerDisplayName}\nlicense:${req.license}`}
                                        >
                                            {req.playerDisplayName}
                                        </TableCell>
                                        <TableCell className="max-w-[12rem]" title={req.discordTag}>
                                            {req.discordTag ? (
                                                <div className="flex items-center gap-2 min-w-0">
                                                    <Avatar
                                                        className="size-6 text-xs shrink-0"
                                                        username={req.discordTag}
                                                        profilePicture={req.discordAvatar}
                                                    />
                                                    <span className="truncate">{req.discordTag}</span>
                                                </div>
                                            ) : (
                                                <span className="text-muted-foreground">Not Available</span>
                                            )}
                                        </TableCell>
                                        <TableCell
                                            className="whitespace-nowrap text-muted-foreground"
                                            title={tsToLocaleDateTimeString(req.tsLastAttempt, 'long', 'long')}
                                        >
                                            {tsToLocaleDateTimeString(req.tsLastAttempt, 'short', 'short')}
                                        </TableCell>
                                        <TableCell className="text-right whitespace-nowrap">
                                            <Button
                                                size="icon"
                                                variant="ghost"
                                                className="size-8 text-success hover:text-success"
                                                disabled={!canManage}
                                                title={canManage ? 'Approve' : 'You do not have this permission.'}
                                                onClick={() => handleApprove(req)}
                                            >
                                                <CheckIcon className="size-4" />
                                            </Button>
                                            <Button
                                                size="icon"
                                                variant="ghost"
                                                className="size-8 text-destructive hover:text-destructive"
                                                disabled={!canManage}
                                                title={canManage ? 'Deny' : 'You do not have this permission.'}
                                                onClick={() => handleDeny(req)}
                                            >
                                                <XIcon className="size-4" />
                                            </Button>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </div>
                )}
            </CardContent>

            <CardFooter className="justify-between gap-2">
                <Button
                    size="sm"
                    variant="outline"
                    className="text-destructive hover:text-destructive"
                    disabled={!canManage || !data?.requests.length || isFiltered}
                    title={isFiltered ? 'Clear the search to deny all requests.' : undefined}
                    onClick={handleDenyAll}
                >
                    <XIcon className="size-4 mr-1" /> Deny All
                </Button>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Button
                        size="sm"
                        variant="outline"
                        disabled={!data || data.currPage <= 1}
                        onClick={() => setPage((p) => Math.max(1, p - 1))}
                    >
                        Previous
                    </Button>
                    <span className="tabular-nums">
                        Page {data?.currPage ?? page} of {Math.max(1, data?.totalPages ?? 1)}
                    </span>
                    <Button
                        size="sm"
                        variant="outline"
                        disabled={!data || data.currPage >= data.totalPages}
                        onClick={() => setPage((p) => p + 1)}
                    >
                        Next
                    </Button>
                </div>
            </CardFooter>
        </Card>
    );
}
