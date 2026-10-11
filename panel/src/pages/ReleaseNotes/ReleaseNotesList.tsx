import type { ReleaseNote, ReleaseNoteType } from "@shared/releaseNotesTypes";
import { groupNotesByDay } from "@/lib/releaseNotes";
import { cn } from "@/lib/utils";

const typeLabels: Record<ReleaseNoteType, string> = {
    feat: 'New',
    fix: 'Fixed',
    perf: 'Faster',
};
const typeClasses: Record<ReleaseNoteType, string> = {
    feat: 'bg-success/15 text-success',
    fix: 'bg-info/15 text-info',
    perf: 'bg-warning/15 text-warning',
};
const scopeLabels: Record<string, string> = {
    api: 'API',
    client: 'API Client',
    menu: 'In-Game Menu',
    build: 'Builds',
};

function getScopeLabel(scope: string) {
    return scopeLabels[scope] ?? scope.replace(/(^|[\s/-])\w/g, (c) => c.toUpperCase());
}


export default function ReleaseNotesList({ notes }: { notes: ReleaseNote[] }) {
    return (
        <div className="flex flex-col gap-6">
            {groupNotesByDay(notes).map(({ day, notes }) => (
                <section key={day} className="flex flex-col gap-2">
                    <h3 className="text-sm font-semibold text-muted-foreground">{day}</h3>
                    <ul className="divide-y rounded-lg border bg-card">
                        {notes.map((note) => (
                            <li key={note.commit} className="flex items-baseline gap-3 px-3 py-2.5">
                                <span className={cn(
                                    'w-14 shrink-0 rounded py-0.5 text-center text-xs font-semibold',
                                    typeClasses[note.type],
                                )}>
                                    {typeLabels[note.type]}
                                </span>
                                <span className="flex-1 text-sm">{note.text}</span>
                                {note.scope && (
                                    <span className="shrink-0 text-xs text-muted-foreground max-xs:hidden">
                                        {getScopeLabel(note.scope)}
                                    </span>
                                )}
                            </li>
                        ))}
                    </ul>
                </section>
            ))}
        </div>
    );
}
