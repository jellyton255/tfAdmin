import fsp from 'node:fs/promises';
import { z } from 'zod';
import consts from '@shared/consts';
import { genActionID } from './dbUtils';
import type { DatabaseActionBaseType, DatabaseActionType, DatabaseNoteType } from './databaseTypes';
import type { DatabaseObjectType } from './instance';

const timestampSchema = z.number().int().positive();
const historicalActionSchema = z.object({
    existingActionId: z.string().min(1).max(32).optional(),
    externalRef: z.string().min(1).max(96).regex(/^[A-Za-z0-9_.:-]+$/),
    sourceUrl: z.string().url().refine((url) => url.startsWith('https://discord.com/channels/')),
    type: z.enum(['ban', 'warn', 'kick']),
    ids: z.array(z.string().refine((id) => Object.values(consts.validIdentifiers).some((regex) => regex.test(id)))).max(64),
    playerName: z.string().min(1).max(256).nullable(),
    author: z.string().min(1).max(256),
    reason: z.string().min(1).max(20000),
    timestamp: timestampSchema,
    expiration: z.union([timestampSchema, z.literal(false)]),
    duration: z.string().min(1).max(256).nullable(),
    expirationKnown: z.boolean(),
    notes: z.array(z.object({
        id: z.string().min(1).max(32),
        text: z.string().min(1).max(10000),
        author: z.string().min(1).max(256),
        ts: timestampSchema,
    }).strict()),
}).strict().superRefine((action, ctx) => {
    if (action.timestamp > Math.floor(Date.now() / 1000)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['timestamp'], message: 'Historical actions cannot be dated in the future.' });
    }
    if (action.type !== 'ban' && action.expiration !== false) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['expiration'], message: 'Only bans have an expiration.' });
    }
    if (action.expiration !== false && !action.expirationKnown) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['expiration'], message: 'An absolute expiration must be recorded as known.' });
    }
});

const importSchema = z.object({
    version: z.literal(1),
    actions: z.array(historicalActionSchema).min(1).max(20000),
}).strict().superRefine((input, ctx) => {
    const references = new Set<string>();
    for (const [index, action] of input.actions.entries()) {
        if (references.has(action.externalRef)) {
            ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['actions', index, 'externalRef'], message: 'Duplicate historical reference.' });
        }
        references.add(action.externalRef);
    }
});

/** Imports records before the database becomes ready. Historical actions never enforce punishments. */
export async function importHistoricalActions(
    dbo: Pick<DatabaseObjectType, 'data' | 'write'>,
    dbPath: string,
    inputPath: string,
) {
    let raw: string;
    try {
        raw = await fsp.readFile(inputPath, 'utf8');
    } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return 0;
        throw error;
    }
    const input = importSchema.parse(JSON.parse(raw));
    const references = new Set(dbo.data.actions.flatMap((action) => action.historical ? [action.historical.externalRef] : []));
    const ids = new Set(dbo.data.actions.map((action) => action.id));
    const additions: DatabaseActionType[] = [];
    const noteUpdates = new Map<DatabaseActionType, DatabaseNoteType[]>();
    for (const action of input.actions) {
        if (action.existingActionId) {
            const existing = dbo.data.actions.find((candidate) => candidate.id === action.existingActionId);
            if (!existing || existing.type !== action.type || existing.historical) {
                throw new Error(`Historical source target is missing or has the wrong type: ${action.existingActionId}`);
            }
            const notes = noteUpdates.get(existing) ?? existing.notes ?? [];
            const noteIds = new Set(notes.map((note) => note.id));
            const newNotes = action.notes.filter((note) => !noteIds.has(note.id));
            if (newNotes.length) noteUpdates.set(existing, [...notes, ...newNotes]);
            continue;
        }
        if (references.has(action.externalRef)) continue;
        const id = genActionID(ids, action.type);
        ids.add(id);
        const base: DatabaseActionBaseType = {
            id,
            ids: action.ids,
            playerName: action.playerName ?? false,
            reason: action.reason,
            author: action.author,
            timestamp: action.timestamp,
            revocation: { timestamp: null, author: null },
            notes: action.notes,
            historical: {
                externalRef: action.externalRef,
                sourceUrl: action.sourceUrl,
                duration: action.duration,
                expirationKnown: action.expirationKnown,
            },
        };
        if (action.type === 'ban') {
            additions.push({ ...base, type: 'ban', expiration: action.expiration });
        } else if (action.type === 'warn') {
            additions.push({ ...base, type: 'warn', expiration: false, acked: false });
        } else {
            additions.push({ ...base, type: 'kick', expiration: false });
        }
    }
    if (!additions.length && !noteUpdates.size) return 0;
    await fsp.copyFile(dbPath, `${dbPath}.before-history-import-${Date.now()}.json`);
    for (const [action, notes] of noteUpdates) action.notes = notes;
    dbo.data.actions.push(...additions);
    dbo.data.actions.sort((a, b) => a.timestamp - b.timestamp);
    await dbo.write();
    return additions.length + noteUpdates.size;
}
