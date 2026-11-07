import type { GenericApiErrorResp } from './genericApiTypes';

/**
 * Everfall: one request the panel sends to ef_administration through the monitor resource
 * (POST /everfall/request). ef_administration owns each operation and checks the admin's Everfall
 * staff rank, read from the Discord account linked to their tfAdmin login.
 */
export type EverfallRequest = {
    operation: string;
    payload?: Record<string, unknown>;
};

export type EverfallResp<Data = Record<string, unknown>> = {
    ok: true;
    data: Data;
} | {
    ok: false;
    error: string;
} | GenericApiErrorResp;

/** Answer of the `staff.permissions` operation. */
export type EverfallStaffPermissions = {
    rank: string | null;
    permissions: string[];
};

/** The character record sections `character.section` reads (ef_administration CharacterData). */
export type EverfallCharacterSectionName = 'finances' | 'groups' | 'vehicles' | 'properties' | 'phone' | 'mdt' | 'progression';

/** One source of a section, such as Bank Accounts under finances. Rows are that source's own columns. */
export type EverfallCharacterSectionSource = {
    id: string;
    label: string;
    resource: string;
    available: boolean;
    count: number;
    rows: Record<string, unknown>[];
    error?: string;
};

/** Answer of `character.section`: one page of every source in the section. */
export type EverfallCharacterSection = {
    section: EverfallCharacterSectionName;
    page: number;
    pageSize: number;
    adapters: EverfallCharacterSectionSource[];
};

/** Answer of `character.wallet`: the cards in every wallet an online character carries. */
export type EverfallCharacterWallet = {
    cards: {
        slot: number;
        item: string;
        kind: string;
        label: string;
        status: string;
        issuedAt?: number;
        expiresAt?: number;
    }[];
};

/** Answer of `character.audit`: the latest staff changes made to the character. */
export type EverfallCharacterAudit = {
    rows: {
        id: number;
        action: string;
        actorName: string | null;
        reason: string | null;
        outcome: string;
        createdAt: number | string;
    }[];
};

/** Answer of `character.action`. */
export type EverfallCharacterActionResult = {
    message: string;
};

/** Answer of `player.screenshot`: the hosted image of the player's screen. */
export type EverfallPlayerScreenshot = {
    url: string;
};
