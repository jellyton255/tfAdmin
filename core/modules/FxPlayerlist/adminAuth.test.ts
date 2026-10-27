import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AdminStore from '@modules/AdminStore';
import FxPlayerlist from './index';
import serverCommands from '@routes/advanced/groups/serverCmds';

let playerlist: FxPlayerlist;
let adminStore: AdminStore;
let sendEvent: ReturnType<typeof vi.fn>;
let admins = [{ name: 'staff', providers: { citizenfx: { identifier: 'fivem:42' } } }];

beforeEach(() => {
    playerlist = new FxPlayerlist();
    admins = [{ name: 'staff', providers: { citizenfx: { identifier: 'fivem:42' } } }];
    adminStore = Object.assign(Object.create(AdminStore.prototype), {
        admins,
    });
    sendEvent = vi.fn();
    vi.stubGlobal('txCore', {
        adminStore,
        fxPlayerlist: playerlist,
        fxRunner: { sendEvent },
        logger: { server: { write: vi.fn() } },
        webServer: { webSocket: { buffer: vi.fn(), reCheckAdminAuths: vi.fn().mockResolvedValue(undefined) } },
    });
});

afterEach(() => vi.unstubAllGlobals());

async function join(netid: number, identifier: string) {
    await playerlist.handleServerEvents({
        event: 'playerJoining', id: netid,
        player: { name: 'Player', ids: [identifier], hwids: [] },
    }, 'test');
}

describe('in-game admin authentication without the retired menu', () => {
    it('authenticates staff from server identifiers on join', async () => {
        await join(7, 'fivem:42');
        expect(sendEvent).toHaveBeenCalledWith('adminAuth', { netid: 7, isAdmin: true, username: 'staff' });
    });

    it('does not authenticate a regular player', async () => {
        await join(8, 'fivem:99');
        expect(sendEvent).toHaveBeenCalledWith('adminAuth', { netid: 8, isAdmin: false });
    });

    it('revokes removed staff and authenticates newly linked staff after admin updates', async () => {
        await join(7, 'fivem:42');
        await join(8, 'fivem:99');
        admins.splice(0, admins.length, { name: 'replacement', providers: { citizenfx: { identifier: 'fivem:99' } } });
        sendEvent.mockClear();
        await adminStore.refreshOnlineAdmins();
        expect(sendEvent).toHaveBeenCalledWith('adminsUpdated', [8]);
        expect(sendEvent).toHaveBeenCalledWith('adminAuth', { netid: -1, isAdmin: false });
        expect(sendEvent).toHaveBeenCalledWith('adminAuth', { netid: 7, isAdmin: false });
        expect(sendEvent).toHaveBeenCalledWith('adminAuth', { netid: 8, isAdmin: true, username: 'replacement' });
        expect(sendEvent.mock.calls.some(([name, data]) => name === 'adminAuth' && data.username === 'staff')).toBe(false);
    });

    it('reauthenticates recent players through the existing advanced command', async () => {
        await join(7, 'fivem:42');
        sendEvent.mockClear();
        await serverCommands.forceReauthRecentPlayers(Object.create(null), '1');
        expect(sendEvent).toHaveBeenCalledWith('adminAuth', { netid: 7, isAdmin: true, username: 'staff' });
    });

    it('does not grant authentication for a disconnected player record', async () => {
        await join(7, 'fivem:42');
        const player = playerlist.getPlayerById(7);
        if (!player) throw new Error('Join did not create the player');
        player.disconnect();
        sendEvent.mockClear();
        adminStore.refreshPlayerAuth(7);
        expect(sendEvent).not.toHaveBeenCalled();
    });
});
