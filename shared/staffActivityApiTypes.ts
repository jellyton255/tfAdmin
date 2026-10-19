import type { GenericApiErrorResp } from "./genericApiTypes";

/**
 * What one staff member did in a week (or in total over the range).
 */
export type StaffActivityCounts = {
    bans: number;
    warns: number;
    kicks: number;
    revokes: number;
    notes: number;
    minutesOnline: number;
    //everfall tickets, matched by the admin's Discord ID
    ticketReplies: number;
    ticketNotes: number; //internal notes on tickets
    staffThreadMessages: number;
    ticketsClosed: number;
    //EF Bot, matched by the admin's Discord ID
    discordMessages: number;
    voiceMinutes: number;
};

export type StaffActivityMember = {
    name: string;
    //same order as `weekStarts`, oldest first
    weeks: StaffActivityCounts[];
    total: StaffActivityCounts;
    //epoch ms, over all history, null when never
    lastActionTs: number | null;
    lastInGameTs: number | null;
};

/**
 * Whether an outside source (tickets, Discord) answered. `off` = not configured.
 */
export type StaffActivitySourceStatus =
    | { state: 'ok' }
    | { state: 'off' }
    | { state: 'error'; message: string };

export type StaffActivityData = {
    //epoch ms of each week's start (Monday 00:00 UTC), oldest first
    weekStarts: number[];
    staff: StaffActivityMember[];
    sources: {
        tickets: StaffActivitySourceStatus;
        discord: StaffActivitySourceStatus;
    };
};

export type StaffActivityResp = StaffActivityData | GenericApiErrorResp;
