import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useActionModalStateValue } from "@/hooks/actionModal";
import { InfoIcon, ListIcon, PencilIcon, StickyNoteIcon } from "lucide-react";
import { useEffect, useState } from "react";
import GenericSpinner from "@/components/GenericSpinner";
import { cn } from "@/lib/utils";
import { useBackendApi } from "@/hooks/fetch";
import { HistoryActionModalResp, HistoryActionModalSuccess } from "@shared/historyApiTypes";
import ActionIdsTab from "./ActionIdsTab";
import ActionInfoTab from "./ActionInfoTab";
import ActionModifyTab from "./ActionModifyTab";
import ActionNotesTab from "./ActionNotesTab";
import type { DatabaseNoteType } from "../../../../core/modules/Database/databaseTypes";
import { ModalContent, ModalTabMessage, ModalTabsList, ModalTabWrapper, type ModalTabInfo } from "@/components/modal-tabs";


const infoTab: ModalTabInfo = {
    title: 'Info',
    icon: <InfoIcon className="mr-2 h-5 w-5 hidden xs:block" />,
};
const idsTab: ModalTabInfo = {
    title: 'IDs',
    icon: <ListIcon className="mr-2 h-5 w-5 hidden xs:block" />,
};
const modifyTab: ModalTabInfo = {
    title: 'Modify',
    icon: <PencilIcon className="mr-2 h-5 w-5 hidden xs:block" />,
};
const notesIcon = <StickyNoteIcon className="mr-2 h-5 w-5 hidden xs:block" />;


export default function ActionModal() {
    const { isModalOpen, closeModal, actionRef } = useActionModalStateValue();
    const [selectedTab, setSelectedTab] = useState(infoTab.title);
    const [currRefreshKey, setCurrRefreshKey] = useState(0);
    const [modalData, setModalData] = useState<HistoryActionModalSuccess | undefined>(undefined);
    const [modalError, setModalError] = useState('');
    const [tsFetch, setTsFetch] = useState(0);
    const historyGetActionApi = useBackendApi<HistoryActionModalResp>({
        method: 'GET',
        path: `/history/action`,
        abortOnUnmount: true,
    });

    //Helper for tabs to be able to refresh the modal data
    const refreshModalData = () => {
        setCurrRefreshKey(currRefreshKey + 1);
    };

    //Querying Action data when reference is available
    useEffect(() => {
        if (!actionRef) return;
        setModalData(undefined);
        setModalError('');
        historyGetActionApi({
            queryParams: { id: actionRef },
            success: (resp) => {
                if ('error' in resp) {
                    setModalError(resp.error);
                } else {
                    setModalData(resp);
                    setTsFetch(Math.round(Date.now() / 1000));
                }
            },
            error: (error) => {
                setModalError(error);
            },
        });
    }, [actionRef, currRefreshKey]);

    //Resetting selected tab when modal is closed
    useEffect(() => {
        if (!isModalOpen) {
            setTimeout(() => {
                setSelectedTab(infoTab.title);
            }, 200);
        }
    }, [isModalOpen]);

    //Kicks are a record only, so they have nothing to modify
    const visibleNoteCount = modalData?.action.notes?.filter((note: DatabaseNoteType) => !note.deleted).length ?? 0;
    const notesTab: ModalTabInfo = { title: 'Notes', icon: notesIcon };
    const modalTabs = modalData?.action.type === 'kick'
        ? [infoTab, notesTab, idsTab]
        : [infoTab, notesTab, idsTab, modifyTab];

    const handleOpenClose = (newOpenState: boolean) => {
        if (isModalOpen && !newOpenState) {
            closeModal();
        }
    };

    //move to tab up or down
    const handleTabButtonKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            const currentIndex = modalTabs.findIndex((tab) => tab.title === selectedTab);
            const nextIndex = e.key === 'ArrowUp' ? currentIndex - 1 : currentIndex + 1;
            const nextTab = modalTabs[nextIndex];
            if (nextTab) {
                setSelectedTab(nextTab.title);
                const nextButton = document.getElementById(`action-modal-tab-${nextTab.title}`);
                if (nextButton) {
                    nextButton.focus();
                }
            }
        }
    }

    let pageTitle: JSX.Element;
    if (modalData) {
        const displayName = modalData.action.playerName !== false
            ? <span>{modalData.action.playerName}</span>
            : <span className="italic opacity-75">unknown player</span>;
        if (modalData.action.type === 'ban') {
            pageTitle = <>
                <span className="text-destructive-inline font-mono mr-2">[{modalData.action.id}]</span>
                Banned {displayName}
            </>;
        } else if (modalData.action.type === 'warn') {
            pageTitle = <>
                <span className="text-warning-inline font-mono mr-2">[{modalData.action.id}]</span>
                Warned {displayName}
            </>;
        } else if (modalData.action.type === 'kick') {
            pageTitle = <>
                <span className="text-muted-foreground font-mono mr-2">[{modalData.action.id}]</span>
                Kicked {displayName}
            </>;
        } else {
            throw new Error(`Unknown action type: ${modalData.action.type}`);
        }
    } else if (modalError) {
        pageTitle = <span className="text-destructive-inline">Error!</span>;
    } else {
        pageTitle = <span className="text-muted-foreground italic">Loading...</span>;
    }

    return (
        <Dialog open={isModalOpen} onOpenChange={handleOpenClose}>
            <DialogContent className="max-w-2xl h-full sm:h-auto max-h-full p-0 gap-1 sm:gap-4 flex flex-col pb-4">
                <DialogHeader className="px-4 py-3 border-b">
                    <DialogTitle className="tracking-wide line-clamp-1 leading-7 break-all mr-6">
                        {pageTitle}
                    </DialogTitle>
                </DialogHeader>

                <ModalContent>
                    <ModalTabsList>
                        {modalTabs.map((tab) => (
                            <Button
                                id={`action-modal-tab-${tab.title}`}
                                key={tab.title}
                                variant={selectedTab === tab.title ? "secondary" : "ghost"}
                                className={cn(
                                    'w-full tracking-wider justify-center md:justify-start',
                                    'h-7 rounded-sm px-2 text-sm',
                                    'md:h-10 md:text-base',
                                    tab.className,
                                )}
                                onClick={() => setSelectedTab(tab.title)}
                                onKeyDown={handleTabButtonKeyDown}
                            >
                                {tab.icon} {tab.title}
                                {tab.title === 'Notes' && visibleNoteCount > 0 && (
                                    <span className="ml-1.5 text-muted-foreground">{visibleNoteCount}</span>
                                )}
                            </Button>
                        ))}
                    </ModalTabsList>

                    <ModalTabWrapper className="max-h-[calc(100vh-3.125rem-4rem)]">
                        {!modalData ? (
                            <ModalTabMessage>
                                {modalError ? (
                                    <span className="text-destructive-inline">Error: {modalError}</span>
                                ) : (
                                    <GenericSpinner msg="Loading..." />
                                )}
                            </ModalTabMessage>
                        ) : (
                            <>
                                {selectedTab === 'Info' && <ActionInfoTab
                                    action={modalData.action}
                                    serverTime={modalData.serverTime}
                                    tsFetch={tsFetch}
                                    setSelectedTab={setSelectedTab}
                                />}
                                {selectedTab === 'Notes' && <ActionNotesTab
                                    action={modalData.action}
                                    serverTime={modalData.serverTime}
                                    refreshModalData={refreshModalData}
                                />}
                                {selectedTab === 'IDs' && <ActionIdsTab
                                    action={modalData.action}
                                />}
                                {selectedTab === 'Modify' && modalData.action.type !== 'kick' && <ActionModifyTab
                                    action={modalData.action}
                                    refreshModalData={refreshModalData}
                                />}
                            </>
                        )}
                    </ModalTabWrapper>
                </ModalContent>
            </DialogContent>
        </Dialog>
    );
}
