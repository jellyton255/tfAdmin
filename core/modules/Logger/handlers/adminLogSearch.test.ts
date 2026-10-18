import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, expect, it, suite } from 'vitest';
import { inferAdminLogCategory, searchAdminLog } from './adminLogSearch';

const local = (y: number, mo: number, d: number, h = 0, mi = 0, s = 0) => new Date(y, mo - 1, d, h, mi, s).getTime();
const divider = (msg: string) => [
    '='.repeat(64),
    `======== ${msg}`.padEnd(64, ' '),
    '='.repeat(64),
];

const rotatedLines = [
    ...divider('Log Rotated - 10/10/2026, 12:00:00 AM'),
    '[22:00:00][Alice] Banned player "Bob": RDM',
    '[23:59:00][Alice] Sending announcement: Restart soon',
    'second line of the announcement',
    '[00:10:00][MONITOR] Server is not responding',
];
const activeLines = [
    ...divider('txAdmin v8.1.1 atop fxserver 12345 Starting - 10/12/2026, 2:00:00 PM'),
    '[14:00:00][Carol] logged in from 127.0.0.1 via password auth',
    '[14:01:00][Carol] executed "ensure ef_hud"',
    '[14:02:00][Carol] Kicked "Bob": AFK',
    '[14:02:00][Alice] Revoked ban id B1AB-2CD3 from Bob',
];

let basePath: string;
beforeAll(() => {
    basePath = fs.mkdtempSync(path.join(os.tmpdir(), 'adminlog-search-'));
    const rotatedPath = path.join(basePath, 'admin_2026-10-10_00-00-00_1.log');
    fs.writeFileSync(rotatedPath, rotatedLines.join('\n') + '\n');
    fs.utimesSync(rotatedPath, new Date(local(2026, 10, 11, 0, 10)), new Date(local(2026, 10, 11, 0, 10)));
    const activePath = path.join(basePath, 'admin.log');
    fs.writeFileSync(activePath, activeLines.join('\n') + '\n');
    fs.utimesSync(activePath, new Date(local(2026, 10, 12, 14, 2)), new Date(local(2026, 10, 12, 14, 2)));
    //not an admin log
    fs.writeFileSync(path.join(basePath, 'server.log'), activeLines.join('\n'));
});
afterAll(() => {
    fs.rmSync(basePath, { recursive: true, force: true });
});


suite('inferAdminLogCategory', () => {
    it('reads the category from the message', () => {
        expect(inferAdminLogCategory('Alice', 'Banned player "Bob": RDM')).toBe('ban');
        expect(inferAdminLogCategory('Alice', 'Kicked "Bob": AFK')).toBe('kick');
        expect(inferAdminLogCategory('Alice', 'Kicking all players: restart')).toBe('server');
        expect(inferAdminLogCategory('Alice', 'executed "RESTART SERVER"')).toBe('server');
        expect(inferAdminLogCategory('Alice', 'executed "ensure ef_hud"')).toBe('command');
        expect(inferAdminLogCategory('Alice', 'Ensured resource "ef_hud"')).toBe('resource');
        expect(inferAdminLogCategory('Alice', 'Added a note to ban B1AB-2CD3')).toBe('note');
        expect(inferAdminLogCategory('Alice', 'Removed abc from the watchlist.')).toBe('player');
        expect(inferAdminLogCategory('Alice', 'Approved whitelist request from Bob.')).toBe('whitelist');
        expect(inferAdminLogCategory('Alice', 'Changing own password.')).toBe('login');
        expect(inferAdminLogCategory('Alice', 'Changing discordBot settings.')).toBe('settings');
        expect(inferAdminLogCategory('Alice', 'Revoked API key \'Bot\' (k1)')).toBe('api');
        expect(inferAdminLogCategory('MONITOR', 'Server is not responding')).toBe('system');
        expect(inferAdminLogCategory('Alice', 'something new')).toBe('other');
    });

    it('ignores the resource prefix of game script entries', () => {
        expect(inferAdminLogCategory('Anticheat', '[ef_anticheat] Banned player "Bob": cheating')).toBe('ban');
        expect(inferAdminLogCategory('Police', '[ef_police] Recorded Jail (30 months) for "Bob": robbery')).toBe('sanction');
    });
});


suite('searchAdminLog', () => {
    it('reads every admin log file, oldest first, dating lines from the dividers', async () => {
        const result = await searchAdminLog(basePath, {});
        expect(result.truncated).toBe(false);
        expect(result.log.map((entry) => [entry.ts, entry.author, entry.category])).toEqual([
            [local(2026, 10, 10, 22), 'Alice', 'ban'],
            [local(2026, 10, 10, 23, 59), 'Alice', 'server'],
            [local(2026, 10, 11, 0, 10), 'MONITOR', 'system'],
            [local(2026, 10, 12, 14), 'Carol', 'login'],
            [local(2026, 10, 12, 14, 1), 'Carol', 'command'],
            [local(2026, 10, 12, 14, 2), 'Carol', 'kick'],
            [local(2026, 10, 12, 14, 2), 'Alice', 'revoke'],
        ]);
    });

    it('keeps lines without a time on the entry before them', async () => {
        const result = await searchAdminLog(basePath, { text: 'second line' });
        expect(result.log.map((entry) => entry.msg)).toEqual(['Sending announcement: Restart soon\nsecond line of the announcement']);
    });

    it('filters by admin, categories and time', async () => {
        const result = await searchAdminLog(basePath, {
            admin: 'ali',
            categories: ['ban', 'revoke'],
            from: local(2026, 10, 11),
        });
        expect(result.log.map((entry) => entry.msg)).toEqual(['Revoked ban id B1AB-2CD3 from Bob']);
    });

    it('pages from the newest entries', async () => {
        const first = await searchAdminLog(basePath, {}, 2);
        expect(first.log.map((entry) => entry.author)).toEqual(['Carol', 'Alice']);
        expect(first.truncated).toBe(true);
        const second = await searchAdminLog(basePath, { to: first.cursor! }, 2);
        expect(second.log.map((entry) => entry.ts)).toEqual([local(2026, 10, 12, 14), local(2026, 10, 12, 14, 1)]);
    });
});
