import { useState } from "react";
import useSWR from "swr";
import { ChevronRightIcon, Loader2Icon, LockIcon, PlusIcon, UserCogIcon, UsersIcon } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { txToast } from "@/components/TxToaster";
import { useBackendApi } from "@/hooks/fetch";
import { useOpenAccountModal, useOpenConfirmDialog } from "@/hooks/dialogs";
import type {
    AdminManagerAdmin,
    AdminManagerDeleteReq,
    AdminManagerDeleteResp,
    AdminManagerListResp,
    AdminManagerRemovePasskeysReq,
    AdminManagerRemovePasskeysResp,
} from "@shared/adminManagerApiTypes";
import AdminFormDialog, { type AdminFormValues } from "./AdminFormDialog";
import AdminPasswordDialog from "./AdminPasswordDialog";

const LIST_SWR_KEY = '/adminManager/list';

type FormState = {
    mode: 'add' | 'edit';
    initialValues: AdminFormValues;
    admin?: AdminManagerAdmin;
};

/**
 * The player modal "Give Admin" button links here with
 * ?autofill=true&name=<name>&citizenfx=fivem:<id>&discord=discord:<id>
 */
function getAutofillState(): FormState | null {
    const params = new URLSearchParams(window.location.search);
    if (!params.has('autofill')) return null;
    const discord = params.get('discord') ?? '';
    return {
        mode: 'add',
        initialValues: {
            name: params.get('name') ?? '',
            citizenfxID: params.get('citizenfx') ?? '',
            discordID: discord.includes(':') ? discord.split(':')[1] : discord,
            permissions: [],
        },
    };
}

function clearUrlSearch() {
    if (!window.location.search) return;
    const newUrl = new URL(window.location.toString());
    newUrl.search = '';
    window.history.replaceState({}, '', newUrl);
}

function getPermsSummary(admin: AdminManagerAdmin) {
    if (admin.isMaster) return 'Master Account';
    if (admin.permissions.includes('all_permissions')) return 'All Permissions';
    if (admin.permissions.length === 1) return '1 Permission';
    return `${admin.permissions.length} Permissions`;
}


function AdminRow({ admin, onEdit, onOpenAccount }: {
    admin: AdminManagerAdmin;
    onEdit: (admin: AdminManagerAdmin) => void;
    onOpenAccount: () => void;
}) {
    const loginMethods = [
        admin.citizenfxIdentifier && 'Cfx.re',
        admin.discordId && 'Discord',
        admin.passkeyCount && (admin.passkeyCount === 1 ? '1 Passkey' : `${admin.passkeyCount} Passkeys`),
    ].filter(Boolean).join(' · ');
    const isClickable = admin.isSelf || admin.canEdit;

    return (
        <button
            type="button"
            disabled={!isClickable}
            title={isClickable ? undefined : 'Only the master account can edit a master admin.'}
            onClick={() => admin.isSelf ? onOpenAccount() : onEdit(admin)}
            className="group w-full grid grid-cols-[1fr_auto] md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_1.5rem] items-center gap-x-4 gap-y-1
                px-4 py-3 text-left transition-colors hover:bg-muted/50 disabled:hover:bg-transparent
                focus-visible:outline-none focus-visible:bg-muted/50"
        >
            <div className="flex items-center gap-2 min-w-0">
                <span className="font-semibold truncate">{admin.name}</span>
                {admin.isMaster && <Badge variant="outline" className="border-warning/40 text-warning shrink-0">Master</Badge>}
                {admin.isSelf && <Badge variant="secondary" className="shrink-0">You</Badge>}
            </div>
            <div className="row-start-2 md:row-start-auto text-sm text-muted-foreground truncate">
                {getPermsSummary(admin)}
            </div>
            <div className="row-start-3 md:row-start-auto text-sm text-muted-foreground truncate">
                {loginMethods || 'Password Only'}
            </div>
            <div className="row-span-3 md:row-span-1 col-start-2 md:col-start-auto row-start-1 justify-self-end text-muted-foreground">
                {admin.isSelf ? (
                    <UserCogIcon className="size-4 group-hover:text-foreground" />
                ) : admin.canEdit ? (
                    <ChevronRightIcon className="size-4 group-hover:text-foreground" />
                ) : (
                    <LockIcon className="size-4 opacity-60" />
                )}
            </div>
        </button>
    );
}


export default function AdminsPage() {
    const openConfirmDialog = useOpenConfirmDialog();
    const openAccountModal = useOpenAccountModal();
    const [formState, setFormState] = useState<FormState | null>(getAutofillState);
    const [newPassword, setNewPassword] = useState<{ name: string; password: string } | null>(null);

    const listApi = useBackendApi<AdminManagerListResp>({
        method: 'GET',
        path: LIST_SWR_KEY,
    });
    const deleteApi = useBackendApi<AdminManagerDeleteResp, AdminManagerDeleteReq>({
        method: 'POST',
        path: '/adminManager/delete',
    });

    const removePasskeysApi = useBackendApi<AdminManagerRemovePasskeysResp, AdminManagerRemovePasskeysReq>({
        method: 'POST',
        path: '/adminManager/removePasskeys',
    });

    const swr = useSWR(LIST_SWR_KEY, async () => {
        const resp = await listApi({});
        if (!resp) throw new Error('No data returned.');
        if ('error' in resp) throw new Error(resp.error);
        return resp;
    });

    const closeForm = () => {
        clearUrlSearch();
        setFormState(null);
    };

    const handleSaved = (name: string, password: string | null) => {
        closeForm();
        swr.mutate();
        if (password) {
            setNewPassword({ name, password });
        } else {
            txToast.success(`Saved ${name}.`);
        }
    };

    const handleEdit = (admin: AdminManagerAdmin) => {
        setFormState({
            mode: 'edit',
            admin,
            initialValues: {
                name: admin.name,
                citizenfxID: admin.citizenfxId ?? '',
                discordID: admin.discordId ?? '',
                permissions: admin.permissions,
            },
        });
    };

    //The confirm dialog replaces the edit dialog instead of stacking on it
    const handleDelete = (admin: AdminManagerAdmin) => {
        closeForm();
        openConfirmDialog({
            title: `Delete ${admin.name}?`,
            message: 'This admin will lose access to the panel immediately.',
            actionLabel: 'Delete',
            confirmBtnVariant: 'destructive',
            onConfirm: async () => {
                await deleteApi({
                    data: { name: admin.name },
                    toastLoadingMessage: 'Deleting admin...',
                    genericHandler: { successMsg: `Deleted ${admin.name}.` },
                });
                swr.mutate();
            },
        });
    };

    const handleRemovePasskeys = (admin: AdminManagerAdmin) => {
        closeForm();
        openConfirmDialog({
            title: `Remove ${admin.name}'s passkeys?`,
            message: `All ${admin.passkeyCount} passkey(s) will stop working, and sessions started with them will be signed out.`,
            actionLabel: 'Remove',
            confirmBtnVariant: 'destructive',
            onConfirm: async () => {
                await removePasskeysApi({
                    data: { name: admin.name },
                    toastLoadingMessage: 'Removing passkeys...',
                    genericHandler: { successMsg: `Removed ${admin.name}'s passkeys.` },
                });
                swr.mutate();
            },
        });
    };

    const handleAdd = () => {
        setFormState({
            mode: 'add',
            initialValues: { name: '', citizenfxID: '', discordID: '', permissions: [] },
        });
    };

    return (
        <div className="flex flex-col w-full gap-4 pb-4 [&>header]:mb-0">
            <PageHeader title="Admins" icon={<UsersIcon />}>
                <Button size="sm" disabled={!swr.data} onClick={handleAdd}>
                    <PlusIcon className="size-4 mr-1" /> Add Admin
                </Button>
            </PageHeader>

            {swr.error ? (
                <Alert variant="destructive" className="mx-2 md:mx-0 w-auto">
                    <AlertTitle>Failed to Load Admins</AlertTitle>
                    <AlertDescription>{(swr.error as Error).message}</AlertDescription>
                </Alert>
            ) : !swr.data ? (
                <div className="flex items-center justify-center py-16 text-muted-foreground">
                    <Loader2Icon className="animate-spin size-6 mr-2" /> Loading...
                </div>
            ) : (
                <div className="mx-2 md:mx-0 border rounded-lg bg-card overflow-hidden">
                    <div className="hidden md:grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_1.5rem] gap-x-4 px-4 py-2.5 border-b text-sm font-medium text-muted-foreground">
                        <span>Admin</span>
                        <span>Permissions</span>
                        <span>Login</span>
                    </div>
                    <div className="divide-y">
                        {swr.data.admins.map((admin) => (
                            <AdminRow
                                key={admin.name}
                                admin={admin}
                                onEdit={handleEdit}
                                onOpenAccount={() => openAccountModal()}
                            />
                        ))}
                    </div>
                </div>
            )}

            {formState && swr.data && (
                <AdminFormDialog
                    mode={formState.mode}
                    initialValues={formState.initialValues}
                    admin={formState.admin}
                    onDelete={handleDelete}
                    onRemovePasskeys={handleRemovePasskeys}
                    permissionsList={swr.data.permissions}
                    onClose={closeForm}
                    onSaved={handleSaved}
                />
            )}
            <AdminPasswordDialog data={newPassword} onClose={() => setNewPassword(null)} />
        </div>
    );
}
