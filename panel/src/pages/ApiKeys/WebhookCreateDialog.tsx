import { useEffect, useState } from "react";
import { Loader2Icon } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useBackendApi } from "@/hooks/fetch";
import {
    API_WEBHOOK_NAME_MAX_LENGTH,
    API_WEBHOOK_SECRET_MAX_LENGTH,
    API_WEBHOOK_SECRET_MIN_LENGTH,
    API_WEBHOOK_URL_MAX_LENGTH,
    type ApiEventType,
    type ApiWebhookCreateReq,
    type ApiWebhookCreateResp,
} from "@shared/apiV1Types";


type Props = {
    isOpen: boolean;
    onClose: () => void;
    onCreated: (name: string, secret: string) => void;
    eventTypes: ApiEventType[];
};

export default function WebhookCreateDialog({ isOpen, onClose, onCreated, eventTypes }: Props) {
    const [name, setName] = useState('');
    const [url, setUrl] = useState('');
    const [secret, setSecret] = useState('');
    const [allEvents, setAllEvents] = useState(true);
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [error, setError] = useState<string | null>(null);
    const [isSaving, setIsSaving] = useState(false);

    const createApi = useBackendApi<ApiWebhookCreateResp, ApiWebhookCreateReq>({
        method: 'POST',
        path: '/webhooks/create',
    });

    useEffect(() => {
        if (!isOpen) return;
        setName('');
        setUrl('');
        setSecret('');
        setAllEvents(true);
        setSelected(new Set());
        setError(null);
        setIsSaving(false);
    }, [isOpen]);

    //Group the catalogue by prefix (server, player, whitelist...) for the checkbox grid
    const groups = eventTypes.reduce<Record<string, ApiEventType[]>>((acc, type) => {
        const prefix = type.split('.')[0];
        (acc[prefix] ??= []).push(type);
        return acc;
    }, {});

    const toggle = (type: string, checked: boolean) => {
        setSelected((prev) => {
            const next = new Set(prev);
            if (checked) next.add(type); else next.delete(type);
            return next;
        });
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        if (!name.trim()) return setError('Name is required.');
        if (!/^https?:\/\//i.test(url.trim())) return setError('URL must start with http:// or https://.');
        if (!allEvents && !selected.size) return setError('Select at least one event, or send all events.');
        if (secret && secret.length < API_WEBHOOK_SECRET_MIN_LENGTH) return setError(`Secret must be at least ${API_WEBHOOK_SECRET_MIN_LENGTH} characters.`);

        setIsSaving(true);
        try {
            const resp = await createApi({
                data: {
                    name: name.trim(),
                    url: url.trim(),
                    events: allEvents ? ['*'] : [...selected],
                    ...(secret ? { secret } : {}),
                },
            });
            if (!resp) throw new Error('No response from server.');
            if ('error' in resp) throw new Error(resp.error.message);
            onCreated(resp.data.webhook.name, resp.data.secret);
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
                        <DialogTitle>New webhook</DialogTitle>
                        <DialogDescription>
                            txAdmin will POST a signed JSON body to this URL for every selected event. The signing secret is shown once after creation.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="space-y-1.5">
                            <Label htmlFor="webhook-name">Name</Label>
                            <Input
                                id="webhook-name"
                                value={name}
                                maxLength={API_WEBHOOK_NAME_MAX_LENGTH}
                                placeholder="e.g. website"
                                autoFocus
                                onChange={(e) => setName(e.target.value)}
                            />
                        </div>
                        <div className="space-y-1.5">
                            <Label htmlFor="webhook-secret">Secret <span className="text-muted-foreground font-normal">(optional)</span></Label>
                            <Input
                                id="webhook-secret"
                                className="font-mono text-xs"
                                value={secret}
                                minLength={API_WEBHOOK_SECRET_MIN_LENGTH}
                                maxLength={API_WEBHOOK_SECRET_MAX_LENGTH}
                                placeholder="generated if empty"
                                autoComplete="off"
                                onChange={(e) => setSecret(e.target.value)}
                            />
                        </div>
                    </div>

                    <div className="space-y-1.5">
                        <Label htmlFor="webhook-url">URL</Label>
                        <Input
                            id="webhook-url"
                            className="font-mono text-xs"
                            value={url}
                            maxLength={API_WEBHOOK_URL_MAX_LENGTH}
                            placeholder="https://example.com/hooks/txadmin"
                            onChange={(e) => setUrl(e.target.value)}
                        />
                    </div>

                    <div className="space-y-1.5">
                        <Label>Events</Label>
                        <label className="flex items-center gap-2 text-sm cursor-pointer">
                            <Checkbox checked={allEvents} onCheckedChange={(c) => setAllEvents(c === true)} />
                            <span className="font-semibold">All events</span>
                            <span className="text-muted-foreground">(including ones added later)</span>
                        </label>
                        {!allEvents && (
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 max-h-64 overflow-y-auto border rounded-md p-3">
                                {Object.entries(groups).map(([prefix, types]) => (
                                    <div key={prefix} className="space-y-1">
                                        <div className="text-xs uppercase tracking-wide text-muted-foreground">{prefix}</div>
                                        {types.map((type) => (
                                            <label key={type} className="flex items-center gap-2 text-sm cursor-pointer">
                                                <Checkbox
                                                    checked={selected.has(type)}
                                                    onCheckedChange={(c) => toggle(type, c === true)}
                                                />
                                                <span className="font-mono text-xs">{type}</span>
                                            </label>
                                        ))}
                                    </div>
                                ))}
                            </div>
                        )}
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
                            Create webhook
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}
