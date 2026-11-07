import { useState } from "react";
import { Loader2Icon, Trash2Icon } from "lucide-react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useBackendApi } from "@/hooks/fetch";
import { cn } from "@/lib/utils";
import type {
    AdminManagerAdmin,
    AdminManagerGroup,
    AdminManagerGroupSaveReq,
    AdminManagerGroupSaveResp,
    AdminManagerPermission,
} from "@shared/adminManagerApiTypes";
import PermissionsGrid from "./PermissionsGrid";

type Props = {
    group?: AdminManagerGroup; //missing when creating one
    admins: AdminManagerAdmin[];
    permissionsList: AdminManagerPermission[];
    onDelete: (group: AdminManagerGroup) => void;
    onClose: () => void;
    onSaved: (name: string) => void;
};


//Mounted only while open, so the form state starts fresh every time
export default function GroupFormDialog({ group, admins, permissionsList, onDelete, onClose, onSaved }: Props) {
    const [name, setName] = useState(group?.name ?? '');
    const [description, setDescription] = useState(group?.description ?? '');
    const [perms, setPerms] = useState(() => new Set(group?.permissions ?? []));
    const [members, setMembers] = useState(() => new Set(group?.members ?? []));
    const [error, setError] = useState<string | null>(null);
    const [isSaving, setIsSaving] = useState(false);
    const readOnly = group ? !group.canEdit : false;

    const saveApi = useBackendApi<AdminManagerGroupSaveResp, AdminManagerGroupSaveReq>({
        method: 'POST',
        path: '/adminManager/saveGroup',
    });

    const toggleMember = (adminName: string, checked: boolean) => {
        setMembers((prev) => {
            const next = new Set(prev);
            if (checked) next.add(adminName); else next.delete(adminName);
            return next;
        });
    };

    const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        setError(null);
        if (!name.trim()) return setError('The group needs a name.');

        setIsSaving(true);
        try {
            const resp = await saveApi({
                data: {
                    id: group?.id,
                    name: name.trim(),
                    description: description.trim(),
                    permissions: [...perms],
                    members: [...members],
                },
            });
            if (!resp) return;
            if ('error' in resp) return setError(resp.error);
            onSaved(name.trim());
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setIsSaving(false);
        }
    };

    //The master account has every permission, so it's never listed
    const memberCandidates = admins.filter((admin) => !admin.isMaster);

    return (
        <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                <form onSubmit={handleSubmit} className="space-y-4">
                    <DialogHeader>
                        <DialogTitle>{group ? `Edit ${group.name}` : 'New Group'}</DialogTitle>
                    </DialogHeader>

                    {readOnly && (
                        <Alert>
                            <AlertDescription>This group has permissions you don't have, so you can't change it.</AlertDescription>
                        </Alert>
                    )}

                    <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-4">
                        <div className="space-y-1.5">
                            <Label htmlFor="group-name">Name</Label>
                            <Input
                                id="group-name"
                                value={name}
                                maxLength={32}
                                autoComplete="off"
                                autoFocus={!group}
                                disabled={readOnly}
                                placeholder="Moderator"
                                onChange={(e) => setName(e.target.value)}
                            />
                        </div>
                        <div className="space-y-1.5">
                            <Label htmlFor="group-desc">
                                Description <span className="text-muted-foreground font-normal">(Optional)</span>
                            </Label>
                            <Input
                                id="group-desc"
                                value={description}
                                maxLength={120}
                                autoComplete="off"
                                disabled={readOnly}
                                placeholder="What this group is for"
                                onChange={(e) => setDescription(e.target.value)}
                            />
                        </div>
                    </div>

                    <PermissionsGrid
                        permissionsList={permissionsList}
                        selected={perms}
                        onChange={setPerms}
                        disabled={readOnly}
                    />

                    <div className="space-y-1.5">
                        <Label>Members <span className="text-muted-foreground font-normal">({members.size})</span></Label>
                        {memberCandidates.length ? (
                            <div className="border rounded-md grid grid-cols-1 sm:grid-cols-2 max-h-56 overflow-y-auto">
                                {memberCandidates.map((admin) => {
                                    const isDisabled = readOnly || admin.isSelf;
                                    return (
                                        <label
                                            key={admin.name}
                                            title={admin.isSelf ? 'You cannot change your own groups.' : undefined}
                                            className={cn(
                                                'flex items-center gap-2 px-3 py-2 text-sm',
                                                isDisabled ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer hover:bg-muted/40',
                                            )}
                                        >
                                            <Checkbox
                                                checked={members.has(admin.name)}
                                                disabled={isDisabled}
                                                onCheckedChange={(c) => toggleMember(admin.name, c === true)}
                                            />
                                            <span className="truncate">{admin.name}</span>
                                        </label>
                                    );
                                })}
                            </div>
                        ) : (
                            <p className="text-sm text-muted-foreground">There are no admins to add yet.</p>
                        )}
                    </div>

                    {error && (
                        <Alert variant="destructive">
                            <AlertDescription>{error}</AlertDescription>
                        </Alert>
                    )}

                    <DialogFooter className="gap-2 sm:space-x-0">
                        {group && !readOnly && (
                            <Button
                                type="button"
                                variant="ghost-destructive"
                                className="sm:mr-auto"
                                disabled={isSaving}
                                onClick={() => onDelete(group)}
                            >
                                <Trash2Icon className="size-4 mr-1" /> Delete Group
                            </Button>
                        )}
                        <Button type="button" variant="outline" onClick={onClose} disabled={isSaving}>
                            {readOnly ? 'Close' : 'Cancel'}
                        </Button>
                        {!readOnly && (
                            <Button type="submit" disabled={isSaving}>
                                {isSaving && <Loader2Icon className="animate-spin size-4 mr-1" />}
                                {group ? 'Save' : 'Create Group'}
                            </Button>
                        )}
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}
