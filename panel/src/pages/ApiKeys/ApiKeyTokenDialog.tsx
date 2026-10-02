import { useState } from "react";
import { CheckIcon, CopyIcon } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { txToast } from "@/components/TxToaster";


type Props = {
    data: { name: string; token: string } | null;
    onClose: () => void;
};

export default function ApiKeyTokenDialog({ data, onClose }: Props) {
    const [copied, setCopied] = useState(false);

    const handleCopy = async () => {
        if (!data) return;
        try {
            await navigator.clipboard.writeText(data.token);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch (error) {
            txToast.error({ title: 'Copy failed', msg: 'Select the token and copy it manually.' });
        }
    };

    return (
        <Dialog open={!!data} onOpenChange={(open) => { if (!open) { setCopied(false); onClose(); } }}>
            <DialogContent className="max-w-lg">
                <DialogHeader>
                    <DialogTitle>API key created</DialogTitle>
                    <DialogDescription>
                        Copy the token for <span className="font-semibold">{data?.name}</span> now. It will not be shown again.
                    </DialogDescription>
                </DialogHeader>

                <div className="flex items-stretch gap-2">
                    <code className="flex-1 font-mono text-xs sm:text-sm break-all rounded-md border bg-muted px-3 py-2 select-all">
                        {data?.token}
                    </code>
                    <Button variant="outline" size="icon" onClick={handleCopy} title="Copy token">
                        {copied ? <CheckIcon className="size-4 text-success" /> : <CopyIcon className="size-4" />}
                    </Button>
                </div>

                <Alert>
                    <AlertTitle>How to use it</AlertTitle>
                    <AlertDescription className="font-mono text-xs break-all">
                        curl -H "Authorization: Bearer {data?.token}" {window.location.origin}/api/v1/me
                    </AlertDescription>
                </Alert>

                <DialogFooter>
                    <Button onClick={onClose}>Done</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
