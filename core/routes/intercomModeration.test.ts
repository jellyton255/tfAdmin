import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handleGameModeration } from './intercomModeration';

const LICENSE = 'a'.repeat(40);
const HWID = `2:${'b'.repeat(64)}`;

let events: { type: string; data: any }[];
let adminLog: string[];
let registerBan: ReturnType<typeof vi.fn>;
let registerWarn: ReturnType<typeof vi.fn>;

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
    vi.stubGlobal('txCore', {
        adminStore: { getAdminByName: (name: string) => (name === 'Julian' ? { name } : null) },
        database: { actions: { registerBan, registerWarn } },
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

    it('kicks without storing an action', () => {
        const result = handleGameModeration({
            action: 'kick', resource: 'ef_prime', author: 'System', reason: 'AFK', target,
        });
        expect(result).toEqual({ success: true });
        expect(events[0]).toMatchObject({ type: 'playerKicked', data: { target: 7, reason: 'AFK' } });
    });

    it('rejects a malformed request', () => {
        expect(handleGameModeration({ action: 'ban', target }).success).toBe(false);
        expect(handleGameModeration({ action: 'nuke' }).success).toBe(false);
    });
});
