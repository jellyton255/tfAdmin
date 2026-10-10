import { useState } from "react";
import useSWR from "swr";
import { Loader2Icon, PencilIcon, PlusIcon, Trash2Icon, UserCogIcon, UsersIcon } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { txToast } from "@/components/TxToaster";
import { useBackendApi } from "@/hooks/fetch";
import { useOpenAccountModal, useOpenConfirmDialog } from "@/hooks/dialogs";
import type {
    AdminManagerAdmin,
    AdminManagerDeleteReq,
    AdminManagerDeleteResp,
    AdminManagerListResp,
} from "@shared/adminManagerApiTypes";
import AdminFormDialog, { type AdminFormValues } from "./AdminFormDialog";
import AdminPasswordDialog from "./AdminPasswordDialog";

const LIST_SWR_KEY = '/adminManager/list';

type FormState = {
    mode: 'add' | 'edit';
    initialValues: AdminFormValues;
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


function AdminRow({ admin, onEdit, onDelete, onOpenAccount }: {
    admin: AdminManagerAdmin;
    onEdit: (admin: AdminManagerAdmin) => void;
    onDelete: (admin: AdminManagerAdmin) => void;
    onOpenAccount: () => void;
}) {
    return (
        <TableRow>
            <TableCell>
                <div className="flex items-center gap-2 font-semibold">
                    {admin.name}
                    {admin.isMaster && <Badge variant="outline" className="border-warning/40 text-warning">Master</Badge>}
                    {admin.isSelf && <Badge variant="secondary">You</Badge>}
                </div>
            </TableCell>
            <TableCell>
                {admin.citizenfxIdentifier || admin.discordId ? (
                    <div className="flex flex-col gap-0.5 font-mono text-xs text-muted-foreground">
                        {admin.citizenfxIdentifier && <span title="Cfx.re">{admin.citizenfxIdentifier}</span>}
                        {admin.discordId && <span title="Discord">discord:{admin.discordId}</span>}
                    </div>
                ) : (
                    <span className="text-muted-foreground">&ndash;</span>
                )}
            </TableCell>
            <TableCell className="text-muted-foreground whitespace-nowrap">{getPermsSummary(admin)}</TableCell>
            <TableCell className="text-right whitespace-nowrap">
                {admin.isSelf ? (
                    <Button size="sm" variant="outline" onClick={onOpenAccount}>
                        <UserCogIcon className="size-4 mr-1" /> Your Account
                    </Button>
                ) : (
                    <div className="inline-flex gap-1">
                        <Button
                            size="sm"
                            variant="ghost"
                            disabled={!admin.canEdit}
                            title={admin.canEdit ? 'Edit' : 'Only the master account can edit a master admin.'}
                            onClick={() => onEdit(admin)}
                        >
                            <PencilIcon className="size-4 mr-1" /> Edit
                        </Button>
                        <Button
                            size="sm"
                            variant="ghost"
                            className="text-destructive hover:text-destructive"
                            disabled={!admin.canDelete}
                            title={admin.canDelete ? 'Delete' : 'The master admin cannot be deleted.'}
                            onClick={() => onDelete(admin)}
                        >
                            <Trash2Icon className="size-4 mr-1" /> Delete
                        </Button>
                    </div>
                )}
            </TableCell>
        </TableRow>
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
            initialValues: {
                name: admin.name,
                citizenfxID: admin.citizenfxId ?? '',
                discordID: admin.discordId ?? '',
                permissions: admin.permissions,
            },
        });
    };

    const handleDelete = (admin: AdminManagerAdmin) => {
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

    const handleAdd = () => {
        setFormState({
            mode: 'add',
            initialValues: { name: '', citizenfxID: '', discordID: '', permissions: [] },
        });
    };

    return (
        <div className="flex flex-col h-full w-full gap-4 max-w-screen-xl mx-auto">
            <PageHeader title="Admins" icon={<UsersIcon />}>
                <Button size="sm" disabled={!swr.data} onClick={handleAdd}>
                    <PlusIcon className="size-4 mr-1" /> Add Admin
                </Button>
            </PageHeader>

            {swr.error ? (
                <Alert variant="destructive" className="mx-2 w-auto">
                    <AlertTitle>Failed to Load Admins</AlertTitle>
                    <AlertDescription>{(swr.error as Error).message}</AlertDescription>
                </Alert>
            ) : !swr.data ? (
                <div className="flex items-center justify-center py-16 text-muted-foreground">
                    <Loader2Icon className="animate-spin size-6 mr-2" /> Loading...
                </div>
            ) : (
                <div className="border rounded-lg mx-2 overflow-x-auto">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Username</TableHead>
                                <TableHead>Identifiers</TableHead>
                                <TableHead>Permissions</TableHead>
                                <TableHead className="text-right">Actions</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {swr.data.admins.map((admin) => (
                                <AdminRow
                                    key={admin.name}
                                    admin={admin}
                                    onEdit={handleEdit}
                                    onDelete={handleDelete}
                                    onOpenAccount={() => openAccountModal()}
                                />
                            ))}
                        </TableBody>
                    </Table>
                </div>
            )}

            {formState && swr.data && (
                <AdminFormDialog
                    mode={formState.mode}
                    initialValues={formState.initialValues}
                    permissionsList={swr.data.permissions}
                    onClose={closeForm}
                    onSaved={handleSaved}
                />
            )}
            <AdminPasswordDialog data={newPassword} onClose={() => setNewPassword(null)} />
        </div>
    );
}
