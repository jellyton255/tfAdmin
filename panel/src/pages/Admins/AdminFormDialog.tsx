import { useState } from "react";
import { KeyRoundIcon, Loader2Icon, Trash2Icon } from "lucide-react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription } from "@/components/ui/alert";
import TxAnchor from "@/components/TxAnchor";
import { useBackendApi } from "@/hooks/fetch";
import { cn } from "@/lib/utils";
import consts from "@shared/consts";
import type {
    AdminManagerAdmin,
    AdminManagerAddResp,
    AdminManagerEditResp,
    AdminManagerGroup,
    AdminManagerPermission,
    AdminManagerSaveReq,
} from "@shared/adminManagerApiTypes";

export type AdminFormValues = AdminManagerSaveReq;

type Props = {
    mode: 'add' | 'edit';
    initialValues: AdminFormValues;
    admin?: AdminManagerAdmin;
    onDelete: (admin: AdminManagerAdmin) => void;
    onRemovePasskeys: (admin: AdminManagerAdmin) => void;
    groupsList: AdminManagerGroup[];
    permissionsList: AdminManagerPermission[];
    onClose: () => void;
    onSaved: (name: string, password: string | null) => void;
};

function summarizePerms(perms: string[], permissionsList: AdminManagerPermission[]) {
    if (perms.includes('all_permissions')) return 'All Permissions';
    if (!perms.length) return 'No permissions';
    const labels = perms.map((id) => permissionsList.find((p) => p.id === id)?.label ?? id);
    return labels.length > 3
        ? `${labels.slice(0, 3).join(', ')} +${labels.length - 3} more`
        : labels.join(', ');
}


//Mounted only while open, so the form state starts fresh every time
export default function AdminFormDialog({ mode, initialValues, admin, onDelete, onRemovePasskeys, groupsList, permissionsList, onClose, onSaved }: Props) {
    const [name, setName] = useState(initialValues.name);
    const [citizenfxID, setCitizenfxID] = useState(initialValues.citizenfxID);
    const [discordID, setDiscordID] = useState(initialValues.discordID);
    const [selected, setSelected] = useState(() => new Set(initialValues.groups));
    const [error, setError] = useState<string | null>(null);
    const [isSaving, setIsSaving] = useState(false);

    const addApi = useBackendApi<AdminManagerAddResp, AdminManagerSaveReq>({
        method: 'POST',
        path: '/adminManager/add',
    });
    const editApi = useBackendApi<AdminManagerEditResp, AdminManagerSaveReq>({
        method: 'POST',
        path: '/adminManager/edit',
    });

    const toggleGroup = (groupId: string, checked: boolean) => {
        setSelected((prev) => {
            const next = new Set(prev);
            if (checked) next.add(groupId); else next.delete(groupId);
            return next;
        });
    };
    const resultingPerms = [...new Set(groupsList.filter((g) => selected.has(g.id)).flatMap((g) => g.permissions))];

    const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        setError(null);
        const data: AdminManagerSaveReq = {
            name: name.trim(),
            citizenfxID: citizenfxID.trim(),
            discordID: discordID.trim(),
            groups: groupsList.filter((g) => selected.has(g.id)).map((g) => g.id),
        };
        if (mode === 'add' && !consts.regexValidFivemUsername.test(data.name)) {
            return setError('Usernames must be 3 to 20 letters, numbers, or `_.-`, and start and end with a letter or number.');
        }
        if (data.discordID && !consts.validIdentifierParts.discord.test(data.discordID)) {
            return setError('The Discord ID must be a numeric user ID.');
        }

        setIsSaving(true);
        try {
            if (mode === 'add') {
                const resp = await addApi({ data });
                if (!resp) return;
                if ('error' in resp) return setError(resp.error);
                onSaved(data.name, resp.password);
            } else {
                const resp = await editApi({ data });
                if (!resp) return;
                if ('error' in resp) return setError(resp.error);
                onSaved(data.name, null);
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                <form onSubmit={handleSubmit} className="space-y-4">
                    <DialogHeader>
                        <DialogTitle>{mode === 'add' ? 'Add Admin' : `Edit ${initialValues.name}`}</DialogTitle>
                    </DialogHeader>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                        <div className="space-y-1.5">
                            <Label htmlFor="admin-name">Username</Label>
                            <Input
                                id="admin-name"
                                value={name}
                                maxLength={20}
                                autoComplete="off"
                                autoFocus={mode === 'add'}
                                readOnly={mode === 'edit'}
                                disabled={mode === 'edit'}
                                onChange={(e) => setName(e.target.value)}
                            />
                        </div>
                        <div className="space-y-1.5">
                            <Label htmlFor="admin-cfxre">
                                Cfx.re ID <span className="text-muted-foreground font-normal">(Optional)</span>
                            </Label>
                            <Input
                                id="admin-cfxre"
                                value={citizenfxID}
                                maxLength={20}
                                autoComplete="off"
                                placeholder="Forum username"
                                onChange={(e) => setCitizenfxID(e.target.value)}
                            />
                        </div>
                        <div className="space-y-1.5">
                            <Label htmlFor="admin-discord">
                                Discord ID <span className="text-muted-foreground font-normal">(Optional)</span>
                            </Label>
                            <Input
                                id="admin-discord"
                                value={discordID}
                                inputMode="numeric"
                                autoComplete="off"
                                placeholder="272800190639898628"
                                onChange={(e) => setDiscordID(e.target.value)}
                            />
                        </div>
                    </div>
                    <p className="text-xs text-muted-foreground">
                        The Cfx.re ID is the <TxAnchor href="https://forum.cfx.re/">forum.cfx.re</TxAnchor> username and is required to log in with Cfx.re.
                        For the Discord ID, see <TxAnchor href="https://support.discord.com/hc/en-us/articles/206346498">Where Can I Find My User ID</TxAnchor>.
                    </p>

                    <div className="space-y-1.5">
                        <Label>Groups</Label>
                        {groupsList.length ? (
                            <div className="border rounded-md divide-y">
                                {groupsList.map((group) => {
                                    //Groups with permissions you lack can't be given, but can be taken away
                                    const isLocked = !group.canEdit && !initialValues.groups.includes(group.id);
                                    return (
                                        <label
                                            key={group.id}
                                            title={isLocked ? 'You cannot give groups with permissions you do not have.' : undefined}
                                            className={cn(
                                                'flex items-start gap-2 px-3 py-2 text-sm',
                                                isLocked ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer hover:bg-muted/40',
                                            )}
                                        >
                                            <Checkbox
                                                className="mt-0.5"
                                                checked={selected.has(group.id)}
                                                disabled={isLocked}
                                                onCheckedChange={(c) => toggleGroup(group.id, c === true)}
                                            />
                                            <span className="min-w-0">
                                                <span className={cn(
                                                    'font-medium',
                                                    group.permissions.includes('all_permissions') && 'text-destructive',
                                                )}>
                                                    {group.name}
                                                </span>
                                                <span className="block text-xs text-muted-foreground truncate">
                                                    {group.description || summarizePerms(group.permissions, permissionsList)}
                                                </span>
                                            </span>
                                        </label>
                                    );
                                })}
                            </div>
                        ) : (
                            <p className="text-sm text-muted-foreground">
                                There are no groups yet. Create one in the Groups tab, then add admins to it.
                            </p>
                        )}
                        <p className="text-xs text-muted-foreground">
                            Permissions from these groups: {summarizePerms(resultingPerms, permissionsList)}.
                        </p>
                    </div>

                    {admin && admin.passkeyCount > 0 && (
                        <div className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm">
                            <span className="inline-flex items-center gap-2">
                                <KeyRoundIcon className="size-4 text-muted-foreground" />
                                {admin.passkeyCount === 1 ? '1 Passkey' : `${admin.passkeyCount} Passkeys`}
                            </span>
                            <Button
                                type="button"
                                size="xs"
                                variant="ghost-destructive"
                                disabled={isSaving}
                                onClick={() => onRemovePasskeys(admin)}
                            >
                                Remove Passkeys
                            </Button>
                        </div>
                    )}

                    {error && (
                        <Alert variant="destructive">
                            <AlertDescription>{error}</AlertDescription>
                        </Alert>
                    )}

                    <DialogFooter className="gap-2 sm:space-x-0">
                        {admin?.canDelete && (
                            <Button
                                type="button"
                                variant="ghost-destructive"
                                className="sm:mr-auto"
                                disabled={isSaving}
                                onClick={() => onDelete(admin)}
                            >
                                <Trash2Icon className="size-4 mr-1" /> Delete Admin
                            </Button>
                        )}
                        <Button type="button" variant="outline" onClick={onClose} disabled={isSaving}>Cancel</Button>
                        <Button type="submit" disabled={isSaving}>
                            {isSaving && <Loader2Icon className="animate-spin size-4 mr-1" />}
                            {mode === 'add' ? 'Add Admin' : 'Save'}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}
