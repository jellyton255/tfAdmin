import type { DatabasePlayerType } from '@modules/Database/databaseTypes';

/**
 * Player tags are short staff labels (VIP, Content Creator, Under Review). They are stored as typed,
 * compared without case, and suggested from the tags already in use plus a few defaults.
 */
export const TAG_MAX_LENGTH = 32;
export const TAG_MAX_COUNT = 12;
export const DEFAULT_TAG_SUGGESTIONS = ['Content Creator', 'Donor', 'Under Review', 'VIP'];


/**
 * Trims and collapses spaces, drops empty tags and case-insensitive duplicates (first spelling wins).
 * Throws when a tag is too long or there are too many.
 */
export function normalizeTags(tags: string[]): string[] {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const raw of tags) {
        const tag = raw.replace(/\s+/g, ' ').trim();
        if (!tag) continue;
        if (tag.length > TAG_MAX_LENGTH) throw new Error(`Tags can be at most ${TAG_MAX_LENGTH} characters.`);
        const key = tag.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        result.push(tag);
    }
    if (result.length > TAG_MAX_COUNT) throw new Error(`A player can have at most ${TAG_MAX_COUNT} tags.`);
    return result;
}


/**
 * Whether the player has the tag, ignoring case.
 */
export function hasTag(player: Pick<DatabasePlayerType, 'tags'>, tag: string) {
    const key = tag.trim().toLowerCase();
    return !!player.tags?.some((x) => x.toLowerCase() === key);
}


/**
 * Tags in use, most used first, followed by the defaults nobody uses yet.
 */
export function tagSuggestions(players: Pick<DatabasePlayerType, 'tags'>[]) {
    const counts = new Map<string, { tag: string; count: number }>();
    for (const player of players) {
        for (const tag of player.tags ?? []) {
            const key = tag.toLowerCase();
            const entry = counts.get(key);
            if (entry) entry.count++;
            else counts.set(key, { tag, count: 1 });
        }
    }
    const used = [...counts.values()]
        .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
        .map((x) => x.tag);
    const defaults = DEFAULT_TAG_SUGGESTIONS.filter((tag) => !counts.has(tag.toLowerCase()));
    return [...used, ...defaults];
}
