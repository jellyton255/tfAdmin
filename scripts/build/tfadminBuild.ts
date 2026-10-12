import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Last upstream txAdmin commit before the tfAdmin fork.
 */
export const FORK_BASE = '8a9a41410000fd92a527fe11bae2b8eeeb8b10e0';

const git = (repoDir: string, args: string[]) => execFileSync('git', args, {
    cwd: repoDir,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
}).trim();


/**
 * tfAdmin build number: how many commits master's first-parent line holds since the fork.
 * Every commit to master raises it by one, so it needs no release step.
 * Fails when git history is unavailable instead of stamping a wrong number.
 */
export const countBuilds = (repoDir: string) => {
    git(repoDir, ['cat-file', '-e', `${FORK_BASE}^{commit}`]);
    return Number(git(repoDir, ['rev-list', '--count', '--first-parent', `${FORK_BASE}..HEAD`]));
};


/**
 * Writes the `.tfadmin-build` stamp that the core, the deploy scripts and the
 * nightly job read. Deploy scripts append their own `deployed=` line to it.
 */
export const writeBuildStamp = (repoDir: string, distDir: string, txVersion: string) => {
    const commit = git(repoDir, ['rev-parse', '--short=8', 'HEAD']);
    const dirty = git(repoDir, ['status', '--porcelain', '--untracked-files=no']) ? '-dirty' : '';
    const build = countBuilds(repoDir);
    fs.writeFileSync(
        path.join(distDir, '.tfadmin-build'),
        `version=${txVersion}\nbuild=${build}\ncommit=${commit}${dirty}\n`,
    );
    console.log(`tfAdmin build r${build} (${commit}${dirty}).`);
};
