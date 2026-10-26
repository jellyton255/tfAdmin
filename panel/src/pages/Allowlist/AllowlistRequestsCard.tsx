import { useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import { CheckIcon, ChevronLeftIcon, ChevronRightIcon, SearchIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import Avatar from "@/components/Avatar";
import AllowlistSection from "./AllowlistSection";
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
    const counter = !data ? undefined : isFiltered ? `${data.cntFiltered} of ${data.cntTotal}` : data.cntTotal.toString();
    const emptyMessage = data && !data.requests.length
        ? activeSearch ? 'No requests match this search.' : 'No pending requests.'
        : null;

    return (
        <AllowlistSection
            title="Requests"
            count={counter}
            error={swr.error}
            isLoading={!data}
            emptyMessage={emptyMessage}
            controls={(
                <div className="flex items-center gap-2 max-sm:w-full">
                    <form className="relative max-sm:flex-1" onSubmit={handleSearchSubmit}>
                        <SearchIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
                        <Input
                            className="h-8 w-full sm:w-56 pl-8 pr-8"
                            placeholder="Name or Request ID"
                            value={searchInput}
                            onChange={(e) => setSearchInput(e.target.value)}
                        />
                        {activeSearch && (
                            <button
                                type="button"
                                title="Clear Search"
                                className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-sm p-0.5 text-muted-foreground hover:text-foreground"
                                onClick={() => applySearch('')}
                            >
                                <XIcon className="size-4" />
                            </button>
                        )}
                    </form>
                    {canManage && !!data?.requests.length && !isFiltered && (
                        <Button size="xs" variant="outline-destructive" className="h-8" onClick={handleDenyAll}>
                            Deny All
                        </Button>
                    )}
                </div>
            )}
            footer={data && data.totalPages > 1 && (
                <div className="flex items-center justify-end gap-2 px-4 py-2 border-t text-sm text-muted-foreground">
                    <span className="tabular-nums mr-1">Page {data.currPage} of {data.totalPages}</span>
                    <Button
                        size="icon"
                        variant="ghost-muted"
                        className="size-8"
                        title="Previous Page"
                        disabled={data.currPage <= 1}
                        onClick={() => setPage((p) => Math.max(1, p - 1))}
                    >
                        <ChevronLeftIcon className="size-4" />
                    </Button>
                    <Button
                        size="icon"
                        variant="ghost-muted"
                        className="size-8"
                        title="Next Page"
                        disabled={data.currPage >= data.totalPages}
                        onClick={() => setPage((p) => p + 1)}
                    >
                        <ChevronRightIcon className="size-4" />
                    </Button>
                </div>
            )}
        >
            {data?.requests.map((req) => (
                <div
                    key={req.id}
                    className="grid grid-cols-[minmax(0,1fr)_auto] md:grid-cols-[4.5rem_minmax(0,1.2fr)_minmax(0,1.2fr)_9rem_auto] items-center gap-x-4 gap-y-1 px-4 py-2.5"
                >
                    <span className="hidden md:block font-mono text-sm text-muted-foreground">{req.id}</span>
                    <div className="min-w-0 truncate" title={`${req.playerDisplayName}\nlicense:${req.license}`}>
                        <span className="font-medium">{req.playerDisplayName}</span>
                        <span className="md:hidden ml-2 font-mono text-sm text-muted-foreground">{req.id}</span>
                    </div>
                    <div className="row-start-2 md:row-start-auto flex items-center gap-2 min-w-0 text-sm text-muted-foreground" title={req.discordTag}>
                        {req.discordTag ? (<>
                            <Avatar
                                className="size-5 text-[0.6rem] shrink-0"
                                username={req.discordTag}
                                profilePicture={req.discordAvatar}
                            />
                            <span className="truncate">{req.discordTag}</span>
                        </>) : 'No Discord'}
                    </div>
                    <span
                        className="row-start-3 md:row-start-auto text-sm text-muted-foreground whitespace-nowrap"
                        title={tsToLocaleDateTimeString(req.tsLastAttempt, 'long', 'long')}
                    >
                        {tsToLocaleDateTimeString(req.tsLastAttempt, 'short', 'short')}
                    </span>
                    {canManage && (
                        <div className="col-start-2 row-start-1 row-span-3 md:col-start-auto md:row-start-auto md:row-span-1 flex gap-1 justify-self-end">
                            <Button
                                size="icon"
                                variant="ghost-success"
                                className="size-8"
                                title="Approve"
                                onClick={() => handleApprove(req)}
                            >
                                <CheckIcon className="size-4" />
                            </Button>
                            <Button
                                size="icon"
                                variant="ghost-destructive"
                                className="size-8"
                                title="Deny"
                                onClick={() => handleDeny(req)}
                            >
                                <XIcon className="size-4" />
                            </Button>
                        </div>
                    )}
                </div>
            ))}
        </AllowlistSection>
    );
}
