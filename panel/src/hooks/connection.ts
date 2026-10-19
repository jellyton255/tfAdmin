import { atom } from 'jotai';

//restarting: txAdmin announced a shutdown; reconnecting: the socket dropped without one
export type ConnectionState = 'online' | 'restarting' | 'reconnecting';
export const connectionStateAtom = atom<ConnectionState>('online');
