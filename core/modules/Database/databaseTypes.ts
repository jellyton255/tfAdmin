export type DatabasePlayerType = {
    license: string;
    ids: string[];
    hwids: string[];
    displayName: string;
    pureName: string;
    playTime: number;
    tsLastConnection: number;
    tsJoined: number;
    tsWhitelisted?: number;
    noteHistory?: DatabasePlayerNoteType[]; //oldest first, absent when empty
    watch?: DatabasePlayerWatchType; //on the staff watchlist, absent when not watched
    tags?: string[]; //staff labels such as VIP, absent when empty
};

/**
 * Why and by whom a player was put on the watchlist. Staff are alerted when a watched player joins.
 */
export type DatabasePlayerWatchType = {
    reason: string;
    author: string;
    ts: number;
};

/**
 * A staff note on a player or an action. Only action notes are edited or soft deleted.
 */
export type DatabaseNoteType = {
    id: string;
    text: string;
    author: string;
    ts: number;
    editedTs?: number;
    deleted?: {
        author: string;
        ts: number;
    };
};
export type DatabasePlayerNoteType = DatabaseNoteType;

/**
 * The single overwritable note of database v5 and older, migrated into `noteHistory` on v6.
 */
export type DatabaseLegacyPlayerNoteType = {
    text: string;
    lastAdmin: string | null;
    tsLastEdit: number | null;
};

export type DatabaseActionBaseType = {
    id: string;
    ids: string[];
    playerName: string | false;
    reason: string;
    author: string;
    timestamp: number;
    //FIXME: the revocation object itself should be optional instead of nullable properties
    //BUT DO REMEMBER THE `'XXX' IN YYY` ISSUE!
    revocation: {
        timestamp: number | null;
        author: string | null;
        reason?: string;
    };
    notes?: DatabaseNoteType[]; //staff only, oldest first, absent when empty
    presetId?: string; //everfall: the punishment preset (ban template) it was issued from
};
//everfall: a change of a ban's length; the new length counts from when the ban was issued
export type DatabaseBanLengthChangeType = {
    ts: number;
    author: string;
    from: number | false; //previous expiration, false = permanent
    to: number | false;
    reason: string;
};
//everfall: where a ban's appeal stands; `author` and `ts` are who set this status and when
export const BAN_APPEAL_STATUSES = ['open', 'denied', 'accepted'] as const;
export type DatabaseBanAppealType = {
    status: typeof BAN_APPEAL_STATUSES[number];
    ticket?: string; //ticket link or number
    author: string;
    ts: number;
};
export type DatabaseActionBanType = {
    type: 'ban';
    hwids?: string[];
    expiration: number | false;
    externalRef?: string; //idempotency key of bans imported via the API (players.ban_import)
    lengthChanges?: DatabaseBanLengthChangeType[]; //everfall: oldest first, absent when never changed
    appeal?: DatabaseBanAppealType; //everfall: absent when never appealed
} & DatabaseActionBaseType;
export type DatabaseActionWarnType = {
    type: 'warn';
    expiration: false; //FIXME: remove - BUT DO REMEMBER THE `'XXX' IN YYY` ISSUE!
    acked: boolean; //if the player has acknowledged the warning
} & DatabaseActionBaseType;
export type DatabaseActionKickType = {
    type: 'kick';
    expiration: false; //kicks never block joins and are never active
} & DatabaseActionBaseType;
export type DatabaseActionType = DatabaseActionBanType | DatabaseActionWarnType | DatabaseActionKickType;

export type DatabaseWhitelistApprovalsType = {
    identifier: string;
    playerName: string; //always filled, even with `unknown` or license `xxxxxx...xxxxxx` 
    playerAvatar: string | null,
    tsApproved: number,
    approvedBy: string
};

export type DatabaseWhitelistRequestsType = {
    id: string, //R####
    license: string,
    playerDisplayName: string,
    playerPureName: string,
    discordTag?: string,
    discordAvatar?: string, //first try to get from GuildMember, then client.users.fetch()
    tsLastAttempt: number,
};

export type DatabaseDataType = {
    version: number,
    players: DatabasePlayerType[],
    actions: DatabaseActionType[],
    whitelistApprovals: DatabaseWhitelistApprovalsType[],
    whitelistRequests: DatabaseWhitelistRequestsType[],
    tfMigrations?: string[], //one-time data passes that already ran, without a version bump
};
