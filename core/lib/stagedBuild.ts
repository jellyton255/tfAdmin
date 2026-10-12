import fs from 'node:fs';
import path from 'node:path';
import type { TfadminBuild } from '@shared/tfadminStatusTypes';


/**
 * Reads a tfAdmin build stamp (`.tfadmin-build`). Builds from before build
 * numbers existed carry only a commit.
 */
export const readBuildStamp = (dir: string): TfadminBuild | undefined => {
    let stamp: string;
    try {
        stamp = fs.readFileSync(path.join(dir, '.tfadmin-build'), 'utf8');
    } catch (error) {
        return;
    }
    const commit = stamp.match(/^commit=(\S+)$/m)?.[1];
    if (!commit) return;
    const build = stamp.match(/^build=(\d+)$/m)?.[1];
    return { build: build ? Number(build) : null, commit };
}

export const readBuildCommit = (dir: string) => readBuildStamp(dir)?.commit;

export const formatBuild = ({ build, commit }: TfadminBuild) => build ? `r${build} (${commit})` : commit;


/**
 * Returns the tfAdmin build staged in `stageDir` when it differs from the running
 * build in `runningDir`. The host launcher installs the staged folder over the
 * monitor every time the process starts.
 */
export const getPendingStagedBuild = (runningDir: string, stageDir: string | undefined) => {
    if (!stageDir) return;
    if (!fs.existsSync(path.join(stageDir, 'core', 'index.js'))) return;
    const staged = readBuildStamp(stageDir);
    if (!staged || staged.commit === readBuildCommit(runningDir)) return;
    return staged;
}
