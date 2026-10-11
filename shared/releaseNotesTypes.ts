export type ReleaseNoteType = 'feat' | 'fix' | 'perf';

/**
 * One tfAdmin change, taken from its commit subject at build time.
 */
export type ReleaseNote = {
    commit: string; //short hash of the change
    landedAt: string; //ISO date the change reached master
    type: ReleaseNoteType;
    scope: string | null;
    text: string;
};
