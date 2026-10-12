/**
 * Short label for the running tfAdmin build: `r214`, the commit for builds from
 * before build numbers, or the txAdmin version when the monitor has no stamp.
 */
export function getTfBuildLabel() {
    const { tfaBuild, txaVersion } = window.txConsts;
    if (!tfaBuild) return `v${txaVersion}`;
    return tfaBuild.build ? `r${tfaBuild.build}` : tfaBuild.commit;
}
