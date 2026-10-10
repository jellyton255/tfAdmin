const modulename = 'TfadminStatus';
import fs from 'node:fs';
import { z } from 'zod';
import { txEnv } from '@core/globalData';
import consoleFactory from '@lib/console';
import { getPendingStagedBuild, readBuildCommit } from '@lib/stagedBuild';
import type { TfadminStatus } from '@shared/tfadminStatusTypes';
const console = consoleFactory(modulename);

//Written by the host's nightly job (/usr/local/sbin/tfadmin-nightly)
const STATUS_FILE = '/var/lib/tfadmin-nightly/status.json';

const statusFileSchema = z.object({
    nightly: z.object({
        checkedAt: z.string(),
        result: z.enum(['staged', 'up_to_date', 'smoke_failed', 'failed']),
        commit: z.string().optional(),
        stagedCommit: z.string().optional(),
        message: z.string().optional(),
    }).optional(),
    upstream: z.object({
        checkedAt: z.string(),
        state: z.enum(['up_to_date', 'clean', 'conflicts', 'error']),
        base: z.string().optional(),
        upstream: z.string().optional(),
        behind: z.number().int().nonnegative().optional(),
        releases: z.array(z.string()).optional(),
        conflicts: z.array(z.string()).optional(),
        message: z.string().optional(),
    }).optional(),
});


const readStatusFile = () => {
    let raw: string;
    try {
        raw = fs.readFileSync(STATUS_FILE, 'utf8');
    } catch (error) {
        return; //no nightly job on this host
    }
    try {
        return statusFileSchema.parse(JSON.parse(raw));
    } catch (error) {
        console.verbose.warn(`Ignoring invalid ${STATUS_FILE}: ${(error as Error).message}`);
    }
}


/**
 * Running vs staged tfAdmin build, plus the nightly job's last build and upstream merge results.
 */
export const getTfadminStatus = (): TfadminStatus => {
    const statusFile = readStatusFile();
    return {
        runningCommit: readBuildCommit(txEnv.txaPath) ?? null,
        pendingCommit: getPendingStagedBuild(txEnv.txaPath, process.env.TFADMIN_STAGE_DIR) ?? null,
        nightly: statusFile?.nightly ?? null,
        upstream: statusFile?.upstream ?? null,
    };
}
