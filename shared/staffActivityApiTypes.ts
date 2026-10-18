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

export type StaffActivityData = {
    //epoch ms of each week's start (Monday 00:00 UTC), oldest first
    weekStarts: number[];
    staff: StaffActivityMember[];
};

export type StaffActivityResp = StaffActivityData | GenericApiErrorResp;
