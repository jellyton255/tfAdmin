import { connectionStateAtom } from '@/hooks/connection';
import { useAtomValue } from 'jotai';
import { Loader2Icon } from 'lucide-react';


/**
 * Covers the panel while txAdmin restarts or the socket reconnects, and clears itself once it is back.
 */
export default function ConnectionOverlay() {
    const connectionState = useAtomValue(connectionStateAtom);
    if (connectionState === 'online') return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 backdrop-blur-sm">
            <div className="flex items-center gap-3 rounded-lg border bg-card px-5 py-4 shadow-xl">
                <Loader2Icon className="size-5 animate-spin text-muted-foreground" />
                <span className="text-lg font-medium">
                    {connectionState === 'restarting' ? 'Restarting tfAdmin' : 'Reconnecting'}
                </span>
            </div>
        </div>
    );
}
