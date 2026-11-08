import { describe, expect, it } from 'vitest';
import { fixStaffAuthors } from './staffAuthors';
import type { DatabaseActionType, DatabasePlayerType } from './databaseTypes';

const LICENSE = 'a'.repeat(40);
const ADMINS = ['belsie', 'itsswifty', 'Fragz', 'TEDtheFED'];
const adminName = (name: string) => ADMINS.find((admin) => admin.toLowerCase() === name.toLowerCase()) ?? null;

const action = (id: string, author: string, reason: string, extra: object = {}) => ({
    id, type: 'ban', author, reason, timestamp: 100,
    ids: [`license:${LICENSE}`], playerName: 'Bob', expiration: false,
    revocation: { timestamp: null, author: null },
    ...extra,
}) as DatabaseActionType;

const player = (notes: { id: string; text: string; author: string; ts: number }[]) => ({
    license: LICENSE, ids: [`license:${LICENSE}`], hwids: [], displayName: 'Bob', pureName: 'bob',
    playTime: 0, tsLastConnection: 0, tsJoined: 0, noteHistory: notes,
}) as DatabasePlayerType;

describe('fixStaffAuthors', () => {
    it('gives tagged, signed and actor records to the staff member', () => {
        const actions = [
            action('B8HW-9DRK', 'api:Administration', '[Belsie] Modding'),
            //untagged reason: the attribution note made with the sanction names the staff member
            action('B1GZ-3GA4', 'api:Administration', 'NITRP', {
                notes: [{ id: 'N1', text: '[ItsSwifty]', author: 'api:Administration', ts: 100 }],
            }),
            action('B2DV-DKBH', 'api:Tickets', 'Quip - Did not reply - Fragz'),
            action('B193-CM48', 'TEDtheFED (via api:Tickets)', 'No reply'),
            action('BXXX-0001', 'Jellyton69', '[Belsie] already a person'),
        ];
        const players = [player([{ id: 'P1', text: '[ItsSwifty] spoke to the player', author: 'api:Administration', ts: 5 }])];

        const { changes, unresolved } = fixStaffAuthors({ players, actions }, adminName);

        expect(actions.map((a) => a.author)).toEqual(['belsie', 'itsswifty', 'Fragz', 'TEDtheFED', 'Jellyton69']);
        expect(actions[1].notes![0].author).toBe('itsswifty');
        expect(players[0].noteHistory![0].author).toBe('itsswifty');
        expect(changes).toHaveLength(6);
        expect(unresolved).toEqual([]);
    });

    it('leaves records without evidence, or naming an admin this server lacks, and reports them', () => {
        const actions = [
            action('WGWN-N7DU', 'api:Administration', '[somefriggnidiot] NVL', {
                notes: [{ id: 'U2KQ', text: 'Verification note.', author: 'api:Administration', ts: 200, deleted: { author: 'api:Administration', ts: 200 } }],
            }),
        ];

        const { changes, unresolved } = fixStaffAuthors({ players: [], actions }, adminName);

        expect(changes).toEqual([]);
        expect(actions[0].author).toBe('api:Administration');
        expect(unresolved).toEqual([
            'action WGWN-N7DU (api:Administration)',
            'action WGWN-N7DU note U2KQ (api:Administration)',
            'action WGWN-N7DU note U2KQ deletion (api:Administration)',
        ]);
    });
});
