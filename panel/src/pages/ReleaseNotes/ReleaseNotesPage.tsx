import { ScrollTextIcon } from "lucide-react";
import releaseNotes from "virtual:release-notes";
import { PageHeader } from "@/components/page-header";
import ReleaseNotesList from "./ReleaseNotesList";


export default function ReleaseNotesPage() {
    return (
        <div className="flex flex-col h-full w-full gap-4 max-w-screen-md mx-auto">
            <PageHeader title="Release Notes" icon={<ScrollTextIcon />} />
            <div className="px-2 pb-8">
                <ReleaseNotesList notes={releaseNotes} />
            </div>
        </div>
    );
}
