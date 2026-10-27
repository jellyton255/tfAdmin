import { useEffect, useRef } from 'react';
import { getSocket } from '@/lib/utils';
import { useExpireAuthData, useSetAuthData } from '@/hooks/auth';
import { useSetGlobalStatus } from '@/hooks/status';
import { useProcessUpdateAvailableEvent } from '@/hooks/useWarningBar';
import { connectionStateAtom, panelOutdatedAtom } from '@/hooks/connection';
import { useSetAtom } from 'jotai';
import { mutate } from 'swr';
import { useProcessPlayerlistEvents } from '@/hooks/playerlist';
import { LogoutReasonHash } from '@/pages/auth/Login';


/**
 * Responsible for starting ahd handling the main socket.io connection
 * This has been separated from the MainShell.tsx to avoid possible re-renders
 */
export default function MainSocket() {
    const expireSession = useExpireAuthData();
    const setAuthData = useSetAuthData();
    const socketStateChangeCounter = useRef(0);
    const setConnectionState = useSetAtom(connectionStateAtom);
    const setPanelOutdated = useSetAtom(panelOutdatedAtom);
    const setGlobalStatus = useSetGlobalStatus();
    const processPlayerlistEvents = useProcessPlayerlistEvents();
    const processUpdateAvailableEvent = useProcessUpdateAvailableEvent();

    //Runing on mount only
    useEffect(() => {
        //SocketIO
        const rooms = window.txConsts.isWebInterface ? ['status', 'playerlist'] : ['status'];
        const socket = getSocket(rooms);
        let hasConnected = false;
        let isRestarting = false;
        socket.on('connect', () => {
            console.log("Main Socket.IO Connected.");
            socketStateChangeCounter.current++;
            isRestarting = false;
            setConnectionState('online');
            //Pages hold data from before the outage
            if (hasConnected) mutate(() => true);
            hasConnected = true;
        });
        socket.on('disconnect', (message) => {
            console.log("Main Socket.IO Disonnected:", message);
            //socket.io only retries by itself after transport drops, not when the server closed the socket
            if (isRestarting && message === 'io server disconnect') {
                setTimeout(() => socket.connect(), 1000);
                return;
            }
            //Grace period of 500ms to allow for quick reconnects
            //Tracking the state change ID for the timeout not to overwrite a reconnection
            const newId = socketStateChangeCounter.current + 1;
            socketStateChangeCounter.current = newId;
            setTimeout(() => {
                if (socketStateChangeCounter.current === newId && !isRestarting) {
                    setConnectionState('reconnecting');
                }
            }, 500);
        });
        socket.on('error', (error) => {
            console.log('Main Socket.IO', error);
        });
        socket.on('logout', function (reason) {
            expireSession('main socketio', reason);
        });
        socket.on('refreshToUpdate', function () {
            expireSession('main socketio', 'got refreshToUpdate', LogoutReasonHash.UPDATED);
        });
        socket.on('txAdminShuttingDown', function () {
            //The session survives the restart, so wait for the new process instead of logging out
            isRestarting = true;
            setConnectionState('restarting');
        });
        socket.on('status', function (status) {
            setGlobalStatus(status);
        });
        socket.on('playerlist', function (playerlistData) {
            if (!window.txConsts.isWebInterface) return;
            processPlayerlistEvents(playerlistData);
        });
        socket.on('updateAvailable', function (data) {
            processUpdateAvailableEvent(data);
        });
        socket.on('runningBuild', function (commit) {
            const loadedCommit = window.txConsts.tfaBuild?.commit;
            setPanelOutdated(!!loadedCommit && commit !== loadedCommit);
        });
        socket.on('updateAuthData', function (authData) {
            console.warn('Got updateAuthData from websocket', authData);
            setAuthData(authData);
        });

        return () => {
            socket.removeAllListeners();
            socket.disconnect();
            setGlobalStatus(null);
            setConnectionState('online');
        }
    }, []);

    return null;
}
