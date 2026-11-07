import { useState } from "react";
import { Loader2Icon, PackageIcon, PlusIcon, SearchIcon } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { txToast } from "@/components/TxToaster";
import { useOpenPromptDialog } from "@/hooks/dialogs";
import { useEverfallPermissions, useEverfallQuery, useEverfallRequest } from "@/hooks/everfall";
import { cn } from "@/lib/utils";
import type {
    EverfallInventoryDetail,
    EverfallInventoryItem,
    EverfallInventoryReference,
    EverfallInventorySearch,
    EverfallInventorySummary,
    EverfallInventoryType,
} from "@shared/everfallApiTypes";


const searchTypes = [
    { value: 'all', label: 'All Types' },
    { value: 'player', label: 'Players' },
    { value: 'vehicle', label: 'Vehicles' },
    { value: 'stash', label: 'Stashes' },
];
const typeLabels: Record<EverfallInventoryType, string> = {
    player: 'Player',
    vehicle_trunk: 'Trunk',
    vehicle_glovebox: 'Glovebox',
    stash: 'Stash',
    container: 'Container',
};
const itemPattern = /^(\S+)(?:\s+(\d+))?$/;
const numberFormatter = new Intl.NumberFormat('en-US');

function formatWeight(grams?: number) {
    return grams === undefined ? '-' : `${numberFormatter.format(Math.round(grams / 100) / 10)} kg`;
}

function sameReference(a: EverfallInventoryReference, b: EverfallInventoryReference) {
    return a.inventoryType === b.inventoryType && a.storageKey === b.storageKey && (a.owner ?? '') === (b.owner ?? '');
}

function referenceOf({ inventoryType, storageKey, owner }: EverfallInventoryReference): EverfallInventoryReference {
    return { inventoryType, storageKey, owner };
}

function errorText(error: unknown) {
    return error instanceof Error ? error.message : String(error);
}


//MARK: Detail
type InventoryDetailCardProps = {
    reference: EverfallInventoryReference;
    canManage: boolean;
};
function InventoryDetailCard({ reference, canManage }: InventoryDetailCardProps) {
    const query = useEverfallQuery<EverfallInventoryDetail>('inventory.get', reference);
    const everfallRequest = useEverfallRequest();
    const openPromptDialog = useOpenPromptDialog();
    const detail = query.data;
    const items = detail ? Object.values(detail.items).sort((a, b) => a.slot - b.slot) : [];

    async function mutate(payload: Record<string, unknown>, loading: string, done: string) {
        if (!detail) return;
        const toastId = txToast.loading(loading);
        try {
            await everfallRequest('inventory.mutate', {
                ...reference,
                expectedRevision: detail.inventoryRevision,
                ...payload,
            });
            txToast.success(done, { id: toastId });
        } catch (error) {
            txToast.error(errorText(error), { id: toastId });
        }
        query.mutate();
    }

    function readReason(note: string) {
        const reason = note.trim();
        if (reason.length < 3) txToast.warning('Type a reason of at least 3 characters.');
        return reason.length < 3 ? null : reason;
    }

    function handleAdd() {
        openPromptDialog({
            title: `Add Item to ${detail?.label ?? 'Inventory'}`,
            message: 'Type the item name, then the quantity if more than one.',
            placeholder: 'water 5',
            submitLabel: 'Add',
            required: true,
            noteLabel: 'Reason',
            onSubmit: (input, note) => {
                const match = itemPattern.exec(input.trim());
                if (!match) return txToast.warning('Type the item name, then an optional quantity.');
                const reason = readReason(note);
                if (!reason) return;
                const count = match[2] ? Number(match[2]) : 1;
                mutate({
                    operation: 'add',
                    reason,
                    metadata: {},
                    items: [{ itemName: match[1], count, metadata: {} }],
                }, 'Adding item...', `Added ${count}x ${match[1]}.`);
            },
        });
    }

    function handleRemove(item: EverfallInventoryItem) {
        openPromptDialog({
            title: `Remove ${item.label ?? item.name} From Slot ${item.slot}`,
            message: `Type how many to remove, up to ${numberFormatter.format(item.count)}.`,
            placeholder: String(item.count),
            submitLabel: 'Remove',
            submitBtnVariant: 'destructive',
            required: true,
            noteLabel: 'Reason',
            onSubmit: (input, note) => {
                const count = Number(input.trim());
                if (!Number.isInteger(count) || count < 1 || count > item.count) {
                    return txToast.warning(`Type a whole number from 1 to ${item.count}.`);
                }
                const reason = readReason(note);
                if (!reason) return;
                mutate({
                    operation: 'remove',
                    reason,
                    itemName: item.name,
                    count,
                    slot: item.slot,
                }, 'Removing item...', `Removed ${count}x ${item.label ?? item.name}.`);
            },
        });
    }

    if (query.error) {
        return (
            <Alert variant="destructive" className="w-auto">
                <AlertTitle>Failed to Load Inventory</AlertTitle>
                <AlertDescription>{errorText(query.error)}</AlertDescription>
            </Alert>
        );
    }
    if (!detail) {
        return (
            <div className="flex items-center justify-center py-16 text-muted-foreground">
                <Loader2Icon className="animate-spin size-6 mr-2" /> Loading...
            </div>
        );
    }

    return (
        <div className="border rounded-lg bg-card">
            <div className="flex items-center justify-between gap-2 px-4 py-3 border-b">
                <div className="min-w-0">
                    <h2 className="font-semibold truncate">{detail.label}</h2>
                    <p className="text-xs text-muted-foreground space-x-3">
                        <span>{typeLabels[detail.inventoryType]}</span>
                        <span className="font-mono">{detail.storageKey}</span>
                        <span>{formatWeight(detail.weight)} of {formatWeight(detail.maxWeight)}</span>
                        {detail.slots !== undefined && <span>{detail.slots} Slots</span>}
                    </p>
                </div>
                {canManage && (
                    <Button size="sm" variant="outline" onClick={handleAdd}>
                        <PlusIcon className="size-4 mr-1" /> Add Item
                    </Button>
                )}
            </div>
            <Table>
                <TableHeader>
                    <TableRow className="hover:bg-transparent">
                        <TableHead className="w-16 text-right">Slot</TableHead>
                        <TableHead>Item</TableHead>
                        <TableHead className="text-right">Count</TableHead>
                        {canManage && <TableHead className="w-24" />}
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {items.map((item) => (
                        <TableRow key={item.slot}>
                            <TableCell className="text-right tabular-nums text-muted-foreground">{item.slot}</TableCell>
                            <TableCell>
                                {item.label ?? item.name}
                                {item.label && <span className="ml-2 text-xs font-mono text-muted-foreground">{item.name}</span>}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">{numberFormatter.format(item.count)}</TableCell>
                            {canManage && (
                                <TableCell className="text-right py-1">
                                    <Button size="sm" variant="ghost" onClick={() => handleRemove(item)}>Remove</Button>
                                </TableCell>
                            )}
                        </TableRow>
                    ))}
                    {!items.length && (
                        <TableRow className="hover:bg-transparent">
                            <TableCell colSpan={canManage ? 4 : 3} className="text-center text-muted-foreground py-8">
                                This inventory is empty.
                            </TableCell>
                        </TableRow>
                    )}
                </TableBody>
            </Table>
        </div>
    );
}


//MARK: Page
export default function InventoriesPage() {
    const { can, data: permissions } = useEverfallPermissions();
    const [search, setSearch] = useState({ query: '', inventoryType: 'all', page: 1 });
    const [selected, setSelected] = useState<EverfallInventoryReference | null>(null);
    const canView = can('ViewInventories');
    const results = useEverfallQuery<EverfallInventorySearch>(canView ? 'inventory.search' : null, search);
    const rows: EverfallInventorySummary[] = results.data ? Object.values(results.data.rows) : [];

    function handleSearch(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault();
        const query = new FormData(event.currentTarget).get('query');
        setSearch({ ...search, query: typeof query === 'string' ? query.trim() : '', page: 1 });
    }

    return (
        <div className="flex flex-col w-full gap-4 pb-4 [&>header]:mb-0">
            <PageHeader title="Inventories" icon={<PackageIcon />} />

            {permissions && !canView ? (
                <Alert variant="destructive" className="mx-2 md:mx-0 w-auto">
                    <AlertTitle>No Access</AlertTitle>
                    <AlertDescription>Your Everfall staff rank does not include ViewInventories.</AlertDescription>
                </Alert>
            ) : (
                <div className="flex flex-col gap-4 mx-2 md:mx-0">
                    <form className="flex flex-wrap gap-2" onSubmit={handleSearch}>
                        <Input
                            name="query"
                            defaultValue={search.query}
                            placeholder="Character, citizen ID, plate or stash"
                            className="h-9 flex-1 min-w-48"
                            autoComplete="off"
                        />
                        <Select
                            value={search.inventoryType}
                            onValueChange={(inventoryType) => setSearch({ ...search, inventoryType, page: 1 })}
                        >
                            <SelectTrigger className="w-36 h-9">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {searchTypes.map((option) => (
                                    <SelectItem key={option.value} value={option.value} className="cursor-pointer">
                                        {option.label}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        <Button type="submit" size="sm" className="h-9">
                            <SearchIcon className="size-4 mr-1" /> Search
                        </Button>
                    </form>

                    {results.error ? (
                        <Alert variant="destructive" className="w-auto">
                            <AlertTitle>Failed to Search Inventories</AlertTitle>
                            <AlertDescription>{errorText(results.error)}</AlertDescription>
                        </Alert>
                    ) : !results.data ? (
                        <div className="flex items-center justify-center py-16 text-muted-foreground">
                            <Loader2Icon className="animate-spin size-6 mr-2" /> Loading...
                        </div>
                    ) : (
                        <div className="border rounded-lg overflow-x-auto bg-card">
                            <Table>
                                <TableHeader>
                                    <TableRow className="hover:bg-transparent">
                                        <TableHead>Inventory</TableHead>
                                        <TableHead>Type</TableHead>
                                        <TableHead>Key</TableHead>
                                        <TableHead className="text-right">Slots Used</TableHead>
                                        <TableHead className="text-right">Weight</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {rows.map((row) => (
                                        <TableRow
                                            key={`${row.inventoryType}:${row.storageKey}:${row.owner ?? ''}`}
                                            className={cn('cursor-pointer', selected && sameReference(selected, row) && 'bg-muted')}
                                            onClick={() => setSelected(referenceOf(row))}
                                        >
                                            <TableCell className="font-semibold">
                                                {row.label}
                                                {row.serverId !== undefined && (
                                                    <span className="ml-2 text-xs font-normal text-muted-foreground">#{row.serverId}</span>
                                                )}
                                            </TableCell>
                                            <TableCell className="whitespace-nowrap">{typeLabels[row.inventoryType]}</TableCell>
                                            <TableCell className="font-mono text-xs">{row.storageKey}</TableCell>
                                            <TableCell className="text-right tabular-nums">{row.itemCount}</TableCell>
                                            <TableCell className="text-right tabular-nums whitespace-nowrap">
                                                {formatWeight(row.weight)}
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                    {!rows.length && (
                                        <TableRow className="hover:bg-transparent">
                                            <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                                                No inventories found.
                                            </TableCell>
                                        </TableRow>
                                    )}
                                </TableBody>
                            </Table>
                            {(search.page > 1 || results.data.hasMore) && (
                                <div className="flex items-center justify-end gap-2 px-4 py-2 border-t text-sm">
                                    <span className="text-muted-foreground mr-auto">Page {search.page}</span>
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        disabled={search.page <= 1}
                                        onClick={() => setSearch({ ...search, page: search.page - 1 })}
                                    >
                                        Previous
                                    </Button>
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        disabled={!results.data.hasMore}
                                        onClick={() => setSearch({ ...search, page: search.page + 1 })}
                                    >
                                        Next
                                    </Button>
                                </div>
                            )}
                        </div>
                    )}

                    {selected && (
                        <InventoryDetailCard
                            key={`${selected.inventoryType}:${selected.storageKey}:${selected.owner ?? ''}`}
                            reference={selected}
                            canManage={can('ManageInventories')}
                        />
                    )}
                </div>
            )}
        </div>
    );
}
