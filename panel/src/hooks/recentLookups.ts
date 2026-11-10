import { useAtomValue, useSetAtom } from "jotai";
import { atomWithStorage } from "jotai/utils";


/**
 * Everfall: players, actions and pages this browser opened lately, newest first, for the Ctrl+K
 * palette's Recent section. Per browser, like the console history.
 */
export type RecentLookup =
    | { kind: 'player'; license: string; name: string; ts: number }
    | { kind: 'action'; id: string; label: string; ts: number }
    | { kind: 'page'; path: string; title: string; ts: number };

const RECENT_LIMIT = 8;
const recentLookupsAtom = atomWithStorage<RecentLookup[]>('tfa:recentLookups', []);

function lookupKey(lookup: RecentLookup) {
    if (lookup.kind === 'player') return `player:${lookup.license}`;
    if (lookup.kind === 'action') return `action:${lookup.id}`;
    return `page:${lookup.path}`;
}

export const useRecentLookups = () => useAtomValue(recentLookupsAtom);

export const useAddRecentLookup = () => {
    const setRecent = useSetAtom(recentLookupsAtom);
    return (lookup: RecentLookup) => setRecent((current) => {
        const key = lookupKey(lookup);
        return [lookup, ...current.filter((entry) => lookupKey(entry) !== key)].slice(0, RECENT_LIMIT);
    });
};

export const useClearRecentLookups = () => {
    const setRecent = useSetAtom(recentLookupsAtom);
    return () => setRecent([]);
};
