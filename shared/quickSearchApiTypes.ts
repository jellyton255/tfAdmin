import type { GenericApiErrorResp } from "./genericApiTypes";

export type QuickSearchPlayer = {
    license: string;
    displayName: string;
    isOnline: boolean;
    //what matched, besides the name: an identifier or a "Citizen ID ... (character name)"
    matched: string | null;
};

export type QuickSearchAction = {
    id: string;
    type: 'ban' | 'warn' | 'kick' | 'sanction';
    playerName: string | false;
    reason: string;
};

export type QuickSearchResp = {
    players: QuickSearchPlayer[];
    actions: QuickSearchAction[];
    //why a citizen ID lookup could not run, when the query looked like one
    citizenIdNotice: string | null;
} | GenericApiErrorResp;
