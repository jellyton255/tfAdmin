import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handleGameModeration } from './intercomModeration';

const LICENSE = 'a'.repeat(40);
const HWID = `2:${'b'.repeat(64)}`;

let events: { type: string; data: any }[];
let adminLog: string[];
let registerBan: ReturnType<typeof vi.fn>;
let registerWarn: ReturnType<typeof vi.fn>;
let registerKick: ReturnType<typeof vi.fn>;
let registerSanction: ReturnType<typeof vi.fn>;
let addNote: ReturnType<typeof vi.fn>;
let published: { type: string; data: any }[];

const target = {
    netid: 7,
    name: 'Cheater',
    ids: [`license:${LICENSE}`, 'ip:127.0.0.1', 'fivem:42'],
    hwids: [HWID, 'not-a-hwid'],
};

beforeEach(() => {
    events = [];
    adminLog = [];
    registerBan = vi.fn(() => 'BXXXX-XXXX');
    registerWarn = vi.fn(() => 'WXXXX-XXXX');
    registerKick = vi.fn(() => 'KXXXX-XXXX');
    registerSanction = vi.fn(() => 'SXXXX-XXXX');
    addNote = vi.fn((actionId: string, text: string, author: string) => ({ id: 'N1', text, author, ts: 100 }));
    published = [];
    vi.stubGlobal('txCore', {
        adminStore: { getAdminByName: (name: string) => (name === 'Julian' ? { name } : null) },
        database: {
            actions: {
                registerBan,
                registerWarn,
                registerKick,
                registerSanction,
                addNote,
                findOne: (id: string) => ({ id, type: id.startsWith('B') ? 'ban' : 'kick', playerName: 'Cheater', ids: [] }),
            },
        },
        apiServer: { publishEvent: (type: string, data: any) => published.push({ type, data }) },
        fxRunner: { sendEvent: (type: string, data: any) => { events.push({ type, data }); return true; } },
        logger: { admin: { write: (author: string, msg: string) => adminLog.push(`${author}: ${msg}`) } },
        translator: {
            t: (key: string) => key,
            tDuration: () => '2 days',
        },
    });
});

describe('handleGameModeration', () => {
    it('bans with only valid identifiers and hwids and fires playerBanned', () => {
        const result = handleGameModeration({
            action: 'ban', resource: 'ef_mining', author: 'Anti-Cheat', reason: 'Exploit Attempt: TEST', duration: 'permanent', target,
        });
        expect(result).toEqual({ success: true, actionId: 'BXXXX-XXXX' });
        expect(registerBan).toHaveBeenCalledWith(
            [`license:${LICENSE}`, 'fivem:42'], 'Anti-Cheat', 'Exploit Attempt: TEST', false, 'Cheater', [HWID],
        );
        expect(events[0]).toMatchObject({
            type: 'playerBanned',
            data: { author: 'Anti-Cheat', targetNetId: 7, targetIds: [`license:${LICENSE}`, 'fivem:42'], actionId: 'BXXXX-XXXX' },
        });
        expect(adminLog[0]).toBe('Anti-Cheat: [ef_mining] Banned player "Cheater": Exploit Attempt: TEST');
    });

    it('records a game sanction with its kind and length, without an in-game event', () => {
        const result = handleGameModeration({
            action: 'sanction', resource: 'ef_police', author: 'Police', kind: 'Jail', length: '30 months', reason: 'Armed robbery', target,
        });
        expect(result).toEqual({ success: true, actionId: 'SXXXX-XXXX' });
        expect(registerSanction).toHaveBeenCalledWith(
            [`license:${LICENSE}`, 'fivem:42'], 'Police', 'Jail', 'Armed robbery', 'Cheater', '30 months',
        );
        expect(events).toEqual([]);
        expect(published[0]).toMatchObject({ type: 'player.sanctioned', data: { actionId: 'SXXXX-XXXX', kind: 'Jail', resource: 'ef_police' } });
        expect(adminLog[0]).toBe('Police: [ef_police] Recorded Jail (30 months) for "Cheater": Armed robbery');
    });

    it('refuses an author that is a tfAdmin admin name', () => {
        const result = handleGameModeration({
            action: 'ban', resource: 'x', author: 'Julian', reason: 'r', duration: 'permanent', target,
        });
        expect(result.success).toBe(false);
        expect(registerBan).not.toHaveBeenCalled();
    });

    it('refuses an invalid duration without writing', () => {
        const result = handleGameModeration({
            action: 'ban', resource: 'x', author: 'Anti-Cheat', reason: 'r', duration: 'forever-ish', target,
        });
        expect(result.success).toBe(false);
        expect(registerBan).not.toHaveBeenCalled();
    });

    it('refuses a target with no valid identifiers', () => {
        const result = handleGameModeration({
            action: 'warn', resource: 'x', author: 'System', reason: 'r', target: { ...target, ids: ['ip:1.2.3.4'] },
        });
        expect(result.success).toBe(false);
        expect(registerWarn).not.toHaveBeenCalled();
    });

    it('warns and fires playerWarned for the connected player', () => {
        const result = handleGameModeration({
            action: 'warn', resource: 'ef_prime', author: 'System', reason: 'Slow down', target,
        });
        expect(result).toEqual({ success: true, actionId: 'WXXXX-XXXX' });
        expect(events[0]).toMatchObject({ type: 'playerWarned', data: { targetNetId: 7, author: 'System' } });
    });

    it('records the kick with its staff note and fires playerKicked without the note', () => {
        const result = handleGameModeration({
            action: 'kick', resource: 'ef_prime', author: 'System', reason: 'AFK', note: 'third time today', target,
        });
        expect(result).toEqual({ success: true, actionId: 'KXXXX-XXXX' });
        expect(registerKick).toHaveBeenCalledWith([`license:${LICENSE}`, 'fivem:42'], 'System', 'AFK', 'Cheater');
        expect(addNote).toHaveBeenCalledWith('KXXXX-XXXX', 'third time today', 'System');
        expect(events[0]).toMatchObject({ type: 'playerKicked', data: { target: 7, reason: 'AFK', actionId: 'KXXXX-XXXX' } });
        expect(JSON.stringify(events[0].data)).not.toContain('third time today');
        expect(published[0]).toMatchObject({ type: 'action.noteAdded', data: { actionId: 'KXXXX-XXXX' } });
    });

    it('still kicks a player with no valid identifiers, without a record', () => {
        const result = handleGameModeration({
            action: 'kick', resource: 'x', author: 'System', reason: 'AFK', target: { ...target, ids: ['ip:1.2.3.4'] },
        });
        expect(result).toEqual({ success: true, actionId: undefined });
        expect(registerKick).not.toHaveBeenCalled();
        expect(events[0]).toMatchObject({ type: 'playerKicked', data: { target: 7, actionId: null } });
    });

    it('adds a note to an existing action and refuses an admin name as author', () => {
        expect(handleGameModeration({
            action: 'note', resource: 'ef_ac', author: 'Anti-Cheat', actionId: 'babc-1234', text: 'Clip: https://x',
        })).toEqual({ success: true, actionId: 'BABC-1234' });
        expect(addNote).toHaveBeenCalledWith('BABC-1234', 'Clip: https://x', 'Anti-Cheat');
        expect(handleGameModeration({
            action: 'note', resource: 'x', author: 'Julian', actionId: 'BABC-1234', text: 't',
        }).success).toBe(false);
    });

    it('rejects a malformed request', () => {
        expect(handleGameModeration({ action: 'ban', target }).success).toBe(false);
        expect(handleGameModeration({ action: 'nuke' }).success).toBe(false);
    });
});
