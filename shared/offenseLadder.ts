import type { BanTemplatesDataType, LadderStepType } from "./otherTypes";
import type { PlayerHistoryItem } from "./playerApiTypes";

/**
 * everfall: punishment presets (ban templates) with an offense ladder.
 * A preset ban or warn counts as a prior offense until `offenseUntil`, unless it was revoked.
 * Old ones stay in the history; they just stop moving the player up the ladder.
 */

export const ladderSteps = (preset: BanTemplatesDataType): LadderStepType[] => {
    return preset.ladder?.length ? preset.ladder : [preset.duration];
};

export const presetLabel = (preset: BanTemplatesDataType) => preset.name ?? preset.reason;

/**
 * Number of prior offenses of a preset that still count
 */
export const countActiveOffenses = (history: PlayerHistoryItem[], presetId: string, serverTime: number) => {
    return history.filter((item) => item.presetId === presetId
        && !item.revokedAt
        && item.offenseUntil !== undefined
        && item.offenseUntil > serverTime
    ).length;
};

/**
 * The punishment for the next offense: the step after the prior ones, or the last step once past the end
 */
export const nextLadderStep = (preset: BanTemplatesDataType, priorOffenses: number) => {
    const steps = ladderSteps(preset);
    return steps[Math.min(priorOffenses, steps.length - 1)];
};

export const ordinal = (n: number) => {
    const suffix = (n % 100 >= 11 && n % 100 <= 13) ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] ?? 'th');
    return `${n}${suffix}`;
};
