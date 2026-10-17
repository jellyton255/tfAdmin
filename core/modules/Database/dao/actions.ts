import { cloneDeep } from 'lodash-es';
import { DbInstance, SavePriority } from "../instance";
import { DatabaseActionBanType, DatabaseActionKickType, DatabaseActionType, DatabaseActionWarnType, DatabaseNoteType } from "../databaseTypes";
import { genActionID } from "../dbUtils";
import { now } from '@lib/misc';
import { appendNote, editNote, softDeleteNote } from '@lib/notes';
import consoleFactory from '@lib/console';
const console = consoleFactory('DatabaseDao');


/**
 * Data access object for the database "actions" collection.
 */
export default class ActionsDao {
    constructor(private readonly db: DbInstance) { }

    private get dbo() {
        if (!this.db.obj || !this.db.isReady) throw new Error(`database not ready yet`);
        return this.db.obj;
    }

    private get chain() {
        if (!this.db.obj || !this.db.isReady) throw new Error(`database not ready yet`);
        return this.db.obj.chain;
    }


    /**
     * Searches for an action in the database by the id, returns action or null if not found
     */
    findOne(actionId: string): DatabaseActionType | null {
        if (typeof actionId !== 'string' || !actionId.length) throw new Error('Invalid actionId.');

        //Performing search
        const a = this.chain.get('actions')
            .find({ id: actionId })
            .cloneDeep()
            .value();
        return (typeof a === 'undefined') ? null : a;
    }


    /**
     * Searches for any registered action in the database by a list of identifiers and optional filters
     * Usage example: findMany(['license:xxx'], undefined, {type: 'ban', revocation.timestamp: null})
     */
    findMany<T extends DatabaseActionType>(
        idsArray: string[],
        hwidsArray?: string[],
        customFilter: ((action: DatabaseActionType) => action is T) | object = {}
    ): T[] {
        if (!Array.isArray(idsArray)) throw new Error('idsArray should be an array');
        if (hwidsArray && !Array.isArray(hwidsArray)) throw new Error('hwidsArray should be an array or undefined');
        const idsFilter = (action: DatabaseActionType) => idsArray.some((fi) => action.ids.includes(fi))
        const hwidsFilter = (action: DatabaseActionType) => {
            if ('hwids' in action && action.hwids) {
                const count = hwidsArray!.filter((fi) => action.hwids?.includes(fi)).length;
                return count >= txConfig.banlist.requiredHwidMatches;
            } else {
                return false;
            }
        }

        try {
            //small optimization
            const idsMatchFilter = hwidsArray && hwidsArray.length && txConfig.banlist.requiredHwidMatches
                ? (a: DatabaseActionType) => idsFilter(a) || hwidsFilter(a)
                : (a: DatabaseActionType) => idsFilter(a)

            return this.chain.get('actions')
                .filter(customFilter as (a: DatabaseActionType) => a is T)
                .filter(idsMatchFilter)
                .cloneDeep()
                .value()
                .sort((a, b) => a.timestamp - b.timestamp); //FIXME: shouldn't be needed, remove after the autosort migration
        } catch (error) {
            const msg = `Failed to search for a registered action database with error: ${(error as Error).message}`;
            console.verbose.error(msg);
            throw new Error(msg);
        }
    }


    /**
     * Registers a ban action and returns its id
     */
    registerBan(
        ids: string[],
        author: string,
        reason: string,
        expiration: number | false,
        playerName: string | false = false,
        hwids?: string[], //only used for bans
    ): string {
        //Sanity check
        if (!Array.isArray(ids) || !ids.length) throw new Error('Invalid ids array.');
        if (typeof author !== 'string' || !author.length) throw new Error('Invalid author.');
        if (typeof reason !== 'string' || !reason.length) throw new Error('Invalid reason.');
        if (expiration !== false && (typeof expiration !== 'number')) throw new Error('Invalid expiration.');
        if (playerName !== false && (typeof playerName !== 'string' || !playerName.length)) throw new Error('Invalid playerName.');
        if (hwids && !Array.isArray(hwids)) throw new Error('Invalid hwids array.');

        //Saves it to the database
        const timestamp = now();
        try {
            const actionID = genActionID(this.dbo, 'ban');
            const toDB: DatabaseActionBanType = {
                id: actionID,
                type: 'ban',
                ids,
                hwids,
                playerName,
                reason,
                author,
                timestamp,
                expiration,
                revocation: {
                    timestamp: null,
                    author: null,
                },
            };
            this.chain.get('actions')
                .push(toDB)
                .value();
            this.db.writeFlag(SavePriority.HIGH);
            return actionID;
        } catch (error) {
            let msg = `Failed to register ban to database with message: ${(error as Error).message}`;
            console.error(msg);
            console.verbose.dir(error);
            throw error;
        }
    }


    /**
     * Searches for an imported ban by its external reference, returns the ban or null if not found
     */
    findByExternalRef(ref: string): DatabaseActionBanType | null {
        if (typeof ref !== 'string' || !ref.length) throw new Error('Invalid externalRef.');
        const a = this.chain.get('actions')
            .find((action) => action.type === 'ban' && action.externalRef === ref)
            .cloneDeep()
            .value();
        return (a && a.type === 'ban') ? a : null;
    }


    /**
     * Registers a ban imported from another system (author label, absolute expiration) and returns its id
     */
    importBan({ ids, hwids, playerName, reason, author, expiration, externalRef }: {
        ids: string[];
        hwids?: string[];
        playerName: string | false;
        reason: string;
        author: string;
        expiration: number | false;
        externalRef: string;
    }): string {
        //Sanity check
        if (!Array.isArray(ids) || !ids.length) throw new Error('Invalid ids array.');
        if (typeof author !== 'string' || !author.length) throw new Error('Invalid author.');
        if (typeof reason !== 'string' || !reason.length) throw new Error('Invalid reason.');
        if (expiration !== false && (typeof expiration !== 'number')) throw new Error('Invalid expiration.');
        if (playerName !== false && (typeof playerName !== 'string' || !playerName.length)) throw new Error('Invalid playerName.');
        if (hwids && !Array.isArray(hwids)) throw new Error('Invalid hwids array.');
        if (typeof externalRef !== 'string' || !externalRef.length) throw new Error('Invalid externalRef.');

        //Saves it to the database
        try {
            const actionID = genActionID(this.dbo, 'ban');
            const toDB: DatabaseActionBanType = {
                id: actionID,
                type: 'ban',
                ids,
                hwids,
                playerName,
                reason,
                author,
                timestamp: now(),
                expiration,
                externalRef,
                revocation: {
                    timestamp: null,
                    author: null,
                },
            };
            this.chain.get('actions')
                .push(toDB)
                .value();
            this.db.writeFlag(SavePriority.HIGH);
            return actionID;
        } catch (error) {
            console.error(`Failed to import ban to database with message: ${(error as Error).message}`);
            console.verbose.dir(error);
            throw error;
        }
    }


    /**
     * Registers a warn action and returns its id
     */
    registerWarn(
        ids: string[],
        author: string,
        reason: string,
        playerName: string | false = false,
    ): string {
        //Sanity check
        if (!Array.isArray(ids) || !ids.length) throw new Error('Invalid ids array.');
        if (typeof author !== 'string' || !author.length) throw new Error('Invalid author.');
        if (typeof reason !== 'string' || !reason.length) throw new Error('Invalid reason.');
        if (playerName !== false && (typeof playerName !== 'string' || !playerName.length)) throw new Error('Invalid playerName.');

        //Saves it to the database
        const timestamp = now();
        try {
            const actionID = genActionID(this.dbo, 'warn');
            const toDB: DatabaseActionWarnType = {
                id: actionID,
                type: 'warn',
                ids,
                playerName,
                reason,
                author,
                timestamp,
                expiration: false,
                acked: false,
                revocation: {
                    timestamp: null,
                    author: null,
                },
            };
            this.chain.get('actions')
                .push(toDB)
                .value();
            this.db.writeFlag(SavePriority.HIGH);
            return actionID;
        } catch (error) {
            let msg = `Failed to register warn to database with message: ${(error as Error).message}`;
            console.error(msg);
            console.verbose.dir(error);
            throw error;
        }
    }

    /**
     * Marks a warning as acknowledged
     */
    ackWarn(actionId: string) {
        if (typeof actionId !== 'string' || !actionId.length) throw new Error('Invalid actionId.');

        try {
            const action = this.chain.get('actions')
                .find({ id: actionId })
                .value();
            if (!action) throw new Error(`action not found`);
            if (action.type !== 'warn') throw new Error(`action is not a warn`);
            action.acked = true;
            this.db.writeFlag(SavePriority.MEDIUM);
        } catch (error) {
            const msg = `Failed to ack warn with message: ${(error as Error).message}`;
            console.error(msg);
            console.verbose.dir(error);
            throw error;
        }
    }


    /**
     * Registers a kick action and returns its id. Kicks are a record only: never active, never revoked.
     */
    registerKick(
        ids: string[],
        author: string,
        reason: string,
        playerName: string | false = false,
    ): string {
        //Sanity check
        if (!Array.isArray(ids) || !ids.length) throw new Error('Invalid ids array.');
        if (typeof author !== 'string' || !author.length) throw new Error('Invalid author.');
        if (typeof reason !== 'string' || !reason.length) throw new Error('Invalid reason.');
        if (playerName !== false && (typeof playerName !== 'string' || !playerName.length)) throw new Error('Invalid playerName.');

        //Saves it to the database
        try {
            const actionID = genActionID(this.dbo, 'kick');
            const toDB: DatabaseActionKickType = {
                id: actionID,
                type: 'kick',
                ids,
                playerName,
                reason,
                author,
                timestamp: now(),
                expiration: false,
                revocation: {
                    timestamp: null,
                    author: null,
                },
            };
            this.chain.get('actions')
                .push(toDB)
                .value();
            this.db.writeFlag(SavePriority.HIGH);
            return actionID;
        } catch (error) {
            console.error(`Failed to register kick to database with message: ${(error as Error).message}`);
            console.verbose.dir(error);
            throw error;
        }
    }


    /**
     * Applies a change to the notes of an action and returns the changed note.
     */
    private changeNotes(
        actionId: string,
        change: (notes: DatabaseNoteType[] | undefined) => { history: DatabaseNoteType[]; note: DatabaseNoteType },
    ): DatabaseNoteType {
        const action = this.chain.get('actions')
            .find({ id: actionId })
            .value();
        if (!action) throw new Error('action not found');
        const { history, note } = change(action.notes);
        action.notes = history;
        this.db.writeFlag(SavePriority.HIGH);
        return cloneDeep(note);
    }

    /**
     * Adds a staff note to an action and returns it
     */
    addNote(actionId: string, text: string, author: string): DatabaseNoteType {
        if (typeof text !== 'string' || !text.length) throw new Error('Invalid note.');
        if (typeof author !== 'string' || !author.length) throw new Error('Invalid author.');
        return this.changeNotes(actionId, (notes) => appendNote(notes, text, author, now()));
    }

    /**
     * Attaches an existing note (moved from a player) keeping its author and time
     */
    attachNote(actionId: string, note: DatabaseNoteType): DatabaseNoteType {
        return this.changeNotes(actionId, (notes) => appendNote(notes, note.text, note.author, note.ts, note.id));
    }

    /**
     * Replaces the text of a visible note
     */
    editNote(actionId: string, noteId: string, text: string): DatabaseNoteType {
        if (typeof text !== 'string' || !text.length) throw new Error('Invalid note.');
        return this.changeNotes(actionId, (notes) => editNote(notes, noteId, text, now()));
    }

    /**
     * Soft deletes a note: it stays in the database with who deleted it and when
     */
    deleteNote(actionId: string, noteId: string, author: string): DatabaseNoteType {
        return this.changeNotes(actionId, (notes) => softDeleteNote(notes, noteId, author, now()));
    }


    /**
     * Revoke an action (ban, warn). Kicks cannot be revoked.
     */
    revoke(
        actionId: string,
        author: string,
        allowedTypes: string[] | true = true,
        reason?: string,
    ): DatabaseActionType {
        if (typeof actionId !== 'string' || !actionId.length) throw new Error('Invalid actionId.');
        if (typeof author !== 'string' || !author.length) throw new Error('Invalid author.');
        if (allowedTypes !== true && !Array.isArray(allowedTypes)) throw new Error('Invalid allowedTypes.');

        try {
            const action = this.chain.get('actions')
                .find({ id: actionId })
                .value();

            if (!action) throw new Error(`action not found`);
            if (action.type === 'kick') throw new Error(`kicks cannot be revoked`);
            if (allowedTypes !== true && !allowedTypes.includes(action.type)) {
                throw new Error(`you do not have permission to revoke this action`);
            }

            action.revocation = {
                timestamp: now(),
                author,
                ...(reason ? { reason } : {}),
            };
            this.db.writeFlag(SavePriority.HIGH);
            return cloneDeep(action);

        } catch (error) {
            const msg = `Failed to revoke action with message: ${(error as Error).message}`;
            console.error(msg);
            console.verbose.dir(error);
            throw error;
        }
    }
}
