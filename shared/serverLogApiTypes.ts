import type { GenericApiErrorResp } from "./genericApiTypes";

/**
 * Server log event, as produced by core/modules/Logger/handlers/server.js
 */
export type ServerLogEventType = {
    ts: number;
    type: string;
    src: {
        //`${mutex}#${netid}` for player sources
        id: string | false;
        name: string;
    };
    msg: string;
};

export type ServerLogPartialResp = {
    boundry: boolean;
    log: ServerLogEventType[];
} | GenericApiErrorResp;
