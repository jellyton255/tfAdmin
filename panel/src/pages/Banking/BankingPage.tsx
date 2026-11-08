import { useState } from "react";
import { LandmarkIcon, XIcon } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useOpenPromptDialog } from "@/hooks/dialogs";
import { useEverfallAction, useEverfallPermissions, useEverfallQuery } from "@/hooks/everfall";
import { cn } from "@/lib/utils";
import AllowlistSection from "@/pages/Allowlist/AllowlistSection";

/**
 * Everfall: ef_banking's administration tools, run through ef_administration as the admin's
 * connected character (banking.* operations in modules/tfadmin-bridge/sv_finances.lua).
 * Shapes follow ef_administration web/src/features/banking-management/types.ts.
 */
type BankingPage<T> = { items: T[]; page: number; pageSize: number; total: number };
type BankingAccount = {
    id: number;
    iban: string;
    name: string;
    balance: number;
    type: string;
    isFrozen: boolean;
    status: string;
    ownerName?: string;
    memberCount: number;
    heldAmount: number;
};
type BankingMember = {
    id: string;
    identifier: string;
    displayName?: string;
    accessSource: string;
    isOwner?: boolean;
};
type BankingTransaction = {
    id: string;
    accountIban?: string;
    accountName?: string;
    action: string;
    amount: number;
    description?: string;
    direction?: 'credit' | 'debit';
    reversedByTransactionId?: string;
    reversesTransactionId?: string;
    createdAt: string;
};
type BankingAccountDetails = {
    account: BankingAccount;
    members: BankingMember[];
    recentTransactions: BankingTransaction[];
};
type BankingAlert = {
    id: string;
    accountIban?: string;
    accountName?: string;
    activity: string;
    amount: number;
    alertReasons?: string[];
    reviewStatus: 'open' | 'acknowledged' | 'resolved';
    createdAt: string;
};
type BankingHold = {
    id: string;
    accountIban?: string;
    accountName?: string;
    amount: number;
    reason: string;
    status: string;
    createdAt: string;
};
type BankingLedgerPage = { items: BankingTransaction[]; total: number };

const PAGE_SIZE = 25;
const TABS = [
    { key: 'accounts', label: 'Accounts' },
    { key: 'alerts', label: 'Alerts' },
    { key: 'holds', label: 'Holds' },
    { key: 'transactions', label: 'Transactions' },
];
const ALERT_REASON_LABELS: Record<string, string> = {
    large_transaction: 'Large Transaction',
    same_user_transfer: 'Same-Owner Transfer',
    transaction_spam: 'Transaction Spam',
};
//New members can move money but not manage other members, as the in-game panel defaults
const NEW_MEMBER_PERMISSIONS = {
    canDeposit: true,
    canWithdraw: true,
    canTransfer: true,
    canExport: false,
    canControlMembers: false,
};

const moneyFormat = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
function formatDate(value: string) {
    return new Date(value).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
}
function titleCase(value: string) {
    return value.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}


/**
 * A change that needs a reason: asks for it, then runs the operation with a fresh idempotency key.
 */
function useBankingChange(onDone: () => void) {
    const openPromptDialog = useOpenPromptDialog();
    const everfallAction = useEverfallAction();
    return function bankingChange(options: {
        title: string;
        submitLabel: string;
        operation: string;
        payload: Record<string, unknown>;
        success: string;
        reasonKey?: 'reason' | 'note';
    }) {
        openPromptDialog({
            title: options.title,
            message: 'Enter the reason for this change. It is saved in the banking audit trail.',
            placeholder: 'Reason',
            submitLabel: options.submitLabel,
            required: true,
            onSubmit: async (reason) => {
                const data = await everfallAction(options.operation, {
                    ...options.payload,
                    [options.reasonKey ?? 'reason']: reason.trim(),
                    idempotencyKey: crypto.randomUUID(),
                }, { loading: 'Saving...', success: options.success });
                if (data) onDone();
            },
        });
    };
}

function Pager({ page, total, onPage }: { page: number; total: number; onPage: (page: number) => void }) {
    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    if (pages === 1) return null;
    return (
        <div className="flex items-center justify-end gap-2 px-4 py-2 border-t text-sm text-muted-foreground">
            <span className="tabular-nums">Page {page} of {pages}</span>
            <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</Button>
            <Button size="sm" variant="outline" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next</Button>
        </div>
    );
}

function Money({ amount, direction }: { amount: number; direction?: 'credit' | 'debit' }) {
    return (
        <span className={cn(
            'tabular-nums',
            direction === 'credit' && 'text-success-inline',
            direction === 'debit' && 'text-destructive-inline',
        )}>
            {direction === 'debit' ? '-' : ''}{moneyFormat.format(amount)}
        </span>
    );
}

function ResultTable({ heads, children }: { heads: string[]; children: React.ReactNode }) {
    return (
        <div className="overflow-x-auto">
            <Table>
                <TableHeader>
                    <TableRow className="hover:bg-transparent">
                        {heads.map((head) => <TableHead key={head} className="whitespace-nowrap">{head}</TableHead>)}
                    </TableRow>
                </TableHeader>
                <TableBody>{children}</TableBody>
            </Table>
        </div>
    );
}

function TransactionRows({ transactions, canReverse, onReverse }: {
    transactions: BankingTransaction[];
    canReverse: boolean;
    onReverse: (transaction: BankingTransaction) => void;
}) {
    return transactions.map((transaction) => (
        <TableRow key={transaction.id}>
            <TableCell className="whitespace-nowrap text-muted-foreground">{formatDate(transaction.createdAt)}</TableCell>
            <TableCell>{transaction.accountName ?? transaction.accountIban ?? '--'}</TableCell>
            <TableCell>{titleCase(transaction.action)}</TableCell>
            <TableCell className="max-w-72 truncate">{transaction.description ?? '--'}</TableCell>
            <TableCell className="text-right"><Money amount={transaction.amount} direction={transaction.direction} /></TableCell>
            <TableCell className="text-right">
                {transaction.reversedByTransactionId ? (
                    <Badge variant="outline">Reversed</Badge>
                ) : canReverse && !transaction.reversesTransactionId ? (
                    <Button size="sm" variant="outline" onClick={() => onReverse(transaction)}>Reverse</Button>
                ) : null}
            </TableCell>
        </TableRow>
    ));
}

function useReverse(onDone: () => void) {
    const bankingChange = useBankingChange(onDone);
    return (transaction: BankingTransaction) => bankingChange({
        title: `Reverse ${moneyFormat.format(transaction.amount)} ${titleCase(transaction.action)}?`,
        submitLabel: 'Reverse',
        operation: 'banking.reverse',
        payload: { transactionId: transaction.id },
        success: 'Transaction reversed.',
    });
}


//MARK: Accounts
function AccountRecord({ accountId, onClose }: { accountId: number; onClose: () => void }) {
    const { can } = useEverfallPermissions();
    const query = useEverfallQuery<BankingAccountDetails>('banking.account', { accountId });
    const refresh = () => query.mutate();
    const bankingChange = useBankingChange(refresh);
    const reverse = useReverse(refresh);
    const openPromptDialog = useOpenPromptDialog();
    const everfallAction = useEverfallAction();
    const details = query.data;

    const handleAddMember = () => openPromptDialog({
        title: 'Add Account Member',
        message: 'Enter the character\'s citizen ID. They can deposit, withdraw and transfer, but not manage members.',
        placeholder: 'ABC12345',
        noteLabel: 'Reason',
        submitLabel: 'Add Member',
        required: true,
        onSubmit: async (citizenid, reason) => {
            const data = await everfallAction('banking.addMember', {
                accountId,
                citizenid: citizenid.trim().toUpperCase(),
                permissions: NEW_MEMBER_PERMISSIONS,
                reason: reason.trim(),
                idempotencyKey: crypto.randomUUID(),
            }, { loading: 'Saving...', success: 'Member added.' });
            if (data) refresh();
        },
    });

    const account = details?.account;
    return (
        <AllowlistSection
            title={account ? `${account.name} (${account.iban})` : 'Account'}
            error={query.error}
            isLoading={!details}
            emptyMessage={null}
            controls={(
                <div className="flex flex-wrap items-center gap-2">
                    {account && can('ManageBankingLocks') && (
                        <Button
                            size="sm"
                            variant="outline"
                            onClick={() => bankingChange({
                                title: `${account.isFrozen ? 'Unfreeze' : 'Freeze'} ${account.name}?`,
                                submitLabel: account.isFrozen ? 'Unfreeze' : 'Freeze',
                                operation: account.isFrozen ? 'banking.unfreezeAccount' : 'banking.freezeAccount',
                                payload: { accountId },
                                success: account.isFrozen ? 'Account unfrozen.' : 'Account frozen.',
                            })}
                        >
                            {account.isFrozen ? 'Unfreeze' : 'Freeze'}
                        </Button>
                    )}
                    {account && can('ManageBankingMembers') && (
                        <Button size="sm" variant="outline" onClick={handleAddMember}>Add Member</Button>
                    )}
                    <Button size="icon" variant="ghost" className="size-8" onClick={onClose} aria-label="Close">
                        <XIcon className="size-4" />
                    </Button>
                </div>
            )}
        >
            {details && account && (<>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 px-4 py-3 text-sm">
                    <div><div className="text-muted-foreground">Balance</div><Money amount={account.balance} /></div>
                    <div><div className="text-muted-foreground">Held</div><Money amount={account.heldAmount} /></div>
                    <div><div className="text-muted-foreground">Type</div>{titleCase(account.type)}</div>
                    <div>
                        <div className="text-muted-foreground">Status</div>
                        {account.isFrozen ? <span className="text-destructive-inline">Frozen</span> : titleCase(account.status)}
                    </div>
                </div>
                <div>
                    <h3 className="px-4 pt-3 pb-1 text-sm font-medium text-muted-foreground">Members</h3>
                    <ResultTable heads={['Member', 'Citizen ID', 'Access', '']}>
                        {details.members.map((member) => (
                            <TableRow key={member.id}>
                                <TableCell>{member.displayName ?? '--'}</TableCell>
                                <TableCell className="font-mono text-xs">{member.identifier}</TableCell>
                                <TableCell>{member.isOwner ? 'Owner' : titleCase(member.accessSource)}</TableCell>
                                <TableCell className="text-right">
                                    {!member.isOwner && can('ManageBankingMembers') && (
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            onClick={() => bankingChange({
                                                title: `Remove ${member.displayName ?? member.identifier}?`,
                                                submitLabel: 'Remove',
                                                operation: 'banking.removeMember',
                                                payload: { accountId, memberId: Number(member.id) },
                                                success: 'Member removed.',
                                            })}
                                        >
                                            Remove
                                        </Button>
                                    )}
                                </TableCell>
                            </TableRow>
                        ))}
                    </ResultTable>
                </div>
                <div>
                    <h3 className="px-4 pt-3 pb-1 text-sm font-medium text-muted-foreground">Recent Transactions</h3>
                    <ResultTable heads={['Date', 'Account', 'Action', 'Description', 'Amount', '']}>
                        <TransactionRows
                            transactions={details.recentTransactions}
                            canReverse={can('ReverseBankingTransaction')}
                            onReverse={reverse}
                        />
                    </ResultTable>
                </div>
            </>)}
        </AllowlistSection>
    );
}

function AccountsTab() {
    const [search, setSearch] = useState('');
    const [query, setQuery] = useState('');
    const [page, setPage] = useState(1);
    const [selectedId, setSelectedId] = useState<number | null>(null);
    const accounts = useEverfallQuery<BankingPage<BankingAccount>>('banking.searchAccounts', {
        query, page, pageSize: PAGE_SIZE, sortBy: 'updated', sortDirection: 'desc',
    });

    const handleSearch = (event: React.FormEvent) => {
        event.preventDefault();
        setQuery(search.trim());
        setPage(1);
    };

    return (<>
        {selectedId !== null && (
            <AccountRecord key={selectedId} accountId={selectedId} onClose={() => setSelectedId(null)} />
        )}
        <AllowlistSection
            title="Accounts"
            count={accounts.data ? String(accounts.data.total) : undefined}
            error={accounts.error}
            isLoading={!accounts.data}
            emptyMessage={accounts.data?.items.length === 0 ? 'No accounts match this search.' : null}
            controls={(
                <form className="flex gap-2" onSubmit={handleSearch}>
                    <Input
                        className="h-8 w-56"
                        placeholder="Name, IBAN or citizen ID"
                        value={search}
                        onChange={(event) => setSearch(event.target.value)}
                    />
                    <Button size="sm" type="submit">Search</Button>
                </form>
            )}
            footer={accounts.data && <Pager page={page} total={accounts.data.total} onPage={setPage} />}
        >
            <ResultTable heads={['Account', 'IBAN', 'Owner', 'Type', 'Balance', 'Status']}>
                {accounts.data?.items.map((account) => (
                    <TableRow
                        key={account.id}
                        className={cn('cursor-pointer', account.id === selectedId && 'bg-muted/50')}
                        onClick={() => setSelectedId(account.id)}
                    >
                        <TableCell className="font-medium">{account.name}</TableCell>
                        <TableCell className="font-mono text-xs">{account.iban}</TableCell>
                        <TableCell>{account.ownerName ?? '--'}</TableCell>
                        <TableCell>{titleCase(account.type)}</TableCell>
                        <TableCell><Money amount={account.balance} /></TableCell>
                        <TableCell>
                            {account.isFrozen ? <span className="text-destructive-inline">Frozen</span> : titleCase(account.status)}
                        </TableCell>
                    </TableRow>
                ))}
            </ResultTable>
        </AllowlistSection>
    </>);
}


//MARK: Alerts
function AlertsTab() {
    const { can } = useEverfallPermissions();
    const [status, setStatus] = useState('open');
    const [page, setPage] = useState(1);
    const alerts = useEverfallQuery<BankingPage<BankingAlert>>('banking.alerts', {
        query: '', page, pageSize: PAGE_SIZE, status,
    });
    const bankingChange = useBankingChange(() => alerts.mutate());
    const canReview = can('ReviewBankingAlerts');

    return (
        <AllowlistSection
            title="Risk Alerts"
            count={alerts.data ? String(alerts.data.total) : undefined}
            error={alerts.error}
            isLoading={!alerts.data}
            emptyMessage={alerts.data?.items.length === 0 ? 'No alerts with this status.' : null}
            controls={(
                <Select value={status} onValueChange={(value) => { setStatus(value); setPage(1); }}>
                    <SelectTrigger className="w-40 h-8"><SelectValue /></SelectTrigger>
                    <SelectContent>
                        <SelectItem value="open" className="cursor-pointer">Open</SelectItem>
                        <SelectItem value="acknowledged" className="cursor-pointer">Acknowledged</SelectItem>
                        <SelectItem value="resolved" className="cursor-pointer">Resolved</SelectItem>
                    </SelectContent>
                </Select>
            )}
            footer={alerts.data && <Pager page={page} total={alerts.data.total} onPage={setPage} />}
        >
            <ResultTable heads={['Date', 'Account', 'Reason', 'Activity', 'Amount', '']}>
                {alerts.data?.items.map((alert) => (
                    <TableRow key={alert.id}>
                        <TableCell className="whitespace-nowrap text-muted-foreground">{formatDate(alert.createdAt)}</TableCell>
                        <TableCell>{alert.accountName ?? alert.accountIban ?? '--'}</TableCell>
                        <TableCell>
                            {(alert.alertReasons ?? []).map((reason) => ALERT_REASON_LABELS[reason] ?? titleCase(reason)).join(', ') || '--'}
                        </TableCell>
                        <TableCell>{titleCase(alert.activity)}</TableCell>
                        <TableCell><Money amount={alert.amount} /></TableCell>
                        <TableCell className="text-right whitespace-nowrap space-x-2">
                            {canReview && alert.reviewStatus === 'open' && (
                                <Button size="sm" variant="outline" onClick={() => bankingChange({
                                    title: 'Acknowledge Alert?',
                                    submitLabel: 'Acknowledge',
                                    operation: 'banking.acknowledgeAlert',
                                    payload: { alertId: alert.id },
                                    success: 'Alert acknowledged.',
                                    reasonKey: 'note',
                                })}>
                                    Acknowledge
                                </Button>
                            )}
                            {canReview && alert.reviewStatus !== 'resolved' && (
                                <Button size="sm" variant="outline" onClick={() => bankingChange({
                                    title: 'Resolve Alert?',
                                    submitLabel: 'Resolve',
                                    operation: 'banking.resolveAlert',
                                    payload: { alertId: alert.id },
                                    success: 'Alert resolved.',
                                    reasonKey: 'note',
                                })}>
                                    Resolve
                                </Button>
                            )}
                        </TableCell>
                    </TableRow>
                ))}
            </ResultTable>
        </AllowlistSection>
    );
}


//MARK: Holds
function HoldsTab() {
    const { can } = useEverfallPermissions();
    const [page, setPage] = useState(1);
    const holds = useEverfallQuery<BankingPage<BankingHold>>('banking.holds', {
        query: '', page, pageSize: PAGE_SIZE, status: 'active',
    });
    const bankingChange = useBankingChange(() => holds.mutate());

    return (
        <AllowlistSection
            title="Active Holds"
            count={holds.data ? String(holds.data.total) : undefined}
            error={holds.error}
            isLoading={!holds.data}
            emptyMessage={holds.data?.items.length === 0 ? 'No funds are on hold.' : null}
            footer={holds.data && <Pager page={page} total={holds.data.total} onPage={setPage} />}
        >
            <ResultTable heads={['Date', 'Account', 'Reason', 'Amount', '']}>
                {holds.data?.items.map((hold) => (
                    <TableRow key={hold.id}>
                        <TableCell className="whitespace-nowrap text-muted-foreground">{formatDate(hold.createdAt)}</TableCell>
                        <TableCell>{hold.accountName ?? hold.accountIban ?? '--'}</TableCell>
                        <TableCell className="max-w-72 truncate">{hold.reason}</TableCell>
                        <TableCell><Money amount={hold.amount} /></TableCell>
                        <TableCell className="text-right">
                            {can('ManageBankingHolds') && (
                                <Button size="sm" variant="outline" onClick={() => bankingChange({
                                    title: `Release ${moneyFormat.format(hold.amount)}?`,
                                    submitLabel: 'Release',
                                    operation: 'banking.releaseHold',
                                    payload: { holdId: hold.id },
                                    success: 'Hold released.',
                                })}>
                                    Release
                                </Button>
                            )}
                        </TableCell>
                    </TableRow>
                ))}
            </ResultTable>
        </AllowlistSection>
    );
}


//MARK: Transactions
function TransactionsTab() {
    const { can } = useEverfallPermissions();
    const [search, setSearch] = useState('');
    const [iban, setIban] = useState('');
    const ledger = useEverfallQuery<BankingLedgerPage>(
        iban ? 'banking.transactions' : null,
        { iban, pageSize: 50, order: 'newest' },
    );
    const reverse = useReverse(() => ledger.mutate());

    const handleSearch = (event: React.FormEvent) => {
        event.preventDefault();
        setIban(search.trim());
    };

    return (
        <AllowlistSection
            title="Transactions"
            error={ledger.error}
            isLoading={!!iban && !ledger.data}
            emptyMessage={!iban
                ? 'Enter an account IBAN to see its transactions.'
                : ledger.data?.items.length === 0 ? 'This account has no transactions.' : null}
            controls={(
                <form className="flex gap-2" onSubmit={handleSearch}>
                    <Input
                        className="h-8 w-40"
                        placeholder="IBAN"
                        inputMode="numeric"
                        value={search}
                        onChange={(event) => setSearch(event.target.value)}
                    />
                    <Button size="sm" type="submit">Search</Button>
                </form>
            )}
        >
            <ResultTable heads={['Date', 'Account', 'Action', 'Description', 'Amount', '']}>
                {ledger.data && (
                    <TransactionRows
                        transactions={ledger.data.items}
                        canReverse={can('ReverseBankingTransaction')}
                        onReverse={reverse}
                    />
                )}
            </ResultTable>
        </AllowlistSection>
    );
}


export default function BankingPage() {
    const { can, isLoading, lacks } = useEverfallPermissions();
    const [tab, setTab] = useState('accounts');

    return (
        <div className="flex flex-col w-full gap-4 pb-4 [&>header]:mb-0">
            <PageHeader title="Banking" icon={<LandmarkIcon />} />
            {isLoading || !can('ViewBanking') ? (
                <div className="mx-2 md:mx-0">
                    <AllowlistSection
                        title="Banking"
                        isLoading={isLoading}
                        emptyMessage={lacks('View Banking')}
                    />
                </div>
            ) : (
                <div className="flex flex-col gap-4 mx-2 md:mx-0">
                    <Tabs value={tab} onValueChange={setTab}>
                        <TabsList>
                            {TABS.map((item) => (
                                <TabsTrigger key={item.key} value={item.key}>{item.label}</TabsTrigger>
                            ))}
                        </TabsList>
                    </Tabs>
                    {tab === 'accounts' && <AccountsTab />}
                    {tab === 'alerts' && <AlertsTab />}
                    {tab === 'holds' && <HoldsTab />}
                    {tab === 'transactions' && <TransactionsTab />}
                </div>
            )}
        </div>
    );
}
