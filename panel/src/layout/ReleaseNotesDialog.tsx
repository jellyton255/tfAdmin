import { useState } from "react";
import { Link } from "wouter";
import releaseNotes from "virtual:release-notes";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { LocalStorageKey } from "@/lib/localStorage";
import { getUnseenNotes } from "@/lib/releaseNotes";
import ReleaseNotesList from "@/pages/ReleaseNotes/ReleaseNotesList";

function readLastSeenCommit() {
    try {
        return localStorage.getItem(LocalStorageKey.ReleaseNotesSeenCommit);
    } catch (error) {
        return null;
    }
}


/**
 * Shows the changes since this browser last saw the release notes, once per update.
 */
export default function ReleaseNotesDialog() {
    const [unseenNotes] = useState(() => window.txConsts.isWebInterface
        ? getUnseenNotes(releaseNotes, readLastSeenCommit())
        : []);
    const [isOpen, setIsOpen] = useState(unseenNotes.length > 0);
    if (!unseenNotes.length) return null;

    function handleOpenChange(open: boolean) {
        if (!open) {
            try {
                localStorage.setItem(LocalStorageKey.ReleaseNotesSeenCommit, releaseNotes[0].commit);
            } catch (error) { }
        }
        setIsOpen(open);
    }

    return (
        <Dialog open={isOpen} onOpenChange={handleOpenChange}>
            <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col gap-4">
                <DialogHeader>
                    <DialogTitle>What's New in tfAdmin</DialogTitle>
                </DialogHeader>
                <div className="-mx-6 px-6 overflow-y-auto">
                    <ReleaseNotesList notes={unseenNotes} />
                </div>
                <DialogFooter className="gap-2">
                    <Button variant="outline" asChild>
                        <Link href="/system/release-notes" onClick={() => handleOpenChange(false)}>
                            All Release Notes
                        </Link>
                    </Button>
                    <Button onClick={() => handleOpenChange(false)}>Done</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
