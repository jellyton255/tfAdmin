import fs from 'node:fs';
import path from 'node:path';


/**
 * Reads the commit from a tfAdmin build stamp (`.tfadmin-build`).
 */
export const readBuildCommit = (dir: string) => {
    try {
        const stamp = fs.readFileSync(path.join(dir, '.tfadmin-build'), 'utf8');
        return stamp.match(/^commit=(\S+)$/m)?.[1];
    } catch (error) {
        return undefined;
    }
}


/**
 * Returns the commit of the tfAdmin build staged in `stageDir` when it differs from
 * the running build in `runningDir`. The host launcher installs the staged folder
 * over the monitor every time the process starts.
 */
export const getPendingStagedBuild = (runningDir: string, stageDir: string | undefined) => {
    if (!stageDir) return;
    if (!fs.existsSync(path.join(stageDir, 'core', 'index.js'))) return;
    const stagedCommit = readBuildCommit(stageDir);
    if (!stagedCommit || stagedCommit === readBuildCommit(runningDir)) return;
    return stagedCommit;
}
