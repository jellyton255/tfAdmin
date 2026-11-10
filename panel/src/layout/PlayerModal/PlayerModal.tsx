import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { setPlayerModalUrlParam, usePlayerModalStateValue, type PlayerModalRefType } from "@/hooks/playerModal";
import GenericSpinner from "@/components/GenericSpinner";
import { useBackendApi } from "@/hooks/fetch";
import { useAddRecentLookup } from "@/hooks/recentLookups";
import type { PlayerModalResp, PlayerModalSuccess } from "@shared/playerApiTypes";
import PlayerHeader from "./PlayerHeader";
import PlayerRail, { type PlayerView } from "./PlayerRail";
import PlayerOverview from "./PlayerOverview";
import PlayerHistoryTab from "./PlayerHistoryTab";
import PlayerNotesTab from "./PlayerNotesTab";
import PlayerIdsTab from "./PlayerIdsTab";
import PlayerLinkedTab from "./PlayerLinkedTab";
import PlayerBanTab from "./PlayerBanTab";
import PlayerCharacterPage from "./PlayerCharactersTab";
import { Panel, PanelHeader } from "./parts";


type PlayerWindowProps = {
    playerRef: PlayerModalRefType;
    data: PlayerModalSuccess;
    view: PlayerView;
    setView: (view: PlayerView) => void;
    refreshModalData: () => void;
};

/**
 * Everfall: the player window, laid out like ef_administration. A rail lists the player's sections
 * and characters; the header holds the action keys so they never scroll away.
 */
function PlayerWindow({ playerRef, data, view, setView, refreshModalData }: PlayerWindowProps) {
    const { player, serverTime } = data;

    let body: JSX.Element;
    if ('citizenId' in view) {
        body = <PlayerCharacterPage playerRef={playerRef} citizenId={view.citizenId} />;
    } else if (view.section === 'history') {
        body = <PlayerHistoryTab actions={player.actionHistory} banTemplates={data.banTemplates} serverTime={serverTime} />;
    } else if (view.section === 'notes') {
        body = <PlayerNotesTab playerRef={playerRef} player={player} serverTime={serverTime} refreshModalData={refreshModalData} />;
    } else if (view.section === 'linked') {
        body = (
            <Panel>
                <PanelHeader title="Linked Accounts" />
                <div className="p-3"><PlayerLinkedTab playerRef={playerRef} onOpenPlayer={() => setView({ section: 'overview' })} /></div>
            </Panel>
        );
    } else if (view.section === 'ids') {
        body = (
            <Panel>
                <PanelHeader title="Identifiers" />
                <div className="p-3"><PlayerIdsTab playerRef={playerRef} player={player} refreshModalData={refreshModalData} /></div>
            </Panel>
        );
    } else if (view.section === 'ban') {
        body = (
            <Panel>
                <PanelHeader title="Ban or Warn" />
                <div className="p-3">
                    <PlayerBanTab
                        banTemplates={data.banTemplates}
                        playerRef={playerRef}
                        history={player.actionHistory}
                        serverTime={serverTime}
                        windowDays={data.offenseWindowDays}
                    />
                </div>
            </Panel>
        );
    } else {
        body = <PlayerOverview playerRef={playerRef} data={data} onViewChange={setView} />;
    }

    return (<>
        <DialogTitle className="sr-only">{player.displayName}</DialogTitle>
        <PlayerHeader
            playerRef={playerRef}
            player={player}
            serverTime={serverTime}
            tagSuggestions={data.tagSuggestions}
            onOpenSection={(section) => setView({ section })}
            refreshModalData={refreshModalData}
        />
        <div className="flex min-h-0 grow flex-col md:flex-row">
            <PlayerRail playerRef={playerRef} player={player} view={view} onViewChange={setView} />
            <main className="min-h-0 min-w-0 grow overflow-y-auto p-3 md:p-4">
                {body}
            </main>
        </div>
    </>);
}


const overview: PlayerView = { section: 'overview' };

export default function PlayerModal() {
    const { isModalOpen, closeModal, playerRef } = usePlayerModalStateValue();
    const [currRefreshKey, setCurrRefreshKey] = useState(0);
    const [modalData, setModalData] = useState<PlayerModalSuccess | undefined>(undefined);
    const [modalError, setModalError] = useState('');
    // The open section outlives a data refresh; it belongs to one player and resets on close
    const [viewState, setViewState] = useState<{ key?: string; view: PlayerView }>({ view: overview });
    const addRecent = useAddRecentLookup();
    const playerQueryApi = useBackendApi<PlayerModalResp>({
        method: 'GET',
        path: `/player`,
        abortOnUnmount: true,
    });

    //Helper for sections to be able to refresh the modal data
    const refreshModalData = () => {
        setCurrRefreshKey(currRefreshKey + 1);
    };

    //Querying player data when reference is available
    useEffect(() => {
        if (!playerRef) return;
        setModalData(undefined);
        setModalError('');
        playerQueryApi({
            queryParams: playerRef,
            success: (resp) => {
                if ('error' in resp) {
                    setModalError(resp.error);
                } else {
                    setModalData(resp);
                    if (resp.player.license) {
                        addRecent({ kind: 'player', license: resp.player.license, name: resp.player.displayName, ts: Date.now() });
                    }
                    //Update the ref param to use a license, if possible
                    if (!('license' in playerRef) && resp.player.license) {
                        setPlayerModalUrlParam(resp.player.license)
                    }
                }
            },
            error: (error) => {
                setModalError(error);
            },
        });
    }, [playerRef, currRefreshKey]);

    const handleOpenClose = (newOpenState: boolean) => {
        if (isModalOpen && !newOpenState) {
            setViewState({ view: overview });
            closeModal();
        }
    };

    // A new player opens on its overview
    const windowKey = playerRef && ('license' in playerRef ? playerRef.license : `${playerRef.mutex}#${playerRef.netid}`);
    const view = viewState.key === windowKey ? viewState.view : overview;

    return (
        <Dialog open={isModalOpen} onOpenChange={handleOpenClose}>
            <DialogContent className="ef-type flex h-full max-h-full max-w-[min(1380px,100vw)] flex-col gap-0 overflow-hidden p-0 font-sans sm:h-[min(56rem,calc(100vh-2rem))] sm:max-w-[min(1380px,calc(100vw-2rem))]">
                {modalData && playerRef ? (
                    <PlayerWindow
                        playerRef={playerRef}
                        data={modalData}
                        view={view}
                        setView={(next) => setViewState({ key: windowKey, view: next })}
                        refreshModalData={refreshModalData}
                    />
                ) : (
                    <div className="flex grow items-center justify-center p-10 text-lg text-muted-foreground">
                        <DialogTitle className="sr-only">Player</DialogTitle>
                        {modalError
                            ? <span className="text-destructive-inline">Error: {modalError}</span>
                            : <GenericSpinner msg="Loading..." />}
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
}
