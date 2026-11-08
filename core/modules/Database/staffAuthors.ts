const modulename = 'DatabaseStaffAuthors';
import fsp from 'node:fs/promises';
import { txEnv } from '@core/globalData';
import consoleFactory from '@lib/console';
import type { DatabaseDataType } from './databaseTypes';
import type { DatabaseObjectType } from './instance';
const console = consoleFactory(modulename);

/**
 * One-time pass that gives staff actions recorded under an API key back to the staff member who took
 * them. Staff actions through the API now need an actor, so this only repairs older records:
 * - `<admin> (via api:<key>)` becomes `<admin>`.
 * - `api:<key>` becomes the admin the record names. EF Administration put the staff member's in-game
 *   name in brackets at the front of the reason or note, and the sanction's own attribution note shares
 *   its timestamp. Each in-game name below was matched to its admin by the Discord account it joined with.
 * - A few records name their staff member another way, listed by action id.
 * Records with no such evidence keep their author and are listed in the console.
 */

export const STAFF_AUTHORS_MARKER = 'staff-authors-from-api-keys';

//EF Administration's `[<in-game name>]` tag, and the Main admin account behind it
const STAFF_TAGS = new Map([
    ['Belsie', 'belsie'],
    ['TEDtheFED', 'TEDtheFED'],
    ['somefriggnidiot', 'somefriggnidiot'],
    ['kaeru', 'kaerunnie'],
    ['ItsSwifty', 'itsswifty'],
    ['Vidar', 'blight'],
    ['JellytonUS', 'Jellyton69'],
    ['ZeroTw0✨', 'zerotw0'],
]);
//A ticket ban signed "- Fragz" in its reason
const ACTION_ADMINS = new Map([['B2DV-DKBH', 'Fragz']]);

const viaApiSuffix = / \(via api:[^)]*\)$/;
const staffTag = /^\[([^\]]+)\]/;

export type StaffAuthorChange = { where: string; from: string; to: string };

/**
 * Rewrites API authors in place. `adminName` returns this server's spelling of an admin account,
 * or null when the account does not exist here.
 */
export function fixStaffAuthors(data: Pick<DatabaseDataType, 'players' | 'actions'>, adminName: (name: string) => string | null) {
    const changes: StaffAuthorChange[] = [];
    const unresolved: string[] = [];

    const fix = <T extends { author: string }>(record: T, where: string, texts: string[], namedAdmin?: string) => {
        const from = record.author;
        let to: string | null = null;
        if (viaApiSuffix.test(from)) {
            to = from.replace(viaApiSuffix, '');
        } else if (from.startsWith('api:')) {
            const tag = texts.map((text) => staffTag.exec(text)?.[1]).find((found) => found !== undefined);
            const name = namedAdmin ?? (tag ? STAFF_TAGS.get(tag) : undefined);
            to = name ? adminName(name) : null;
            if (!to) unresolved.push(`${where} (${from})`);
        }
        if (!to) return;
        record.author = to;
        changes.push({ where, from, to });
    };

    for (const action of data.actions) {
        const sanctionNotes = (action.notes ?? []).filter((note) => note.ts === action.timestamp).map((note) => note.text);
        fix(action, `action ${action.id}`, [action.reason, ...sanctionNotes], ACTION_ADMINS.get(action.id));
        if (action.revocation.author) {
            const revocation = { author: action.revocation.author };
            fix(revocation, `action ${action.id} revocation`, action.revocation.reason ? [action.revocation.reason] : []);
            action.revocation.author = revocation.author;
        }
        for (const note of action.notes ?? []) {
            fix(note, `action ${action.id} note ${note.id}`, [note.text]);
            if (note.deleted) fix(note.deleted, `action ${action.id} note ${note.id} deletion`, []);
        }
        if (action.type !== 'ban') continue;
        for (const change of action.lengthChanges ?? []) fix(change, `action ${action.id} length change`, [change.reason]);
        if (action.appeal) fix(action.appeal, `action ${action.id} appeal`, []);
    }

    for (const player of data.players) {
        for (const note of player.noteHistory ?? []) {
            fix(note, `player ${player.license} note ${note.id}`, [note.text]);
            if (note.deleted) fix(note.deleted, `player ${player.license} note ${note.id} deletion`, []);
        }
        if (player.watch) fix(player.watch, `player ${player.license} watch`, [player.watch.reason]);
    }

    return { changes, unresolved };
}


/**
 * Runs the pass once per database: backs the file up, rewrites the authors it can prove, logs each
 * change to the admin log, and stores the marker together with the changes.
 */
export async function runStaffAuthorsPass(dbo: DatabaseObjectType, dbPath: string) {
    const data = dbo.data;
    if (data.tfMigrations?.includes(STAFF_AUTHORS_MARKER)) return;

    const backupPath = `${txEnv.profilePath}/data/playersDB.backup.before-staff-authors.json`;
    await fsp.copyFile(dbPath, backupPath);

    const { changes, unresolved } = fixStaffAuthors(data, (name) => {
        const admin = txCore.adminStore.getAdminByName(name);
        return admin ? admin.name : null;
    });
    data.tfMigrations = [...(data.tfMigrations ?? []), STAFF_AUTHORS_MARKER];
    await dbo.write();

    for (const change of changes) {
        txCore.logger.admin.write('tfAdmin', `Recorded ${change.where} under ${change.to} instead of ${change.from}`);
    }
    for (const where of unresolved) console.warn(`No staff member found for ${where}; left as is.`);
    console.ok(`Gave ${changes.length} API-recorded staff actions back to their staff members (backup: ${backupPath}).`);
}
