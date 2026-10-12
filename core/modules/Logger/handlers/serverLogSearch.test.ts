import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, expect, it, suite } from 'vitest';
import type { ServerLogEventType } from '@shared/serverLogApiTypes';
import {
    LogFileLineParser,
    createEventMatcher,
    inferEventType,
    listServerLogFiles,
    searchServerLog,
} from './serverLogSearch';

//Fake identifiers only
const LICENSE = `aaaa${'0'.repeat(32)}bbbb`;
const SHORT_LICENSE = 'license:aaaa…bbbb';
const local = (y: number, mo: number, d: number, h = 0, mi = 0, s = 0) => new Date(y, mo - 1, d, h, mi, s).getTime();

const rotatedLines = [
    '='.repeat(64),
    '======== Log Rotated - 10/10/2026, 12:00:00 AM'.padEnd(64, ' '),
    '='.repeat(64),
    `[10:00:00 PM] [AbCdE#1] Alice: joined with identifiers [${SHORT_LICENSE}, discord:1234…5678]`,
    '[11:30:00 PM] [AbCdE#1] Alice: enabled noclip',
    '[11:59:59 PM] [AbCdE#2] Bob: said "hello world"',
];
const activeLines = [
    '='.repeat(64),
    '======== txAdmin v8.0.0 atop fxserver 12345 Starting - 10/11/2026, 2:00:00 AM'.padEnd(64, ' '),
    '='.repeat(64),
    '[14:00:00] txAdmin: Logger started',
    `[14:01:00] [XyZ#1] Alice: joined with identifiers [${SHORT_LICENSE}]`,
    '[14:02:00] [XyZ#1] Alice: said "Hello again"',
    '[14:03:00] [XyZ#2] Bob: executed: /me waves',
];

let basePath: string;
beforeAll(() => {
    basePath = fs.mkdtempSync(path.join(os.tmpdir(), 'serverlog-search-'));
    const rotatedPath = path.join(basePath, 'server_2026-10-10_00-00-00_1.log');
    fs.writeFileSync(rotatedPath, rotatedLines.join('\n') + '\n');
    fs.utimesSync(rotatedPath, new Date(local(2026, 10, 10, 23, 59, 59)), new Date(local(2026, 10, 10, 23, 59, 59)));
    const activePath = path.join(basePath, 'server.log');
    fs.writeFileSync(activePath, activeLines.join('\n') + '\n');
    fs.utimesSync(activePath, new Date(local(2026, 10, 11, 14, 3)), new Date(local(2026, 10, 11, 14, 3)));
    //not a server log
    fs.writeFileSync(path.join(basePath, 'admin.log'), activeLines.join('\n'));
});
afterAll(() => {
    fs.rmSync(basePath, { recursive: true, force: true });
});


suite('LogFileLineParser', () => {
    it('parses 12-hour and 24-hour times, and re-anchors on dividers', () => {
        const parser = new LogFileLineParser(new Date(local(2020, 1, 1)));
        expect(parser.parse(activeLines[1])).toBeNull();
        expect(parser.parse('[2:05:00 PM] txAdmin: Logger started')).toEqual({
            ts: local(2026, 10, 11, 14, 5),
            type: 'LoggerStarted',
            src: { id: false, name: 'txAdmin' },
            msg: 'Logger started',
        });
        expect(parser.parse('[14:06:07] [XyZ#3] Some: Name: said "a: b"')).toEqual({
            ts: local(2026, 10, 11, 14, 6, 7),
            type: 'MenuEvent',
            src: { id: 'XyZ#3', name: 'Some' },
            msg: 'Name: said "a: b"',
        });
    });

    it('moves to the next day when the time wraps, but not on a clock change', () => {
        const parser = new LogFileLineParser(new Date(local(2026, 10, 10)));
        expect(parser.parse('[11:59:59 PM] UNKNOWN: x')?.ts).toBe(local(2026, 10, 10, 23, 59, 59));
        expect(parser.parse('[12:00:05 AM] UNKNOWN: x')?.ts).toBe(local(2026, 10, 11, 0, 0, 5));
        expect(parser.parse('[1:30:00 AM] UNKNOWN: x')?.ts).toBe(local(2026, 10, 11, 1, 30));
        expect(parser.parse('[1:10:00 AM] UNKNOWN: x')?.ts).toBe(local(2026, 10, 11, 1, 10));
    });

    it('ignores blank and unparseable lines', () => {
        const parser = new LogFileLineParser(new Date());
        expect(parser.parse('')).toBeNull();
        expect(parser.parse('='.repeat(64))).toBeNull();
        expect(parser.parse('garbage')).toBeNull();
    });
});


suite('inferEventType', () => {
    it('infers the type written by processEvent', () => {
        expect(inferEventType(true, 'joined with identifiers [fivem:1]')).toBe('playerJoining');
        expect(inferEventType(true, 'disconnected (Exiting)')).toBe('playerDropped');
        expect(inferEventType(true, '(Someone): said "hi"')).toBe('ChatMessage');
        expect(inferEventType(true, 'died from fall by Bob')).toBe('DeathNotice');
        expect(inferEventType(true, 'caused an explosion (GRENADE)')).toBe('explosionEvent');
        expect(inferEventType(true, 'executed: /me')).toBe('CommandExecuted');
        expect(inferEventType(false, 'player join denied due to ban')).toBe('playerJoinDenied');
        expect(inferEventType(false, 'Debug Message: x')).toBe('DebugMessage');
        expect(inferEventType(true, 'enabled noclip')).toBe('MenuEvent');
        expect(inferEventType(false, 'something else')).toBe('Unknown');
    });
});


suite('createEventMatcher', () => {
    const event = (ts: number, id: string | false, name: string, type: string, msg: string): ServerLogEventType => (
        { ts, type, src: { id, name }, msg }
    );

    it('follows the session of a matching identifier and skips others', () => {
        const matches = createEventMatcher({ player: `license:${LICENSE}`, types: ['MenuEvent'] });
        const join = event(1, 'M#1', 'Alice', 'playerJoining', `joined with identifiers [${SHORT_LICENSE}]`);
        expect(matches(join)).toBe(false); //type filtered, but the session is tracked
        expect(matches(event(2, 'M#1', 'Renamed', 'MenuEvent', 'enabled noclip'))).toBe(true);
        expect(matches(event(3, 'M#2', 'Alice', 'MenuEvent', 'enabled noclip'))).toBe(false);
    });

    it('matches names and text case-insensitively', () => {
        const matches = createEventMatcher({ player: 'ALI', text: 'HELLO' });
        expect(matches(event(1, 'M#1', 'Alice', 'ChatMessage', 'said "hello"'))).toBe(true);
        expect(matches(event(1, 'M#1', 'Alice', 'ChatMessage', 'said "bye"'))).toBe(false);
        expect(matches(event(1, 'M#2', 'Bob', 'ChatMessage', 'said "hello"'))).toBe(false);
    });

    it('uses seeded sessions', () => {
        const matches = createEventMatcher({ player: LICENSE }, ['M#5']);
        expect(matches(event(1, 'M#5', 'Alice', 'MenuEvent', 'enabled noclip'))).toBe(true);
    });
});


suite('searchServerLog', () => {
    it('lists only server log files, newest first', async () => {
        const files = await listServerLogFiles(basePath);
        expect(files.map((file) => path.basename(file.filePath))).toEqual([
            'server.log',
            'server_2026-10-10_00-00-00_1.log',
        ]);
    });

    it('searches every file by identifier, oldest first', async () => {
        const result = await searchServerLog({ buffer: [], basePath, query: { player: LICENSE } });
        expect(result.truncated).toBe(false);
        expect(result.cursor).toBeNull();
        expect(result.log.map((event) => [event.ts, event.src.id, event.type])).toEqual([
            [local(2026, 10, 10, 22), 'AbCdE#1', 'playerJoining'],
            [local(2026, 10, 10, 23, 30), 'AbCdE#1', 'MenuEvent'],
            [local(2026, 10, 11, 14, 1), 'XyZ#1', 'playerJoining'],
            [local(2026, 10, 11, 14, 2), 'XyZ#1', 'ChatMessage'],
        ]);
    });

    it('applies the time range, text and types', async () => {
        const result = await searchServerLog({
            buffer: [],
            basePath,
            query: { text: 'hello', types: ['ChatMessage'], from: local(2026, 10, 11) },
        });
        expect(result.log.map((event) => event.msg)).toEqual(['said "Hello again"']);
    });

    it('reads files only for what is older than the buffer', async () => {
        const buffer: ServerLogEventType[] = [
            { ts: local(2026, 10, 11, 14, 2) + 250, type: 'ChatMessage', src: { id: 'XyZ#1', name: 'Alice' }, msg: 'said "Hello again"' },
            { ts: local(2026, 10, 11, 14, 3) + 10, type: 'CommandExecuted', src: { id: 'XyZ#2', name: 'Bob' }, msg: 'executed: /me waves' },
        ];
        const result = await searchServerLog({ buffer, basePath, query: { player: 'alice' } });
        expect(result.log.map((event) => event.ts)).toEqual([
            local(2026, 10, 10, 22),
            local(2026, 10, 10, 23, 30),
            local(2026, 10, 11, 14, 1),
            local(2026, 10, 11, 14, 2) + 250,
        ]);
    });

    it('caps the results and returns a cursor for the next older page', async () => {
        const first = await searchServerLog({ buffer: [], basePath, query: {}, cap: 3 });
        expect(first.truncated).toBe(true);
        expect(first.log.map((event) => event.msg)).toEqual([
            'Logger started',
            `joined with identifiers [${SHORT_LICENSE}]`,
            'said "Hello again"',
            'executed: /me waves',
        ].slice(1));
        expect(first.cursor).toBe(local(2026, 10, 11, 14, 1) - 1);

        const second = await searchServerLog({ buffer: [], basePath, query: { to: first.cursor ?? undefined }, cap: 3 });
        expect(second.log.map((event) => event.msg)).toEqual([
            'enabled noclip',
            'said "hello world"',
            'Logger started',
        ]);
        expect(second.truncated).toBe(true);
    });

    it('stops at the byte budget with a cursor', async () => {
        const result = await searchServerLog({ buffer: [], basePath, query: {}, byteBudget: 1 });
        expect(result.log).toHaveLength(4);
        expect(result.truncated).toBe(true);
        expect(result.cursor).toBe(local(2026, 10, 10, 23, 59, 59));

        //the newer file has no line in range, so it does not use up the budget
        const next = await searchServerLog({ buffer: [], basePath, query: { to: result.cursor ?? undefined }, byteBudget: 1 });
        expect(next.log.map((event) => event.msg)).toEqual([
            `joined with identifiers [${SHORT_LICENSE}, discord:1234…5678]`,
            'enabled noclip',
            'said "hello world"',
        ]);
        expect(next.truncated).toBe(false);
    });

    it('does not split a same-timestamp group across pages', async () => {
        const event = (ts: number, msg: string): ServerLogEventType => (
            { ts, type: 'DebugMessage', src: { id: false, name: 'txAdmin' }, msg }
        );
        const buffer = [event(1000, 'a'), event(2000, 'b'), event(2000, 'c'), event(3000, 'd')];
        const emptyDir = path.join(basePath, 'missing');
        const first = await searchServerLog({ buffer, basePath: emptyDir, query: {}, cap: 2 });
        expect(first.log.map((item) => item.msg)).toEqual(['d']);
        expect(first.cursor).toBe(2000);
        const second = await searchServerLog({ buffer, basePath: emptyDir, query: { to: 2000 }, cap: 2 });
        expect(second.log.map((item) => item.msg)).toEqual(['b', 'c']);
        expect(second.cursor).toBe(1999);
    });
});
