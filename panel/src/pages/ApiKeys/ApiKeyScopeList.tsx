import { Checkbox } from "@/components/ui/checkbox";
import { API_SCOPE_ALL, type ApiScopeInfo } from "@shared/apiScopes";


type Props = {
    scopes: ApiScopeInfo[];
    selected: Set<string>;
    onChange: (next: Set<string>) => void;
    /** Scopes the current admin can't grant; shown but can't be toggled. */
    isLocked?: (scope: ApiScopeInfo) => boolean;
};

/**
 * Scope checklist shared by the create and edit dialogs.
 * Full access replaces every other scope, so ticking it clears the rest.
 */
export default function ApiKeyScopeList({ scopes, selected, onChange, isLocked }: Props) {
    const allSelected = selected.has(API_SCOPE_ALL);

    const toggleScope = (scopeId: string, checked: boolean) => {
        if (scopeId === API_SCOPE_ALL) {
            return onChange(checked ? new Set([API_SCOPE_ALL]) : new Set());
        }
        const next = new Set(selected);
        next.delete(API_SCOPE_ALL);
        if (checked) next.add(scopeId); else next.delete(scopeId);
        onChange(next);
    };

    return (
        <div className="border rounded-md divide-y max-h-72 overflow-y-auto">
            <div className="flex items-start gap-2 p-3 text-sm bg-muted/40">
                <Checkbox className="mt-0.5" checked disabled />
                <div>
                    <div className="font-medium">Read access</div>
                    <div className="text-xs text-muted-foreground">
                        Always included: status, players, bans and warns, whitelist, resources and events.
                        A key with nothing else ticked is read-only.
                    </div>
                </div>
            </div>
            {scopes.map((scope) => {
                const isAll = scope.id === API_SCOPE_ALL;
                const locked = isLocked?.(scope) ?? false;
                return (
                    <label
                        key={scope.id}
                        className="flex items-start gap-2 p-3 text-sm cursor-pointer hover:bg-muted/40 has-[:disabled]:cursor-default"
                        title={locked ? `${scope.id} (you don't hold the permission behind this scope)` : scope.id}
                    >
                        <Checkbox
                            className="mt-0.5"
                            checked={selected.has(scope.id)}
                            disabled={locked || (!isAll && allSelected)}
                            onCheckedChange={(c) => toggleScope(scope.id, c === true)}
                        />
                        <div>
                            <div className={isAll ? 'font-semibold' : 'font-medium'}>{scope.label}</div>
                            <div className="text-xs text-muted-foreground">{scope.description}</div>
                        </div>
                    </label>
                );
            })}
        </div>
    );
}
