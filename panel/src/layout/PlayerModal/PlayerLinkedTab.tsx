import useSWR from "swr";
import { cn } from "@/lib/utils";
import { useAuthedFetcher } from "@/hooks/fetch";
import { useOpenPlayerModal, type PlayerModalRefType } from "@/hooks/playerModal";
import { msToDuration, tsToLocaleDateString } from "@/lib/dateTime";
import InlineCode from "@/components/InlineCode";
import GenericSpinner from "@/components/GenericSpinner";
import { ModalTabInner, ModalTabMessage } from "@/components/modal-tabs";
import { shortenId } from "@shared/utils";
import type { PlayerLinkedAccount, PlayerLinkedAccountsResp } from "@shared/playerApiTypes";


const pillClass = 'h-max rounded-sm text-2xs font-semibold px-1 py-[0.0625rem] tracking-wider whitespace-nowrap';

function LinkedAccountItem({ account, onOpen }: { account: PlayerLinkedAccount; onOpen: () => void }) {
    const playTime = account.playTime ? msToDuration(account.playTime * 60_000, { units: ['d', 'h', 'm'], largest: 2 }) : '--';
    return (
        <button
            type="button"
            onClick={onOpen}
            className={cn(
                'w-full text-left px-2 py-1 border-l-4 rounded-r-sm bg-muted/30 hover:bg-muted/60 transition-colors',
                account.isBanned ? 'border-destructive' : account.isOnline ? 'border-success' : 'border-muted'
            )}
        >
            <div className="flex w-full items-baseline justify-between gap-2">
                <strong className="text-sm truncate">{account.displayName}</strong>
                <span className="shrink-0 flex gap-1">
                    {account.isBanned && <span className={cn(pillClass, 'bg-destructive text-destructive-foreground')}>Banned</span>}
                    {account.banCount > 0 && <span className={cn(pillClass, 'bg-secondary text-secondary-foreground')}>
                        {account.banCount} {account.banCount === 1 ? 'Ban' : 'Bans'}
                    </span>}
                    {account.warnCount > 0 && <span className={cn(pillClass, 'bg-warning text-warning-foreground')}>
                        {account.warnCount} {account.warnCount === 1 ? 'Warn' : 'Warns'}
                    </span>}
                </span>
            </div>
            <span className="flex flex-wrap gap-1 text-2xs">
                {account.matchedIds.map((id) => (
                    <InlineCode key={id} title={id}>{shortenId(id)}</InlineCode>
                ))}
                {account.matchedHwids.map((hwid) => (
                    <InlineCode key={hwid} title={hwid}>{shortenId(hwid)}</InlineCode>
                ))}
            </span>
            <small className="block text-xs opacity-75 space-x-3">
                {account.isOnline ? (
                    <span className="text-success-inline">Online Now</span>
                ) : (
                    <span>Last Seen {tsToLocaleDateString(account.tsLastConnection, 'medium')}</span>
                )}
                <span>Play Time {playTime}</span>
            </small>
        </button>
    );
}


type PlayerLinkedTabProps = {
    playerRef: PlayerModalRefType;
    onOpenPlayer: () => void;
}

export default function PlayerLinkedTab({ playerRef, onOpenPlayer }: PlayerLinkedTabProps) {
    const authedFetcher = useAuthedFetcher();
    const openPlayerModal = useOpenPlayerModal();
    const query = new URLSearchParams(
        'license' in playerRef
            ? { license: playerRef.license }
            : { mutex: playerRef.mutex, netid: String(playerRef.netid) }
    ).toString();
    const swr = useSWR(`/player/linked?${query}`, (url: string) => authedFetcher<PlayerLinkedAccountsResp>(url), {
        revalidateOnFocus: false,
    });

    if (swr.error) {
        return <ModalTabMessage>
            <span className="text-destructive-inline">Error: {swr.error instanceof Error ? swr.error.message : String(swr.error)}</span>
        </ModalTabMessage>;
    }
    if (!swr.data) {
        return <ModalTabMessage>
            <GenericSpinner msg="Loading Linked Accounts..." />
        </ModalTabMessage>;
    }
    if ('error' in swr.data) {
        return <ModalTabMessage>
            <span className="text-destructive-inline">Error: {swr.data.error}</span>
        </ModalTabMessage>;
    }

    const { accounts, ignoredHwids, truncated } = swr.data;
    const ignoredNotice = ignoredHwids.length > 0 && (
        <small className="block text-xs text-muted-foreground">
            Skipped {ignoredHwids.length} shared {ignoredHwids.length === 1 ? 'HWID' : 'HWIDs'} used by too many players.
        </small>
    );
    if (!accounts.length) {
        return <ModalTabMessage className="flex-col gap-1 text-center">
            <span>No linked accounts found.</span>
            {ignoredNotice}
        </ModalTabMessage>;
    }

    return (
        <ModalTabInner className="flex flex-col gap-1">
            {accounts.map((account) => (
                <LinkedAccountItem
                    key={account.license}
                    account={account}
                    onOpen={() => {
                        onOpenPlayer();
                        openPlayerModal({ license: account.license });
                    }}
                />
            ))}
            {truncated && <small className="block text-xs text-muted-foreground">
                Showing the {accounts.length} strongest matches.
            </small>}
            {ignoredNotice}
        </ModalTabInner>
    );
}
