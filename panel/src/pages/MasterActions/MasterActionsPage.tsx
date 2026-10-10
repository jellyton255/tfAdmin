import { useState } from "react";
import { Link } from "wouter";
import { DatabaseBackupIcon, ShieldAlertIcon, Trash2Icon, UserXIcon } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SettingItem, SettingItemDesc } from "@/pages/Settings/settingsItems";
import InlineCode from "@/components/InlineCode";
import { txToast } from "@/components/TxToaster";
import { ApiTimeout, useBackendApi } from "@/hooks/fetch";
import { useAdminPerms } from "@/hooks/auth";
import { useOpenConfirmDialog } from "@/hooks/dialogs";
import type {
    MasterActionsCleanDatabaseReq,
    MasterActionsCleanDatabaseResp,
    MasterActionsRevokeWhitelistsReq,
    MasterActionsRevokeWhitelistsResp,
} from "@shared/masterActionsApiTypes";


//MARK: Options
type Option<T extends string> = { value: T; label: string; danger?: boolean };

const playersOptions: Option<MasterActionsCleanDatabaseReq['players']>[] = [
    { value: 'none', label: 'None' },
    { value: '60d', label: 'Inactive Over 60 Days' },
    { value: '30d', label: 'Inactive Over 30 Days' },
    { value: '15d', label: 'Inactive Over 15 Days' },
];
const bansOptions: Option<MasterActionsCleanDatabaseReq['bans']>[] = [
    { value: 'none', label: 'None' },
    { value: 'revoked', label: 'Revoked' },
    { value: 'revokedExpired', label: 'Revoked or Expired' },
    { value: 'all', label: 'Remove All Bans', danger: true },
];
const warnsOptions: Option<MasterActionsCleanDatabaseReq['warns']>[] = [
    { value: 'none', label: 'None' },
    { value: 'revoked', label: 'Revoked' },
    { value: '30d', label: 'Older Than 30 Days' },
    { value: '15d', label: 'Older Than 15 Days' },
    { value: '7d', label: 'Older Than 7 Days' },
    { value: 'all', label: 'Remove All Warns', danger: true },
];
const hwidsOptions: Option<MasterActionsCleanDatabaseReq['hwids']>[] = [
    { value: 'none', label: 'None' },
    { value: 'players', label: 'From Players' },
    { value: 'bans', label: 'From Bans' },
    { value: 'all', label: 'Remove All HWIDs', danger: true },
];
const revokeOptions: Option<MasterActionsRevokeWhitelistsReq['filter']>[] = [
    { value: '30d', label: 'Not Joined in the Last 30 Days' },
    { value: '15d', label: 'Not Joined in the Last 15 Days' },
    { value: '7d', label: 'Not Joined in the Last 7 Days' },
    { value: 'all', label: 'Revoke All Allowlists', danger: true },
];

const tabIds = ['general', 'cleandb', 'revokewl'];
const getInitialTab = () => {
    const hash = window.location.hash.slice(1);
    return tabIds.includes(hash) ? hash : 'general';
};


//MARK: OptionSelect
type OptionSelectProps<T extends string> = {
    id: string;
    options: Option<T>[];
    value: Option<T>;
    onChange: (option: Option<T>) => void;
    disabled: boolean;
};

function OptionSelect<T extends string>({ id, options, value, onChange, disabled }: OptionSelectProps<T>) {
    return (
        <Select
            value={value.value}
            disabled={disabled}
            onValueChange={(newValue) => {
                const option = options.find((opt) => opt.value === newValue);
                if (option) onChange(option);
            }}
        >
            <SelectTrigger id={id} className="max-w-sm">
                <SelectValue />
            </SelectTrigger>
            <SelectContent>
                {options.map((opt) => (
                    <SelectItem
                        key={opt.value}
                        value={opt.value}
                        className={opt.danger ? 'font-semibold text-destructive' : undefined}
                    >
                        {opt.label}
                    </SelectItem>
                ))}
            </SelectContent>
        </Select>
    );
}


//MARK: General
function GeneralTab({ disabled }: { disabled: boolean }) {
    return (
        <Card>
            <CardContent className="divide-y p-0">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-6">
                    <div className="space-y-1">
                        <h3 className="font-semibold">Reset FXServer</h3>
                        <p className="text-sm text-muted-foreground">
                            This option is in the FXServer tab of the Settings page.
                        </p>
                    </div>
                    <Button size="sm" variant="outline-muted" asChild>
                        <Link href="/settings#fxserver">Go to Settings</Link>
                    </Button>
                </div>
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-6">
                    <div className="space-y-1">
                        <h3 className="font-semibold">Back Up Database</h3>
                        <p className="text-sm text-muted-foreground">
                            Download a copy of <InlineCode>playersDB.json</InlineCode> with all players,
                            actions, and allowlist requests.
                        </p>
                    </div>
                    {disabled ? (
                        <Button size="sm" variant="outline-destructive" disabled>
                            <DatabaseBackupIcon className="size-4 mr-1.5" /> Back Up Database
                        </Button>
                    ) : (
                        <Button size="sm" variant="outline-destructive" asChild>
                            <a href="/masterActions/backupDatabase" download>
                                <DatabaseBackupIcon className="size-4 mr-1.5" /> Back Up Database
                            </a>
                        </Button>
                    )}
                </div>
            </CardContent>
        </Card>
    );
}


//MARK: Clean Database
function CleanDatabaseTab({ disabled }: { disabled: boolean }) {
    const openConfirmDialog = useOpenConfirmDialog();
    const [players, setPlayers] = useState(playersOptions[1]);
    const [bans, setBans] = useState(bansOptions[1]);
    const [warns, setWarns] = useState(warnsOptions[2]);
    const [hwids, setHwids] = useState(hwidsOptions[0]);
    const cleanApi = useBackendApi<MasterActionsCleanDatabaseResp, MasterActionsCleanDatabaseReq>({
        method: 'POST',
        path: '/masterActions/cleanDatabase',
    });

    const handleSubmit = () => {
        const changes = [
            players.value !== 'none' && `Players: ${players.label}`,
            bans.value !== 'none' && `Bans: ${bans.label}`,
            warns.value !== 'none' && `Warns: ${warns.label}`,
            hwids.value !== 'none' && `HWIDs: ${hwids.label}`,
        ].filter((change): change is string => typeof change === 'string');
        if (!changes.length) {
            txToast.error('Select at least one option.');
            return;
        }

        openConfirmDialog({
            title: 'Clean Database',
            message: (
                <ul className="list-disc pl-5 space-y-1">
                    {changes.map((change) => <li key={change}>{change}</li>)}
                </ul>
            ),
            actionLabel: 'Clean Database',
            confirmBtnVariant: 'destructive',
            onConfirm: async () => {
                const resp = await cleanApi({
                    data: {
                        players: players.value,
                        bans: bans.value,
                        warns: warns.value,
                        hwids: hwids.value,
                    },
                    timeout: ApiTimeout.REALLY_LONG,
                    toastLoadingMessage: 'Cleaning Database...',
                });
                if (!resp) return;
                if ('error' in resp) {
                    txToast.error({ title: 'Failed to Clean Database', msg: resp.error });
                    return;
                }
                txToast.success({
                    title: 'Database Cleaned',
                    md: true,
                    msg: [
                        `Players removed: **${resp.playersRemoved}**`,
                        `Actions removed: **${resp.actionsRemoved}**`,
                        `HWIDs removed: **${resp.hwidsRemoved}**`,
                        `Finished in ${resp.msElapsed}ms.`,
                    ].join('  \n'),
                });
            },
        });
    };

    return (
        <Card>
            <CardHeader>
                <CardTitle className="text-lg">Clean Database</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
                <Alert variant="warning">
                    <AlertDescription>
                        This action cannot be undone. Back up the database first.
                    </AlertDescription>
                </Alert>
                <SettingItem label="Players" htmlFor="cleandb-players">
                    <OptionSelect id="cleandb-players" options={playersOptions} value={players} onChange={setPlayers} disabled={disabled} />
                    <SettingItemDesc>
                        Players with saved notes are kept. Ban and warn records are not affected.
                    </SettingItemDesc>
                </SettingItem>
                <SettingItem label="Bans" htmlFor="cleandb-bans">
                    <OptionSelect id="cleandb-bans" options={bansOptions} value={bans} onChange={setBans} disabled={disabled} />
                </SettingItem>
                <SettingItem label="Warns" htmlFor="cleandb-warns">
                    <OptionSelect id="cleandb-warns" options={warnsOptions} value={warns} onChange={setWarns} disabled={disabled} />
                </SettingItem>
                <SettingItem label="HWIDs" htmlFor="cleandb-hwids">
                    <OptionSelect id="cleandb-hwids" options={hwidsOptions} value={hwids} onChange={setHwids} disabled={disabled} />
                    <SettingItemDesc>
                        HWIDs are tied to the server owner. If you change <InlineCode>sv_licenseKey</InlineCode> to
                        one owned by another person, wipe the existing HWIDs.
                    </SettingItemDesc>
                </SettingItem>
                <Button size="sm" variant="destructive" disabled={disabled} onClick={handleSubmit}>
                    <Trash2Icon className="size-4 mr-1.5" /> Clean Database
                </Button>
            </CardContent>
        </Card>
    );
}


//MARK: Revoke Allowlists
function RevokeAllowlistsTab({ disabled }: { disabled: boolean }) {
    const openConfirmDialog = useOpenConfirmDialog();
    const [filter, setFilter] = useState(revokeOptions[0]);
    const revokeApi = useBackendApi<MasterActionsRevokeWhitelistsResp, MasterActionsRevokeWhitelistsReq>({
        method: 'POST',
        path: '/masterActions/revokeWhitelists',
    });

    const handleSubmit = () => {
        openConfirmDialog({
            title: 'Revoke Allowlists',
            message: filter.value === 'all'
                ? 'Revoke the allowlist of every allowlisted player.'
                : `Revoke the allowlist of every player that has not joined in the last ${parseInt(filter.value)} days.`,
            actionLabel: 'Revoke',
            confirmBtnVariant: 'destructive',
            onConfirm: async () => {
                const resp = await revokeApi({
                    data: { filter: filter.value },
                    timeout: ApiTimeout.REALLY_LONG,
                    toastLoadingMessage: 'Revoking Allowlists...',
                });
                if (!resp) return;
                if ('error' in resp) {
                    txToast.error({ title: 'Failed to Revoke Allowlists', msg: resp.error });
                    return;
                }
                txToast.success({
                    title: 'Allowlists Revoked',
                    md: true,
                    msg: `Allowlists revoked: **${resp.cntRemoved}**  \nFinished in ${resp.msElapsed}ms.`,
                });
            },
        });
    };

    return (
        <Card>
            <CardHeader>
                <CardTitle className="text-lg">Revoke Allowlists</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
                <SettingItem label="Filter" htmlFor="revokewl-filter">
                    <OptionSelect id="revokewl-filter" options={revokeOptions} value={filter} onChange={setFilter} disabled={disabled} />
                    <SettingItemDesc>
                        Only license allowlists are revoked. Discord member and Discord role allowlists are not affected.
                    </SettingItemDesc>
                </SettingItem>
                <Button size="sm" variant="destructive" disabled={disabled} onClick={handleSubmit}>
                    <UserXIcon className="size-4 mr-1.5" /> Revoke Allowlists
                </Button>
            </CardContent>
        </Card>
    );
}


//MARK: Page
export default function MasterActionsPage() {
    const { isMaster } = useAdminPerms();
    const isWebInterface = window.txConsts.isWebInterface;
    const disabled = !isMaster || !isWebInterface;

    return (
        <div className="flex flex-col w-full max-w-screen-lg mx-auto">
            <PageHeader title="Master Actions" icon={<ShieldAlertIcon />} />
            <div className="flex flex-col gap-4 px-2 md:px-0">
                {!isMaster && (
                    <Alert variant="warning">
                        <AlertDescription>Only the master admin can use these actions.</AlertDescription>
                    </Alert>
                )}
                {!isWebInterface && (
                    <Alert variant="warning">
                        <AlertDescription>These actions are not available in the in-game menu. Use the web panel.</AlertDescription>
                    </Alert>
                )}
                <Tabs defaultValue={getInitialTab()}>
                    <TabsList>
                        <TabsTrigger value="general">General</TabsTrigger>
                        <TabsTrigger value="cleandb">Clean Database</TabsTrigger>
                        <TabsTrigger value="revokewl">Revoke Allowlists</TabsTrigger>
                    </TabsList>
                    <TabsContent value="general">
                        <GeneralTab disabled={disabled} />
                    </TabsContent>
                    <TabsContent value="cleandb">
                        <CleanDatabaseTab disabled={disabled} />
                    </TabsContent>
                    <TabsContent value="revokewl">
                        <RevokeAllowlistsTab disabled={disabled} />
                    </TabsContent>
                </Tabs>
            </div>
        </div>
    );
}
