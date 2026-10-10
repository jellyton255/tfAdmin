import { useState } from "react";
import { CheckIcon, CopyIcon } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { txToast } from "@/components/TxToaster";


type Props = {
    data: { name: string; password: string } | null;
    onClose: () => void;
};

export default function AdminPasswordDialog({ data, onClose }: Props) {
    const [copied, setCopied] = useState(false);

    const handleCopy = async () => {
        if (!data) return;
        try {
            await navigator.clipboard.writeText(data.password);
            setCopied(true);
        } catch (error) {
            txToast.error({ title: 'Copy Failed', msg: 'Select the password and copy it manually.' });
        }
    };

    const handleOpenChange = (open: boolean) => {
        if (open) return;
        setCopied(false);
        onClose();
    };

    return (
        <Dialog open={!!data} onOpenChange={handleOpenChange}>
            <DialogContent className="max-w-md">
                <DialogHeader>
                    <DialogTitle>Admin Saved</DialogTitle>
                    <DialogDescription>
                        Copy the temporary password for <span className="font-semibold">{data?.name}</span>.
                        They must change it on first login.
                    </DialogDescription>
                </DialogHeader>

                <div className="flex items-stretch gap-2">
                    <code className="flex-1 font-mono text-center text-base break-all rounded-md border bg-muted px-3 py-2 select-all">
                        {data?.password}
                    </code>
                    <Button variant="outline" size="icon" onClick={handleCopy} title="Copy Password">
                        {copied ? <CheckIcon className="size-4 text-success" /> : <CopyIcon className="size-4" />}
                    </Button>
                </div>

                <DialogFooter>
                    <Button onClick={() => handleOpenChange(false)}>Done</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
