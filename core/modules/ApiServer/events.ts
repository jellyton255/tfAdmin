const modulename = 'ApiServer:Events';
import consoleFactory from '@lib/console';
import { API_EVENTS_BUFFER_SIZE, API_EVENT_TYPES, type ApiEvent, type ApiEventType } from '@shared/apiV1Types';
const console = consoleFactory(modulename);

/**
 * In-memory ring buffer of the events txAdmin fires, with a monotonic cursor.
 * Fed by the `txAdmin:events:*` sink in FxRunner.sendEvent plus a few lifecycle hooks
 * (player join/leave, monitor status). Consumed by GET /api/v1/events and the webhook dispatcher.
 */

const VALID_TYPES = new Set<string>(API_EVENT_TYPES);
export const isApiEventType = (type: string): type is ApiEventType => VALID_TYPES.has(type);

/**
 * Maps the in-game event names (txAdmin:events:<name>) to the API catalogue.
 * Unmapped events (eg. consoleCommand, adminsUpdated) are internal and not published.
 */
const SERVER_EVENT_MAP: Record<string, ApiEventType> = {
    serverShuttingDown: 'server.shuttingDown',
    scheduledRestart: 'server.scheduledRestart',
    scheduledRestartSkipped: 'server.scheduledRestartSkipped',
    skippedNextScheduledRestart: 'server.nextRestartSkipped',
    announcement: 'server.announcement',
    configChanged: 'server.configChanged',
    playerBanned: 'player.banned',
    playerWarned: 'player.warned',
    playerKicked: 'player.kicked',
    playerDirectMessage: 'player.directMessage',
    whitelistPlayer: 'whitelist.player',
    whitelistPreApproval: 'whitelist.preApproval',
    whitelistRequest: 'whitelist.request',
    actionRevoked: 'action.revoked',
};

export type ApiEventListener = (event: ApiEvent) => void;

export type ApiEventsQuery = {
    since?: string; //cursor (event id), exclusive
    types?: ApiEventType[];
    limit: number;
};
export type ApiEventsPage = {
    events: ApiEvent[];
    cursor: string | null;
    hasMore: boolean;
    dropped: boolean;
};


/**
 * Event ids are `<seq padded to 12 digits>` so string compare == numeric compare and
 * they work as opaque cursors. seq starts at the process start time so a restart never
 * hands out an id smaller than one a consumer already saw.
 */
const SEQ_WIDTH = 16;
const formatId = (seq: number) => seq.toString().padStart(SEQ_WIDTH, '0');
const parseId = (id: string): number | null => {
    if (typeof id !== 'string' || !/^\d{1,20}$/.test(id)) return null;
    const n = Number(id);
    return Number.isSafeInteger(n) ? n : null;
};


export default class ApiEventBus {
    private readonly capacity: number;
    private buffer: ApiEvent[] = [];
    private seq: number;
    private listeners = new Set<ApiEventListener>();

    constructor(capacity = API_EVENTS_BUFFER_SIZE, startSeq = Date.now() * 1000) {
        this.capacity = capacity;
        this.seq = startSeq;
    }

    get size() {
        return this.buffer.length;
    }

    onEvent(listener: ApiEventListener) {
        this.listeners.add(listener);
        return () => { this.listeners.delete(listener); };
    }


    /**
     * Records an event and notifies listeners. Listener errors never propagate to the emitter.
     */
    emit(type: ApiEventType, data: Record<string, unknown> = {}): ApiEvent {
        const event: ApiEvent = {
            id: formatId(++this.seq),
            type,
            ts: Date.now(),
            data,
        };
        this.buffer.push(event);
        if (this.buffer.length > this.capacity) {
            this.buffer.splice(0, this.buffer.length - this.capacity);
        }
        for (const listener of this.listeners) {
            try {
                listener(event);
            } catch (error) {
                console.verbose.warn(`Event listener error on ${type}: ${(error as Error).message}`);
            }
        }
        return event;
    }


    /**
     * Sink for FxRunner.sendEvent: translates the in-game event name and publishes it.
     * Returns false for events that are not part of the public catalogue.
     */
    publishServerEvent(serverEventType: string, data: unknown): boolean {
        const type = SERVER_EVENT_MAP[serverEventType];
        if (!type) return false;
        const payload = (data && typeof data === 'object' && !Array.isArray(data))
            ? data as Record<string, unknown>
            : { value: data };
        this.emit(type, payload);
        return true;
    }


    /**
     * Pages through the buffer. `since` is exclusive; a cursor older than the buffer start
     * returns everything we still have with `dropped: true`.
     */
    list(query: ApiEventsQuery): ApiEventsPage {
        let dropped = false;
        let startIdx = 0;
        if (query.since) {
            const sinceSeq = parseId(query.since);
            if (sinceSeq === null) {
                startIdx = 0;
                dropped = this.buffer.length > 0;
            } else {
                const oldest = this.buffer[0];
                if (oldest && sinceSeq < parseId(oldest.id)! - 1) {
                    dropped = true;
                }
                startIdx = this.buffer.findIndex((e) => parseId(e.id)! > sinceSeq);
                if (startIdx === -1) startIdx = this.buffer.length;
            }
        }
        const typeFilter = query.types?.length ? new Set(query.types) : null;
        const events: ApiEvent[] = [];
        let hasMore = false;
        for (let i = startIdx; i < this.buffer.length; i++) {
            const event = this.buffer[i];
            if (typeFilter && !typeFilter.has(event.type)) continue;
            if (events.length >= query.limit) {
                hasMore = true;
                break;
            }
            events.push(event);
        }
        //cursor advances past skipped events too, so a filtered consumer never re-reads them
        let cursor: string | null = null;
        if (events.length) {
            cursor = hasMore ? events[events.length - 1].id : (this.buffer[this.buffer.length - 1]?.id ?? null);
        } else if (this.buffer.length && startIdx < this.buffer.length) {
            cursor = this.buffer[this.buffer.length - 1].id;
        } else {
            cursor = query.since ?? null;
        }
        return { events, cursor, hasMore, dropped };
    }
}
