import { atom } from 'jotai';

//restarting: txAdmin announced a shutdown; reconnecting: the socket dropped without one
export type ConnectionState = 'online' | 'restarting' | 'reconnecting';
export const connectionStateAtom = atom<ConnectionState>('online');

//The server runs a different tfAdmin build than the one this page loaded
export const panelOutdatedAtom = atom(false);
