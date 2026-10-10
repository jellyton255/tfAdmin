import { useState } from "react";
import useSWR from "swr";
import { useAtom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import {
    ChevronDownIcon,
    ChevronsDownUpIcon,
    ChevronsUpDownIcon,
    Loader2Icon,
    PackageIcon,
    RefreshCwIcon,
    SearchIcon,
} from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { ApiTimeout, useBackendApi } from "@/hooks/fetch";
import { useAdminPerms } from "@/hooks/auth";
import { createValidatedStorage, LocalStorageKey } from "@/lib/localStorage";
import { cn } from "@/lib/utils";
import type { ApiToastResp } from "@shared/genericApiTypes";
import type { ResourceGroupType, ResourceItemType, ResourcesListResp } from "@shared/resourcesApiTypes";


//Resources shipped with FXServer (or from very old cfx-server-data versions)
const defaultResources = new Set([
    'baseevents', 'basic-gamemode', 'betaguns', 'channelfeed', 'chat-theme-gtao', 'chat',
    'example-loadscreen', 'fivem-awesome1501', 'fivem-map-hipster', 'fivem-map-skater', 'fivem',
    'gameInit', 'hardcap', 'irc', 'keks', 'mapmanager', 'money-fountain-example-map',
    'money-fountain', 'money', 'monitor', 'obituary-deaths', 'obituary', 'ped-money-drops',
    'player-data', 'playernames', 'race-test', 'race', 'rconlog', 'redm-map-one', 'runcode',
    'scoreboard', 'sessionmanager-rdr3', 'sessionmanager', 'spawnmanager', 'webadmin', 'webpack',
    'yarn',
]);

//FXServer applies resource commands asynchronously, so give it a moment before re-fetching
const REFETCH_DELAY_MS = 1000;


//MARK: Persisted options
type PageOptions = {
    search: string;
    showDefault: boolean;
    onlyStopped: boolean;
    collapsed: string[];
};
const defaultPageOptions: PageOptions = {
    search: '',
    showDefault: false,
    onlyStopped: false,
    collapsed: [],
};
const validatePageOptions = (value: unknown): PageOptions => {
    if (typeof value !== 'object' || value === null) return defaultPageOptions;
    return {
        search: 'search' in value && typeof value.search === 'string' ? value.search : '',
        showDefault: 'showDefault' in value && value.showDefault === true,
        onlyStopped: 'onlyStopped' in value && value.onlyStopped === true,
        collapsed: 'collapsed' in value && Array.isArray(value.collapsed)
            ? value.collapsed.filter((item): item is string => typeof item === 'string')
            : [],
    };
};
const pageOptionsAtom = atomWithStorage<PageOptions>(
    LocalStorageKey.ResourcesPageOptions,
    defaultPageOptions,
    createValidatedStorage(validatePageOptions, defaultPageOptions),
);


//MARK: ResourceRow
type ResourceRowProps = {
    resource: ResourceItemType;
    canControl: boolean;
    isPending: boolean;
    onCommand: (action: 'ensure_res' | 'stop_res', resource: string) => void;
};

function ResourceRow({ resource, canControl, isPending, onCommand }: ResourceRowProps) {
    const isStarted = resource.status === 'started';
    return (
        <TableRow>
            <TableCell className="py-2.5">
                <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-semibold break-all">{resource.name}</span>
                    {resource.version && (
                        <span className="text-xs text-muted-foreground">v{resource.version.replace(/^v/i, '')}</span>
                    )}
                    {resource.author && (
                        <span className="text-xs text-muted-foreground">by {resource.author}</span>
                    )}
                </div>
                {resource.description && (
                    <div className="text-sm text-muted-foreground line-clamp-2">{resource.description}</div>
                )}
            </TableCell>
            <TableCell className="w-28 py-2.5">
                <Badge
                    variant="outline"
                    className={cn(
                        'capitalize font-normal',
                        isStarted
                            ? 'bg-success/15 text-success border-success/30'
                            : 'bg-destructive/15 text-destructive border-destructive/30',
                    )}
                >
                    {resource.status}
                </Badge>
            </TableCell>
            <TableCell className="w-44 py-2.5">
                <div className="flex justify-end gap-2">
                    {isStarted ? (<>
                        <Button
                            size="xs"
                            variant="outline-warning"
                            disabled={!canControl || isPending}
                            onClick={() => onCommand('ensure_res', resource.name)}
                        >
                            Restart
                        </Button>
                        <Button
                            size="xs"
                            variant="outline-destructive"
                            disabled={!canControl || isPending}
                            onClick={() => onCommand('stop_res', resource.name)}
                        >
                            Stop
                        </Button>
                    </>) : (
                        <Button
                            size="xs"
                            variant="outline-success"
                            disabled={!canControl || isPending}
                            onClick={() => onCommand('ensure_res', resource.name)}
                        >
                            Start
                        </Button>
                    )}
                </div>
            </TableCell>
        </TableRow>
    );
}


//MARK: ResourceGroup
type ResourceGroupProps = {
    group: ResourceGroupType;
    isCollapsed: boolean;
    onToggle: () => void;
    children: React.ReactNode;
};

function ResourceGroup({ group, isCollapsed, onToggle, children }: ResourceGroupProps) {
    return (
        <section className="border rounded-lg bg-card overflow-hidden">
            <button
                type="button"
                className="w-full flex items-center gap-2 px-4 py-3 text-left hover:bg-muted/50 transition-colors"
                onClick={onToggle}
                aria-expanded={!isCollapsed}
            >
                <ChevronDownIcon className={cn('size-4 shrink-0 text-muted-foreground transition-transform', isCollapsed && '-rotate-90')} />
                <span className="font-mono text-sm font-semibold break-all">{group.subPath}</span>
                <span className="ml-auto text-xs text-muted-foreground tabular-nums">{group.resources.length}</span>
            </button>
            {!isCollapsed && (
                <div className="border-t">
                    <Table>
                        <TableBody>{children}</TableBody>
                    </Table>
                </div>
            )}
        </section>
    );
}


//MARK: Page
export default function ResourcesPage() {
    const { hasPerm } = useAdminPerms();
    const canControl = hasPerm('commands.resources');
    const [options, setOptions] = useAtom(pageOptionsAtom);
    const [pendingResource, setPendingResource] = useState<string | null>(null);
    const [isRefreshing, setIsRefreshing] = useState(false);

    const listApi = useBackendApi<ResourcesListResp>({
        method: 'GET',
        path: '/resources/list',
    });
    const commandsApi = useBackendApi<ApiToastResp>({
        method: 'POST',
        path: '/fxserver/commands',
    });

    const swr = useSWR('/resources/list', async () => {
        const resp = await listApi({ timeout: ApiTimeout.LONG });
        if (!resp) throw new Error('No data returned.');
        if ('error' in resp) throw new Error(resp.error);
        return resp.groups;
    }, {
        revalidateOnFocus: false,
    });

    const updateOptions = (newOptions: Partial<PageOptions>) => {
        setOptions((prev) => ({ ...prev, ...newOptions }));
    };
    const scheduleRefetch = () => {
        setTimeout(() => {
            swr.mutate();
        }, REFETCH_DELAY_MS);
    };

    const handleCommand = async (action: 'ensure_res' | 'stop_res', resource: string) => {
        setPendingResource(resource);
        const resp = await commandsApi({
            data: { action, parameter: resource },
            toastLoadingMessage: 'Executing Command...',
            finally: () => setPendingResource(null),
        });
        if (resp && resp.type !== 'error') scheduleRefetch();
    };

    const handleRefresh = async () => {
        setIsRefreshing(true);
        const resp = await commandsApi({
            data: { action: 'refresh_res', parameter: '' },
            timeout: ApiTimeout.LONG,
            toastLoadingMessage: 'Refreshing Resources...',
            finally: () => setIsRefreshing(false),
        });
        if (resp && resp.type !== 'error') scheduleRefetch();
    };

    //Filtering
    const searchLower = options.search.trim().toLowerCase();
    const visibleGroups = (swr.data ?? [])
        .map((group) => ({
            ...group,
            resources: group.resources.filter((res) => {
                if (!options.showDefault && defaultResources.has(res.name)) return false;
                if (options.onlyStopped && res.status !== 'stopped') return false;
                return !searchLower || res.name.toLowerCase().includes(searchLower);
            }),
        }))
        .filter((group) => group.resources.length);
    const collapsedSet = new Set(options.collapsed);
    const allExpanded = visibleGroups.every((group) => !collapsedSet.has(group.subPath));

    const toggleGroup = (subPath: string) => {
        const collapsed = collapsedSet.has(subPath)
            ? options.collapsed.filter((item) => item !== subPath)
            : [...options.collapsed, subPath];
        updateOptions({ collapsed });
    };
    const toggleAllGroups = () => {
        updateOptions({
            collapsed: allExpanded ? (swr.data ?? []).map((group) => group.subPath) : [],
        });
    };

    //Rendering
    let content: React.ReactNode;
    if (swr.error) {
        content = (
            <Alert variant="destructive">
                <AlertTitle>Failed to Load Resources</AlertTitle>
                <AlertDescription className="space-y-3">
                    <p>{swr.error instanceof Error ? swr.error.message : String(swr.error)}</p>
                    <Button size="xs" variant="outline-destructive" onClick={() => swr.mutate()}>
                        Try Again
                    </Button>
                </AlertDescription>
            </Alert>
        );
    } else if (!swr.data) {
        content = (
            <div className="flex items-center justify-center py-16 text-muted-foreground">
                <Loader2Icon className="animate-spin size-6 mr-2" /> Loading...
            </div>
        );
    } else if (!visibleGroups.length) {
        content = (
            <div className="text-center py-16 text-muted-foreground border rounded-lg border-dashed">
                No resources match the current filters.
            </div>
        );
    } else {
        content = visibleGroups.map((group) => (
            <ResourceGroup
                key={group.subPath}
                group={group}
                isCollapsed={collapsedSet.has(group.subPath)}
                onToggle={() => toggleGroup(group.subPath)}
            >
                {group.resources.map((resource) => (
                    <ResourceRow
                        key={resource.name}
                        resource={resource}
                        canControl={canControl}
                        isPending={pendingResource === resource.name}
                        onCommand={handleCommand}
                    />
                ))}
            </ResourceGroup>
        ));
    }

    return (
        <div className="flex flex-col w-full max-w-screen-lg mx-auto">
            <PageHeader title="Resources" icon={<PackageIcon />}>
                <Button
                    size="sm"
                    disabled={!canControl || isRefreshing}
                    onClick={handleRefresh}
                >
                    <RefreshCwIcon className={cn('size-4 mr-1.5', (isRefreshing || swr.isValidating) && 'animate-spin')} />
                    Reload and Refresh
                </Button>
            </PageHeader>

            <div className="flex flex-col gap-4 px-2 md:px-0 pb-4">
                <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
                    <div className="relative grow min-w-60">
                        <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                        <Input
                            className="pl-9"
                            placeholder="Find Resource by Name"
                            value={options.search}
                            onChange={(e) => updateOptions({ search: e.target.value })}
                        />
                    </div>
                    <div className="flex items-center gap-2">
                        <Switch
                            id="resources-show-default"
                            checked={options.showDefault}
                            onCheckedChange={(showDefault) => updateOptions({ showDefault })}
                        />
                        <Label htmlFor="resources-show-default">Default Resources</Label>
                    </div>
                    <div className="flex items-center gap-2">
                        <Switch
                            id="resources-only-stopped"
                            checked={options.onlyStopped}
                            onCheckedChange={(onlyStopped) => updateOptions({ onlyStopped })}
                        />
                        <Label htmlFor="resources-only-stopped">Only Stopped</Label>
                    </div>
                    <Button
                        size="sm"
                        variant="outline-muted"
                        disabled={!visibleGroups.length}
                        onClick={toggleAllGroups}
                    >
                        {allExpanded ? (
                            <><ChevronsDownUpIcon className="size-4 mr-1.5" /> Collapse All</>
                        ) : (
                            <><ChevronsUpDownIcon className="size-4 mr-1.5" /> Expand All</>
                        )}
                    </Button>
                </div>

                {content}
            </div>
        </div>
    );
}
