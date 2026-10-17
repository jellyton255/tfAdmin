import TxAnchor from "@/components/TxAnchor";
import { msToShortDuration } from "@/lib/dateTime";

const urlRegex = /(https?:\/\/[^\s<>"]+[^\s<>".,;:!?)\]'])/g;

/**
 * Staff note text with its links made clickable.
 */
export default function StaffNoteText({ text }: { text: string }) {
    const parts = text.split(urlRegex);
    return (
        <p className="text-sm whitespace-pre-wrap break-words">
            {parts.map((part, index) => index % 2 === 1
                ? <TxAnchor key={index} href={part} className="break-all">{part}</TxAnchor>
                : part
            )}
        </p>
    );
}

export function formatNoteAge(secondsAgo: number) {
    if (secondsAgo < 60) return 'just now';
    return `${msToShortDuration(secondsAgo * 1000, { largest: 1 })} ago`;
}

export const STAFF_NOTE_LABEL = 'Staff Notes (Not Shown to the Player)';
