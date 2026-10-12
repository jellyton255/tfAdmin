import { isIP } from 'node:net';

export type RelyingParty = {
    origin: string;
    rpID: string;
};

/**
 * Resolves the WebAuthn relying party from the browser's Origin header.
 * The Host header can't be used because the panel usually sits behind a reverse proxy.
 * Passkeys need a secure context and a domain name, so plain http (other than localhost)
 * and IP addresses are rejected.
 */
export const resolveRelyingParty = (originHeader: unknown): RelyingParty | undefined => {
    if (typeof originHeader !== 'string' || !originHeader) return;
    let url: URL;
    try {
        url = new URL(originHeader);
    } catch (error) {
        return;
    }
    const hostname = url.hostname;
    if (!hostname || isIP(hostname.replace(/^\[|\]$/g, ''))) return;
    const isLocalhost = hostname === 'localhost';
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLocalhost)) return;
    return { origin: url.origin, rpID: hostname };
};
