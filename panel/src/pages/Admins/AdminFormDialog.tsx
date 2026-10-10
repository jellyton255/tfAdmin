import { useState } from "react";
import { Loader2Icon } from "lucide-react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription } from "@/components/ui/alert";
import TxAnchor from "@/components/TxAnchor";
import { useBackendApi } from "@/hooks/fetch";
import { useAdminPerms } from "@/hooks/auth";
import { cn } from "@/lib/utils";
import consts from "@shared/consts";
import type {
    AdminManagerAddResp,
    AdminManagerEditResp,
    AdminManagerPermission,
    AdminManagerSaveReq,
} from "@shared/adminManagerApiTypes";

export type AdminFormValues = AdminManagerSaveReq;

type Props = {
    mode: 'add' | 'edit';
    initialValues: AdminFormValues;
    permissionsList: AdminManagerPermission[];
    onClose: () => void;
    onSaved: (name: string, password: string | null) => void;
};

const permGroups = [
    { group: 'panel', title: 'Panel' },
    { group: 'game', title: 'Players & In-Game Menu' },
] as const;


//Mounted only while open, so the form state starts fresh every time
export default function AdminFormDialog({ mode, initialValues, permissionsList, onClose, onSaved }: Props) {
    const { hasPerm } = useAdminPerms();
    const [name, setName] = useState(initialValues.name);
    const [citizenfxID, setCitizenfxID] = useState(initialValues.citizenfxID);
    const [discordID, setDiscordID] = useState(initialValues.discordID);
    const [selected, setSelected] = useState(() => new Set(initialValues.permissions));
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

    const allSelected = selected.has('all_permissions');
    const togglePerm = (permId: string, checked: boolean) => {
        setSelected((prev) => {
            if (permId === 'all_permissions') {
                return checked ? new Set(['all_permissions']) : new Set<string>();
            }
            const next = new Set(prev);
            if (checked) next.add(permId); else next.delete(permId);
            return next;
        });
    };

    const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        setError(null);
        const data: AdminManagerSaveReq = {
            name: name.trim(),
            citizenfxID: citizenfxID.trim(),
            discordID: discordID.trim(),
            permissions: [...selected],
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

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        {permGroups.map(({ group, title }) => (
                            <div key={group} className="space-y-1.5">
                                <Label>{title}</Label>
                                <div className="border rounded-md divide-y">
                                    {permissionsList.filter((perm) => perm.group === group).map((perm) => {
                                        const isAll = perm.id === 'all_permissions';
                                        const canGrant = hasPerm(perm.id);
                                        return (
                                            <label
                                                key={perm.id}
                                                title={canGrant ? perm.id : 'You cannot give permissions you do not have.'}
                                                className={cn(
                                                    'flex items-center gap-2 px-3 py-2 text-sm',
                                                    canGrant ? 'cursor-pointer hover:bg-muted/40' : 'opacity-60 cursor-not-allowed',
                                                )}
                                            >
                                                <Checkbox
                                                    checked={allSelected || selected.has(perm.id)}
                                                    disabled={!canGrant || (!isAll && allSelected)}
                                                    onCheckedChange={(c) => togglePerm(perm.id, c === true)}
                                                />
                                                <span className={cn(
                                                    isAll && 'font-semibold',
                                                    perm.dangerous && 'text-destructive',
                                                )}>
                                                    {perm.label}
                                                </span>
                                            </label>
                                        );
                                    })}
                                </div>
                            </div>
                        ))}
                    </div>

                    {error && (
                        <Alert variant="destructive">
                            <AlertDescription>{error}</AlertDescription>
                        </Alert>
                    )}

                    <DialogFooter>
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
