import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { useAdminPerms } from "@/hooks/auth";
import { cn } from "@/lib/utils";
import type { AdminManagerPermission } from "@shared/adminManagerApiTypes";

const permGroups = [
    { group: 'panel', title: 'Panel' },
    { group: 'game', title: 'Players & In-Game' },
] as const;

type Props = {
    permissionsList: AdminManagerPermission[];
    selected: Set<string>;
    onChange: (next: Set<string>) => void;
    disabled?: boolean;
};

/**
 * The permission checkboxes of a group, split in panel and game permissions.
 * An admin can only tick permissions they have.
 */
export default function PermissionsGrid({ permissionsList, selected, onChange, disabled }: Props) {
    const { hasPerm } = useAdminPerms();
    const allSelected = selected.has('all_permissions');

    const togglePerm = (permId: string, checked: boolean) => {
        if (permId === 'all_permissions') {
            return onChange(checked ? new Set(['all_permissions']) : new Set<string>());
        }
        const next = new Set(selected);
        if (checked) next.add(permId); else next.delete(permId);
        onChange(next);
    };

    return (
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
                                        canGrant && !disabled ? 'cursor-pointer hover:bg-muted/40' : 'opacity-60 cursor-not-allowed',
                                    )}
                                >
                                    <Checkbox
                                        checked={allSelected || selected.has(perm.id)}
                                        disabled={disabled || !canGrant || (!isAll && allSelected)}
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
    );
}
