import type { GenericApiErrorResp } from "./genericApiTypes";

export type MasterActionsCleanDatabaseReq = {
    players: 'none' | '60d' | '30d' | '15d';
    bans: 'none' | 'revoked' | 'revokedExpired' | 'all';
    warns: 'none' | 'revoked' | '30d' | '15d' | '7d' | 'all';
    hwids: 'none' | 'players' | 'bans' | 'all';
};
export type MasterActionsCleanDatabaseResp = {
    msElapsed: number;
    playersRemoved: number;
    actionsRemoved: number;
    hwidsRemoved: number;
} | GenericApiErrorResp;

export type MasterActionsRevokeWhitelistsReq = {
    filter: 'all' | '30d' | '15d' | '7d';
};
export type MasterActionsRevokeWhitelistsResp = {
    msElapsed: number;
    cntRemoved: number;
} | GenericApiErrorResp;
