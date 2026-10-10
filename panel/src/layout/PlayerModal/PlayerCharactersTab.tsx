import useSWR from "swr";
import { cn } from "@/lib/utils";
import { useAuthedFetcher } from "@/hooks/fetch";
import type { PlayerModalRefType } from "@/hooks/playerModal";
import InlineCode from "@/components/InlineCode";
import GenericSpinner from "@/components/GenericSpinner";
import { ModalTabInner, ModalTabMessage } from "@/components/modal-tabs";
import type { PlayerCharacter, PlayerCharactersResp } from "@shared/playerApiTypes";


const moneyFormatter = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
});
const dateTimeFormatter = new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
    hour12: true,
});

function formatMoney(value: number | null) {
    return value === null ? '—' : moneyFormatter.format(value);
}

function roleLine(label: string | null, grade: string | null) {
    if (!label) return null;
    return grade ? `${label} · ${grade}` : label;
}

function CharacterItem({ character }: { character: PlayerCharacter }) {
    const job = roleLine(character.jobLabel, character.jobGrade);
    const hasGang = character.gangName && character.gangName !== 'none';
    const gang = hasGang ? roleLine(character.gangLabel ?? character.gangName, character.gangGrade) : null;
    const tsLastSeen = character.tsLastLoggedOut ?? character.tsLastUpdated;

    return (
        <div className={cn(
            'px-2 py-1 border-l-4 rounded-r-sm bg-muted/30',
            character.online ? 'border-success' : 'border-muted'
        )}>
            <div className="flex w-full items-baseline justify-between gap-2">
                <strong className="text-sm truncate">{character.fullName}</strong>
                <small className="shrink-0 text-right text-2xs space-x-1">
                    {character.slot !== null && <span className="opacity-75">Slot {character.slot}</span>}
                    <InlineCode className="tracking-widest">{character.citizenId}</InlineCode>
                </small>
            </div>
            {job && <span className="block text-sm">{job}</span>}
            {gang && <span className="block text-sm text-muted-foreground">{gang}</span>}
            <small className="block text-xs opacity-75 space-x-3">
                <span>Cash {formatMoney(character.cash)}</span>
                <span>Bank {formatMoney(character.bank)}</span>
                {character.online ? (
                    <span className="text-success-inline">Online Now</span>
                ) : tsLastSeen !== null && (
                    <span>Last Seen {dateTimeFormatter.format(tsLastSeen * 1000)}</span>
                )}
            </small>
        </div>
    );
}


type PlayerCharactersTabProps = {
    playerRef: PlayerModalRefType;
}

export default function PlayerCharactersTab({ playerRef }: PlayerCharactersTabProps) {
    const authedFetcher = useAuthedFetcher();
    const query = new URLSearchParams(
        'license' in playerRef
            ? { license: playerRef.license }
            : { mutex: playerRef.mutex, netid: String(playerRef.netid) }
    ).toString();
    const swr = useSWR(`/player/characters?${query}`, (url: string) => authedFetcher<PlayerCharactersResp>(url), {
        revalidateOnFocus: false,
    });

    if (swr.error) {
        return <ModalTabMessage>
            <span className="text-destructive-inline">Error: {swr.error instanceof Error ? swr.error.message : String(swr.error)}</span>
        </ModalTabMessage>;
    }
    if (!swr.data) {
        return <ModalTabMessage>
            <GenericSpinner msg="Loading Characters..." />
        </ModalTabMessage>;
    }
    if ('error' in swr.data) {
        return <ModalTabMessage>
            <span className="text-destructive-inline">Error: {swr.data.error}</span>
        </ModalTabMessage>;
    }
    if (swr.data.status === 'unavailable') {
        return <ModalTabMessage className="flex-col gap-1 text-center">
            <span>Characters Unavailable</span>
            <small className="text-sm">{swr.data.reason}</small>
        </ModalTabMessage>;
    }
    if (!swr.data.characters.length) {
        return <ModalTabMessage>
            No characters found.
        </ModalTabMessage>;
    }

    return (
        <ModalTabInner className="flex flex-col gap-1">
            {swr.data.characters.map((character) => (
                <CharacterItem key={character.citizenId} character={character} />
            ))}
        </ModalTabInner>
    );
}
