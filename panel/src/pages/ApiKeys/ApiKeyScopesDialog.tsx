import { useState } from "react";
import { Loader2Icon } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useBackendApi } from "@/hooks/fetch";
import { useAdminPerms } from "@/hooks/auth";
import type { ApiKeyPublicRecord, ApiKeyUpdateScopesReq, ApiKeyUpdateScopesResp } from "@shared/apiV1Types";
import type { ApiScopeInfo } from "@shared/apiScopes";
import ApiKeyScopeList from "./ApiKeyScopeList";


type Props = {
    apiKey: ApiKeyPublicRecord;
    scopes: ApiScopeInfo[];
    onClose: () => void;
    onSaved: () => void;
};

/**
 * Changes an existing key's scopes. Mounted only while open, so its draft starts from the key.
 */
export default function ApiKeyScopesDialog({ apiKey, scopes, onClose, onSaved }: Props) {
    const { hasPerm } = useAdminPerms();
    const [selected, setSelected] = useState<Set<string>>(() => new Set(apiKey.permissions));
    const [error, setError] = useState<string | null>(null);
    const [isSaving, setIsSaving] = useState(false);

    const updateApi = useBackendApi<ApiKeyUpdateScopesResp, ApiKeyUpdateScopesReq>({
        method: 'POST',
        path: '/apiKeys/updateScopes',
    });

    const isLocked = (scope: ApiScopeInfo) => scope.grantRequires !== null && !hasPerm(scope.grantRequires);
    const isUnchanged = selected.size === apiKey.permissions.length
        && apiKey.permissions.every((p) => selected.has(p));

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        setIsSaving(true);
        try {
            const resp = await updateApi({
                data: { id: apiKey.id, permissions: [...selected] },
            });
            if (!resp) throw new Error('No response from server.');
            if ('error' in resp) {
                const details = resp.error.details;
                const extra = typeof details === 'object' && details !== null && 'permissions' in details ? details.permissions : undefined;
                throw new Error(Array.isArray(extra) ? `${resp.error.message} (${extra.join(', ')})` : resp.error.message);
            }
            onSaved();
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
            <DialogContent className="max-w-lg">
                <form onSubmit={handleSubmit} className="space-y-4">
                    <DialogHeader>
                        <DialogTitle>Edit Scopes for "{apiKey.name}"</DialogTitle>
                        <DialogDescription>
                            The token stays the same. Changes apply to the next request.
                        </DialogDescription>
                    </DialogHeader>

                    <ApiKeyScopeList scopes={scopes} selected={selected} onChange={setSelected} isLocked={isLocked} />

                    {error && (
                        <Alert variant="destructive">
                            <AlertDescription>{error}</AlertDescription>
                        </Alert>
                    )}

                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={onClose} disabled={isSaving}>Cancel</Button>
                        <Button type="submit" disabled={isSaving || isUnchanged}>
                            {isSaving && <Loader2Icon className="animate-spin size-4 mr-1" />}
                            Save Scopes
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}
