import { getTfBuildLabel } from "@/lib/tfBuild";
import { cn } from "@/lib/utils";

/**
 * The running tfAdmin build and FXServer artifact, e.g. `tf: r214 | fx: b37133`.
 */
export default function VersionLine({ className }: { className?: string }) {
    const { txaVersion, tfaBuild, fxsVersion } = window.txConsts;
    const tfLabel = getTfBuildLabel();
    const tooltip = tfaBuild
        ? `tfAdmin ${tfLabel} (${tfaBuild.commit}), based on txAdmin v${txaVersion}`
        : `txAdmin v${txaVersion}`;

    return (
        <span
            title={tooltip}
            className={cn(
                'text-muted-foreground',
                (txaVersion.includes('-') || tfaBuild?.commit.endsWith('-dirty')) && 'text-destructive-inline font-semibold',
                className,
            )}
        >
            tf: <strong>{tfLabel}</strong>
            &nbsp;|
            fx: <strong>b{fxsVersion}</strong>
        </span>
    );
}
