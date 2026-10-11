import { execFileSync } from 'node:child_process';
import type { Plugin } from 'vite';
import type { ReleaseNote, ReleaseNoteType } from '../shared/releaseNotesTypes';

/**
 * Last upstream txAdmin commit before the tfAdmin fork.
 */
const FORK_BASE = '8a9a41410000fd92a527fe11bae2b8eeeb8b10e0';
const NOTE_TYPES: ReleaseNoteType[] = ['feat', 'fix', 'perf'];
const PR_MERGE = /^(hidden: )?merge pull request #\d+/i;
const CONVENTIONAL_SUBJECT = /^(\w+)(?:\(([^)]+)\))?!?:\s*(.+)$/;
const MODULE_ID = 'virtual:release-notes';
const RESOLVED_ID = '\0' + MODULE_ID;


/**
 * Turns a commit subject into a release note, following the dev feed rules:
 * `hidden:` subjects are dropped and anything from `internal:` on is masked.
 */
export function parseReleaseNoteSubject(subject: string) {
    if (subject.startsWith('hidden:')) return null;
    const match = CONVENTIONAL_SUBJECT.exec(subject.trim());
    if (!match) return null;
    const [, type, scope, rawText] = match;
    const noteType = NOTE_TYPES.find((t) => t === type);
    if (!noteType) return null;

    const text = rawText.split(/\binternal:/)[0].trim().replace(/[\s.,;:-]+$/, '');
    if (!text) return null;
    return {
        type: noteType,
        scope: scope?.trim() || null,
        text: text[0].toUpperCase() + text.slice(1),
    };
}


type CommitRecord = { hash: string; parents: string[]; date: string; subject: string };
function gitLog(repoDir: string, args: string[]): CommitRecord[] {
    const out = execFileSync('git', ['log', '--format=%H%x1f%P%x1f%cI%x1f%s%x1e', ...args], {
        cwd: repoDir,
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
    });
    return out.split('\x1e').map((r) => r.trim()).filter(Boolean).map((record) => {
        const [hash, parents, date, subject] = record.split('\x1f');
        return { hash, parents: parents.split(' ').filter(Boolean), date, subject };
    });
}


/**
 * Collects the fork's notes, newest first.
 * Walks master's first-parent line and opens only tfAdmin pull request merges,
 * so commits brought in by upstream merges never become notes.
 */
export function collectReleaseNotes(repoDir: string): ReleaseNote[] {
    execFileSync('git', ['cat-file', '-e', `${FORK_BASE}^{commit}`], { cwd: repoDir, stdio: 'pipe' });

    const notes: ReleaseNote[] = [];
    const addNote = (commit: CommitRecord, landedAt: string) => {
        const parsed = parseReleaseNoteSubject(commit.subject);
        if (!parsed) return;
        notes.push({ commit: commit.hash.slice(0, 8), landedAt, ...parsed });
    };

    for (const commit of gitLog(repoDir, ['--first-parent', `${FORK_BASE}..HEAD`])) {
        if (commit.parents.length < 2) {
            addNote(commit, commit.date);
        } else if (PR_MERGE.test(commit.subject)) {
            const [base, branch] = commit.parents;
            for (const inner of gitLog(repoDir, ['--no-merges', `${base}..${branch}`])) {
                addNote(inner, commit.date);
            }
        }
    }
    return notes;
}


/**
 * Exposes the notes to the panel as `virtual:release-notes`.
 * Fails the build when git history is unavailable instead of shipping an empty list.
 */
export function releaseNotesPlugin(repoDir: string): Plugin {
    return {
        name: 'tfadmin-release-notes',
        resolveId(id) {
            if (id === MODULE_ID) return RESOLVED_ID;
        },
        load(id) {
            if (id !== RESOLVED_ID) return;
            return `export default ${JSON.stringify(collectReleaseNotes(repoDir))};`;
        },
    };
}
