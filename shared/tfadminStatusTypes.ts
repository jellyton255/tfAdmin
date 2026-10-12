import type { GenericApiErrorResp } from "./genericApiTypes";

/**
 * A tfAdmin build, read from its `.tfadmin-build` stamp.
 * `build` counts master's commits since the fork; older builds have none.
 */
export type TfadminBuild = {
    build: number | null;
    commit: string;
};

/**
 * Written by /usr/local/sbin/tfadmin-nightly into /var/lib/tfadmin-nightly/status.json.
 */
export type TfadminNightlyStatus = {
    checkedAt: string;
    result: 'staged' | 'up_to_date' | 'smoke_failed' | 'failed';
    commit?: string;
    stagedCommit?: string;
    message?: string;
};

export type TfadminUpstreamStatus = {
    checkedAt: string;
    state: 'up_to_date' | 'clean' | 'conflicts' | 'error';
    base?: string;
    upstream?: string;
    behind?: number;
    releases?: string[];
    conflicts?: string[];
    message?: string;
};

export type TfadminStatus = {
    running: TfadminBuild | null;
    /** Build staged for the next restart (Main only), when it differs from the running one. */
    pending: TfadminBuild | null;
    nightly: TfadminNightlyStatus | null;
    upstream: TfadminUpstreamStatus | null;
};

export type TfadminStatusResp = TfadminStatus | GenericApiErrorResp;
