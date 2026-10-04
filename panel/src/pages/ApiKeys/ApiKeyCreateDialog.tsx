import { useEffect, useMemo, useState } from "react";
import { Loader2Icon } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useBackendApi } from "@/hooks/fetch";
import { useAdminPerms } from "@/hooks/auth";
import { API_KEY_NAME_MAX_LENGTH, type ApiKeyCreateReq, type ApiKeyCreateResp } from "@shared/apiV1Types";
import { API_SCOPE_ALL, type ApiScopeInfo } from "@shared/apiScopes";


const EXPIRY_OPTIONS = [
    { value: 'never', label: 'Never' },
    { value: '7', label: '7 days' },
    { value: '30', label: '30 days' },
    { value: '90', label: '90 days' },
    { value: '365', label: '1 year' },
] as const;

type Props = {
    isOpen: boolean;
    onClose: () => void;
    onCreated: (name: string, token: string) => void;
    scopes: ApiScopeInfo[];
};

export default function ApiKeyCreateDialog({ isOpen, onClose, onCreated, scopes }: Props) {
    const { hasPerm } = useAdminPerms();
    const [name, setName] = useState('');
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [expiry, setExpiry] = useState<string>('never');
    const [allowedIps, setAllowedIps] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [isSaving, setIsSaving] = useState(false);

    const createApi = useBackendApi<ApiKeyCreateResp, ApiKeyCreateReq>({
        method: 'POST',
        path: '/apiKeys/create',
    });

    //Reset the form whenever it opens
    useEffect(() => {
        if (!isOpen) return;
        setName('');
        setSelected(new Set());
        setExpiry('never');
        setAllowedIps('');
        setError(null);
        setIsSaving(false);
    }, [isOpen]);

    //Only scopes backed by a permission the current admin holds can be granted
    const grantable = useMemo(() => {
        return scopes.filter((scope) => scope.grantRequires === null || hasPerm(scope.grantRequires));
    }, [scopes, hasPerm]);

    const toggleScope = (scopeId: string, checked: boolean) => {
        setSelected((prev) => {
            const next = new Set(prev);
            if (scopeId === API_SCOPE_ALL) {
                return checked ? new Set([API_SCOPE_ALL]) : new Set();
            }
            next.delete(API_SCOPE_ALL);
            if (checked) next.add(scopeId); else next.delete(scopeId);
            return next;
        });
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        if (!name.trim()) return setError('Name is required.');
        const ipList = allowedIps.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
        const expiresAt = expiry === 'never' ? null : Date.now() + Number(expiry) * 24 * 60 * 60 * 1000;

        setIsSaving(true);
        try {
            const resp = await createApi({
                data: {
                    name: name.trim(),
                    permissions: [...selected],
                    expiresAt,
                    allowedIps: ipList,
                },
            });
            if (!resp) throw new Error('No response from server.');
            if ('error' in resp) {
                const details = resp.error.details as any;
                const extra = details?.permissions ?? details?.allowedIps;
                throw new Error(Array.isArray(extra) ? `${resp.error.message} (${extra.join(', ')})` : resp.error.message);
            }
            onCreated(resp.data.key.name, resp.data.token);
        } catch (err) {
            setError((err as Error).message);
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
            <DialogContent className="max-w-lg">
                <form onSubmit={handleSubmit} className="space-y-4">
                    <DialogHeader>
                        <DialogTitle>New API key</DialogTitle>
                        <DialogDescription>
                            The token is shown once after creation. Every key can read; tick only the write scopes it needs.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-1.5">
                        <Label htmlFor="apikey-name">Name</Label>
                        <Input
                            id="apikey-name"
                            value={name}
                            maxLength={API_KEY_NAME_MAX_LENGTH}
                            placeholder="e.g. discord-bot"
                            autoFocus
                            onChange={(e) => setName(e.target.value)}
                        />
                    </div>

                    <div className="space-y-1.5">
                        <Label>Scopes</Label>
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
                            {grantable.map((scope) => {
                                const isAll = scope.id === API_SCOPE_ALL;
                                const allSelected = selected.has(API_SCOPE_ALL);
                                return (
                                    <label
                                        key={scope.id}
                                        className="flex items-start gap-2 p-3 text-sm cursor-pointer hover:bg-muted/40"
                                        title={scope.id}
                                    >
                                        <Checkbox
                                            className="mt-0.5"
                                            checked={selected.has(scope.id)}
                                            disabled={!isAll && allSelected}
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
                        <p className="text-xs text-muted-foreground">
                            {selected.size
                                ? `Granting ${selected.size} write scope${selected.size === 1 ? '' : 's'}.`
                                : 'No write scopes selected, this will be a read-only key.'}
                        </p>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="space-y-1.5">
                            <Label>Expires</Label>
                            <Select value={expiry} onValueChange={setExpiry}>
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    {EXPIRY_OPTIONS.map((opt) => (
                                        <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-1.5">
                            <Label htmlFor="apikey-ips">Allowed IPs <span className="text-muted-foreground font-normal">(optional)</span></Label>
                            <Textarea
                                id="apikey-ips"
                                className="font-mono text-xs min-h-[2.5rem]"
                                placeholder={"203.0.113.5\n10.0.0.0/8"}
                                value={allowedIps}
                                onChange={(e) => setAllowedIps(e.target.value)}
                            />
                        </div>
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
                            Create key
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}
