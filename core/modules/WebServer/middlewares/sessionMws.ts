import { UserInfoType } from "@modules/AdminStore/providers/CitizenFX";
import { validSessAuthSchema, type CfxreSessAuthType, type PassSessAuthType } from "../authLogic";
import { LRUCacheWithDelete } from "mnemonist";
import { RawKoaCtx } from "../ctxTypes";
import { Next } from "koa";
import fs from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import consoleFactory from '@lib/console';
import { Socket } from "socket.io";
import { parse as cookieParse } from 'cookie';
import { SetOption as KoaCookieSetOption } from "cookies";
import type { DeepReadonly } from 'utility-types';
const console = consoleFactory('WebServer:Sessions');

//Types
export type ValidSessionType = {
    auth?: PassSessAuthType | CfxreSessAuthType;
    tmpOauthLoginStateKern?: string; //uuid v4
    tmpOauthLoginCallbackUri?: string; //the URI provided to the IDMS as a callback
    tmpAddMasterUserInfo?: UserInfoType;
}
export type SessToolsType = {
    get: () => DeepReadonly<ValidSessionType> | undefined;
    set: (sess: ValidSessionType) => void;
    destroy: () => void;
}
type StoredSessionType = {
    expires: number;
    data: ValidSessionType;
}

/**
 * How long an admin stays signed in without using the panel.
 * Every authenticated request slides the expiry forward.
 */
export const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const PERSIST_DEBOUNCE_MS = 30_000;

const storedSessionSchema = z.object({
    expires: z.number(),
    data: z.object({ auth: validSessAuthSchema }),
});
const sessionsFileSchema = z.object({
    version: z.literal(1),
    sessions: z.record(z.string(), storedSessionSchema),
});

/**
 * Hashes the cookie value so the session file never holds usable session ids.
 */
const hashSessId = (sessId: string) => createHash('sha256').update(sessId).digest('hex');

/**
 * Storage for the sessions.
 * Signed-in sessions are mirrored to a file so a tfAdmin restart doesn't sign every admin out.
 */
export class SessionMemoryStorage {
    private readonly sessions = new LRUCacheWithDelete<string, StoredSessionType>(5000);
    private persistTimer: NodeJS.Timeout | null = null;

    constructor(
        public readonly maxAgeMs = SESSION_MAX_AGE_MS,
        private readonly filePath?: string,
    ) {
        this.load();

        //Cleanup every 5 mins
        setInterval(() => {
            const now = Date.now();
            for (const [key, sess] of this.sessions) {
                if (sess.expires < now) {
                    this.sessions.delete(key);
                }
            }
        }, 5 * 60_000).unref();
    }

    get(key: string) {
        const hash = hashSessId(key);
        const stored = this.sessions.get(hash);
        if (!stored) return;
        if (stored.expires < Date.now()) {
            this.sessions.delete(hash);
            return;
        }
        return stored.data as DeepReadonly<ValidSessionType>;
    }

    set(key: string, sess: ValidSessionType) {
        this.sessions.set(hashSessId(key), {
            expires: Date.now() + this.maxAgeMs,
            data: sess,
        });
        this.persistSoon(0);
    }

    refresh(key: string) {
        const hash = hashSessId(key);
        const stored = this.sessions.get(hash);
        if (!stored) return;
        this.sessions.set(hash, {
            expires: Date.now() + this.maxAgeMs,
            data: stored.data,
        });
        this.persistSoon(PERSIST_DEBOUNCE_MS);
    }

    destroy(key: string) {
        const deleted = this.sessions.delete(hashSessId(key));
        this.persistSoon(0);
        return deleted;
    }

    get size() {
        return this.sessions.size;
    }

    /**
     * Writes pending changes synchronously, for shutdown.
     */
    flush() {
        if (!this.persistTimer) return;
        clearTimeout(this.persistTimer);
        this.persistTimer = null;
        this.persist();
    }

    /**
     * Loads the signed-in sessions saved by the previous run, dropping expired ones.
     * A missing or unreadable file only means everyone signs in again.
     */
    private load() {
        if (!this.filePath) return;
        let raw: string;
        try {
            raw = fs.readFileSync(this.filePath, 'utf8');
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
                console.warn(`Failed to read the sessions file: ${(error as Error).message}`);
            }
            return;
        }
        let parsed: z.infer<typeof sessionsFileSchema>;
        try {
            parsed = sessionsFileSchema.parse(JSON.parse(raw));
        } catch (error) {
            console.warn(`Ignoring an invalid sessions file: ${(error as Error).message}`);
            return;
        }
        const now = Date.now();
        for (const [hash, stored] of Object.entries(parsed.sessions)) {
            if (stored.expires < now) continue;
            this.sessions.set(hash, stored);
        }
        console.verbose.ok(`Restored ${this.sessions.size} admin session(s).`);
    }

    private persistSoon(delayMs: number) {
        if (!this.filePath) return;
        if (this.persistTimer) {
            if (delayMs > 0) return;
            clearTimeout(this.persistTimer);
        }
        this.persistTimer = setTimeout(() => {
            this.persistTimer = null;
            this.persist();
        }, delayMs);
    }

    /**
     * Atomically writes the signed-in sessions (temp file + rename).
     * Sessions without auth only hold short-lived OAuth state, so they aren't kept.
     */
    private persist() {
        if (!this.filePath) return;
        const now = Date.now();
        const sessions: Record<string, StoredSessionType> = {};
        for (const [hash, stored] of this.sessions) {
            if (!stored.data.auth || stored.expires < now) continue;
            sessions[hash] = stored;
        }
        const tmpPath = `${this.filePath}.${process.pid}.tmp`;
        try {
            fs.writeFileSync(tmpPath, JSON.stringify({ version: 1, sessions }), { encoding: 'utf8', mode: 0o600 });
            fs.renameSync(tmpPath, this.filePath);
        } catch (error) {
            fs.rmSync(tmpPath, { force: true });
            console.warn(`Failed to save the sessions file: ${(error as Error).message}`);
        }
    }
}


/**
 * Helper to check if the session id is valid
 */
const isValidSessId = (sessId: string) => {
    if (typeof sessId !== 'string') return false;
    if (sessId.length !== 36) return false;
    return true;
}


/**
 * Middleware factory to add sessTools to the koa context.
 */
export const koaSessMw = (cookieName: string, store: SessionMemoryStorage) => {
    const cookieOptions = {
        path: '/',
        maxAge: store.maxAgeMs,
        httpOnly: true,
        sameSite: 'lax',
        secure: false,
        overwrite: true,
        signed: false,

    } as KoaCookieSetOption;

    //Middleware
    return async (ctx: RawKoaCtx, next: Next) => {
        const sessGet = () => {
            const sessId = ctx.cookies.get(cookieName);
            if (!sessId || !isValidSessId(sessId)) return;
            const stored = store.get(sessId);
            if (!stored) return;
            ctx._refreshSessionCookieId = sessId;
            return stored;
        }

        const sessSet = (sess: ValidSessionType) => {
            const sessId = ctx.cookies.get(cookieName);
            if (!sessId || !isValidSessId(sessId)) {
                const newSessId = randomUUID();
                ctx.cookies.set(cookieName, newSessId, cookieOptions);
                store.set(newSessId, sess);
            } else {
                store.set(sessId, sess);
            }
        }

        const sessDestroy = () => {
            const sessId = ctx.cookies.get(cookieName);
            if (!sessId || !isValidSessId(sessId)) return;
            store.destroy(sessId);
            ctx.cookies.set(cookieName, 'unset', cookieOptions);
        }

        ctx.sessTools = {
            get: sessGet,
            set: sessSet,
            destroy: sessDestroy,
        } satisfies SessToolsType;

        try {
            return await next();
        } finally {
            if (typeof ctx._refreshSessionCookieId === 'string') {
                ctx.cookies.set(cookieName, ctx._refreshSessionCookieId, cookieOptions);
                store.refresh(ctx._refreshSessionCookieId);
            }
        }
    }
}


/**
 * Middleware factory to add sessTools to the socket context.
 * 
 * NOTE: The set() and destroy() functions are NO-OPs because we cannot set cookies in socket.io,
 *  but that's fine since socket pages are always acompanied by a web page
 *  the authLogic only needs to get the cookie, and the webAuthMw only destroys it
 *  and webSocket.handleConnection() just drops if authLogic fails.
 */
export const socketioSessMw = (cookieName: string, store: SessionMemoryStorage) => {
    return async (socket: Socket & { sessTools?: SessToolsType }, next: Function) => {
        const sessGet = () => {
            const cookiesString = socket?.handshake?.headers?.cookie;
            if (typeof cookiesString !== 'string') return;
            const cookies = cookieParse(cookiesString);
            const sessId = cookies[cookieName];
            if (!sessId || !isValidSessId(sessId)) return;
            return store.get(sessId);
        }

        socket.sessTools = {
            get: sessGet,
            set: (sess: ValidSessionType) => { },
            destroy: () => { },
        } satisfies SessToolsType;

        return next();
    }
}
