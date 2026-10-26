import { Loader2Icon } from "lucide-react";

/**
 * Bordered list panel shared by the allowlist sections: title row with count and controls,
 * then the rows or a one-line status.
 */
export default function AllowlistSection({ title, count, controls, error, isLoading, emptyMessage, children, footer }: {
    title: string;
    count?: string;
    controls?: React.ReactNode;
    error?: Error;
    isLoading: boolean;
    emptyMessage: string | null;
    children?: React.ReactNode;
    footer?: React.ReactNode;
}) {
    let body: React.ReactNode;
    if (error) {
        body = <div className="px-4 py-8 text-center text-destructive-inline">{error.message}</div>;
    } else if (isLoading) {
        body = (
            <div className="flex items-center justify-center px-4 py-8 text-muted-foreground">
                <Loader2Icon className="animate-spin size-5 mr-2" /> Loading...
            </div>
        );
    } else if (emptyMessage) {
        body = <div className="px-4 py-8 text-center text-muted-foreground">{emptyMessage}</div>;
    } else {
        body = <div className="divide-y">{children}</div>;
    }

    return (
        <section className="border rounded-lg bg-card overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3 border-b">
                <h2 className="font-semibold">
                    {title}
                    {count && <span className="ml-1.5 font-normal text-muted-foreground tabular-nums">{count}</span>}
                </h2>
                {controls}
            </div>
            {body}
            {footer}
        </section>
    );
}
