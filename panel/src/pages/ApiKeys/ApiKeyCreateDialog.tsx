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
    availablePermissions: Record<string, string>;
};

export default function ApiKeyCreateDialog({ isOpen, onClose, onCreated, availablePermissions }: Props) {
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

    //Only permissions the current admin holds can be granted
    const grantable = useMemo(() => {
        return Object.entries(availablePermissions)
            .filter(([perm]) => hasPerm(perm));
    }, [availablePermissions, hasPerm]);

    const togglePerm = (perm: string, checked: boolean) => {
        setSelected((prev) => {
            const next = new Set(prev);
            if (perm === 'all_permissions') {
                return checked ? new Set(['all_permissions']) : new Set();
            }
            next.delete('all_permissions');
            if (checked) next.add(perm); else next.delete(perm);
            return next;
        });
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        if (!name.trim()) return setError('Name is required.');
        if (!selected.size) return setError('Select at least one permission.');
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
                            The token is shown once after creation. Give the key only the permissions it needs.
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
                        <Label>Permissions</Label>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5 max-h-64 overflow-y-auto border rounded-md p-3">
                            {grantable.map(([perm, desc]) => {
                                const isAll = perm === 'all_permissions';
                                const allSelected = selected.has('all_permissions');
                                return (
                                    <label
                                        key={perm}
                                        className="flex items-start gap-2 text-sm cursor-pointer"
                                        title={perm}
                                    >
                                        <Checkbox
                                            className="mt-0.5"
                                            checked={selected.has(perm)}
                                            disabled={!isAll && allSelected}
                                            onCheckedChange={(c) => togglePerm(perm, c === true)}
                                        />
                                        <span className={isAll ? 'font-semibold' : ''}>{desc}</span>
                                    </label>
                                );
                            })}
                        </div>
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
