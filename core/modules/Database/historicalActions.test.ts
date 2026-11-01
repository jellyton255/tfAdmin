import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Low } from 'lowdb';
import { JSONFile } from 'lowdb/node';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { importHistoricalActions } from './historicalActions';
import type { DatabaseDataType } from './databaseTypes';

let directory: string;
let dbPath: string;
let inputPath: string;
let dbo: Low<DatabaseDataType>;
const timestamp = 1670000000;
const metadata = {
    sourceUrl: 'https://discord.com/channels/1019003474098270328/1053165663826489385',
    ids: [], playerName: 'Legacy Name', author: 'Original Staff', reason: 'Original reason', timestamp,
    duration: null, expirationKnown: true,
    notes: [{ id: 'source-note', text: 'Original evidence https://example.com/clip', author: 'Original Staff', ts: timestamp }],
};

beforeEach(async () => {
    directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'txhistory-'));
    dbPath = path.join(directory, 'playersDB.json');
    inputPath = path.join(directory, 'historicalActionsImport.json');
    dbo = new Low<DatabaseDataType>(new JSONFile(dbPath), {
        version: 6, players: [], actions: [], whitelistApprovals: [], whitelistRequests: [],
    });
    await dbo.write();
});
afterEach(async () => { await fsp.rm(directory, { recursive: true, force: true }); });

async function writeInput(actions: unknown[]) {
    await fsp.writeFile(inputPath, JSON.stringify({ version: 1, actions }));
}

describe('historical punishment import', () => {
    it('persists original types, dates, expiry and evidence once, backing up existing data', async () => {
        const original = await fsp.readFile(dbPath, 'utf8');
        await writeInput([
            { ...metadata, externalRef: 'discord:ban', type: 'ban', expiration: timestamp + 86400 },
            { ...metadata, externalRef: 'discord:warn', type: 'warn', expiration: false },
            { ...metadata, externalRef: 'discord:kick', type: 'kick', expiration: false },
        ]);
        expect(await importHistoricalActions(dbo, dbPath, inputPath)).toBe(3);
        const stored = new Low<DatabaseDataType>(new JSONFile(dbPath), dbo.data);
        await stored.read();
        expect(stored.data.actions.map((action) => [action.type, action.timestamp, action.expiration])).toEqual([
            ['ban', timestamp, timestamp + 86400], ['warn', timestamp, false], ['kick', timestamp, false],
        ]);
        expect(stored.data.actions[0]).toMatchObject({
            playerName: 'Legacy Name', author: 'Original Staff', ids: [], notes: metadata.notes,
            historical: { externalRef: 'discord:ban', sourceUrl: metadata.sourceUrl, expirationKnown: true },
        });
        const backups = (await fsp.readdir(directory)).filter((name) => name.includes('before-history-import'));
        expect(backups).toHaveLength(1);
        expect(await fsp.readFile(path.join(directory, backups[0]), 'utf8')).toBe(original);
        expect(await importHistoricalActions(stored, dbPath, inputPath)).toBe(0);
        expect(stored.data.actions).toHaveLength(3);
    });

    it('attaches a matching source to its existing action without changing its punishment or dates', async () => {
        const existing = {
            id: 'BAAA-1111', type: 'ban' as const, ids: ['license:' + 'a'.repeat(40)],
            playerName: 'Legacy Name', author: 'Actual Staff', reason: 'Original reason',
            timestamp: timestamp - 60, expiration: false as const,
            revocation: { timestamp: null, author: null },
        };
        const original = structuredClone(existing);
        dbo.data.actions.push(existing);
        await dbo.write();
        await writeInput([{ ...metadata, existingActionId: existing.id, externalRef: 'discord:existing', type: 'ban', expiration: false }]);
        expect(await importHistoricalActions(dbo, dbPath, inputPath)).toBe(1);
        expect(dbo.data.actions).toHaveLength(1);
        expect(dbo.data.actions[0]).toEqual({ ...original, notes: metadata.notes });
        expect(dbo.data.actions[0].historical).toBeUndefined();
        expect(await importHistoricalActions(dbo, dbPath, inputPath)).toBe(0);
        expect(dbo.data.actions[0].notes).toHaveLength(1);
    });

    it.each([
        [{ ...metadata, externalRef: 'bad:future', type: 'ban', expiration: false, timestamp: 9999999999 }],
        [{ ...metadata, externalRef: 'bad:expiry', type: 'warn', expiration: timestamp + 10 }],
        [{ ...metadata, externalRef: 'bad:id', type: 'ban', expiration: false, ids: ['license:invalid'] }],
        [{ ...metadata, externalRef: 'duplicate', type: 'kick', expiration: false }, { ...metadata, externalRef: 'duplicate', type: 'kick', expiration: false }],
    ])('rejects invalid batches before changing the database', async (...actions) => {
        const original = await fsp.readFile(dbPath, 'utf8');
        await writeInput(actions);
        await expect(importHistoricalActions(dbo, dbPath, inputPath)).rejects.toThrow();
        expect(await fsp.readFile(dbPath, 'utf8')).toBe(original);
        expect(dbo.data.actions).toEqual([]);
    });

    it('does nothing when no import file is staged', async () => {
        expect(await importHistoricalActions(dbo, dbPath, inputPath)).toBe(0);
        expect(dbo.data.actions).toEqual([]);
    });
});
