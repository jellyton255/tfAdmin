import { ScrollTextIcon } from "lucide-react";
import releaseNotes from "virtual:release-notes";
import { PageHeader } from "@/components/page-header";
import { getTfBuildLabel } from "@/lib/tfBuild";
import ReleaseNotesList from "./ReleaseNotesList";


export default function ReleaseNotesPage() {
    return (
        <div className="flex flex-col w-full gap-4 pb-4 [&>header]:mb-0">
            <PageHeader title="Release Notes" icon={<ScrollTextIcon />}>
                <span className="text-sm text-muted-foreground">
                    Running <strong className="text-secondary-foreground">{getTfBuildLabel()}</strong>
                </span>
            </PageHeader>
            <div className="px-2 md:px-0 pb-4">
                <ReleaseNotesList notes={releaseNotes} />
            </div>
        </div>
    );
}
