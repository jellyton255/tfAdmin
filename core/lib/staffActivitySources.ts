const modulename = 'StaffActivitySources';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { z } from 'zod';
import got from '@lib/got';
import consoleFactory from '@lib/console';
const console = consoleFactory(modulename);

/*
    Staff activity from outside tfAdmin, both keyed by Discord user id:
    - tickets: POST <ticketsUrl>/staff/activity on the ticket agent API, with an efa_ token (staff:read);
    - Discord: POST <discordUrl>/staff/activity on EF Bot, signed with STAFF_ACTIVITY_SECRET the same way
      as EF Bot's ticket gateway routes.
    Both take { discordIds, weekStarts } and answer one member per id with one row per week.
*/

const REQUEST_TIMEOUT_MS = 8_000;
const MAX_DISCORD_IDS = 100;

export const SOURCE_COUNT_KEYS = [
    'ticketReplies',
    'ticketNotes',
    'staffThreadMessages',
    'ticketsClosed',
    'discordMessages',
    'voiceMinutes',
] as const;
type SourceCountKey = typeof SOURCE_COUNT_KEYS[number];

export type SourceActivityRow = {
    discordId: string;
    weeks: Partial<Record<SourceCountKey, number>>[];
};
export type SourceActivityResult =
    | { state: 'ok'; rows: SourceActivityRow[] }
    | { state: 'off' }
    | { state: 'error'; message: string };

const count = z.number().int().min(0);
const ticketRespSchema = z.object({
    members: z.array(z.object({
        discordId: z.string(),
        weeks: z.array(z.object({
            replies: count,
            internalNotes: count,
            staffThreadMessages: count,
            ticketsClosed: count,
        })),
    })),
});
const discordRespSchema = z.object({
    members: z.array(z.object({
        discordId: z.string(),
        weeks: z.array(z.object({
            messages: count,
            voiceMinutes: count,
        })),
    })),
});


/**
 * Posts the request and returns the parsed JSON body, or an error message for the page.
 */
async function postJson(
    source: string,
    url: URL,
    body: string,
    headers: Record<string, string>,
): Promise<{ data: unknown } | { error: string }> {
    try {
        const resp = await got.post(url, {
            body,
            headers: { 'content-type': 'application/json', ...headers },
            timeout: { request: REQUEST_TIMEOUT_MS },
            retry: { limit: 0 },
            throwHttpErrors: false,
        });
        if (resp.statusCode !== 200) {
            console.verbose.warn(`${source} answered HTTP ${resp.statusCode}.`);
            return { error: `${source} answered HTTP ${resp.statusCode}.` };
        }
        const data: unknown = JSON.parse(resp.body);
        return { data };
    } catch (error) {
        //network failures and invalid JSON from another service
        const message = error instanceof Error ? error.message : String(error);
        console.verbose.warn(`${source} request failed: ${message}`);
        return { error: `${source} did not answer.` };
    }
}

/**
 * Joins a path onto a base URL that may already have one (such as /api/tickets/agent).
 */
const joinUrl = (base: string, path: string) => new URL(`${base.replace(/\/+$/, '')}${path}`);


/**
 * Weekly ticket replies, internal notes, staff thread messages and closed tickets per Discord id.
 */
export async function fetchTicketActivity(discordIds: string[], weekStarts: number[]): Promise<SourceActivityResult> {
    const { ticketsUrl, ticketsToken } = txConfig.staffActivity;
    if (!ticketsToken) return { state: 'off' };
    if (!discordIds.length) return { state: 'ok', rows: [] };

    const body = JSON.stringify({ discordIds: discordIds.slice(0, MAX_DISCORD_IDS), weekStarts });
    const resp = await postJson('The ticket API', joinUrl(ticketsUrl, '/staff/activity'), body, {
        authorization: `Bearer ${ticketsToken}`,
    });
    if ('error' in resp) return { state: 'error', message: resp.error };
    const parsed = ticketRespSchema.safeParse(resp.data);
    if (!parsed.success) return { state: 'error', message: 'The ticket API returned an invalid response.' };

    return {
        state: 'ok',
        rows: parsed.data.members.map((member) => ({
            discordId: member.discordId,
            weeks: member.weeks.map((week) => ({
                ticketReplies: week.replies,
                ticketNotes: week.internalNotes,
                staffThreadMessages: week.staffThreadMessages,
                ticketsClosed: week.ticketsClosed,
            })),
        })),
    };
}


/**
 * Signature headers for EF Bot's signed routes: HMAC-SHA256 (hex) over
 * `timestamp\nnonce\nPOST\npath\nsha256hex(body)`, keyed with the secret's UTF-8 bytes.
 */
export function signBotRequest(secret: string, path: string, body: string, nowMs = Date.now(), nonce = randomUUID()) {
    const timestamp = String(nowMs);
    const bodyHash = createHash('sha256').update(body, 'utf8').digest('hex');
    const signature = createHmac('sha256', secret)
        .update(`${timestamp}\n${nonce}\nPOST\n${path}\n${bodyHash}`, 'utf8')
        .digest('hex');
    return {
        'x-ticket-timestamp': timestamp,
        'x-ticket-nonce': nonce,
        'x-ticket-signature': signature,
    };
}


/**
 * Weekly Discord messages and voice minutes per Discord id, from EF Bot.
 */
export async function fetchDiscordActivity(discordIds: string[], weekStarts: number[]): Promise<SourceActivityResult> {
    const { discordUrl, discordSecret } = txConfig.staffActivity;
    if (!discordSecret) return { state: 'off' };
    if (!discordIds.length) return { state: 'ok', rows: [] };

    const url = joinUrl(discordUrl, '/staff/activity');
    const body = JSON.stringify({ discordIds: discordIds.slice(0, MAX_DISCORD_IDS), weekStarts });
    const resp = await postJson('EF Bot', url, body, signBotRequest(discordSecret, url.pathname, body));
    if ('error' in resp) return { state: 'error', message: resp.error };
    const parsed = discordRespSchema.safeParse(resp.data);
    if (!parsed.success) return { state: 'error', message: 'EF Bot returned an invalid response.' };

    return {
        state: 'ok',
        rows: parsed.data.members.map((member) => ({
            discordId: member.discordId,
            weeks: member.weeks.map((week) => ({
                discordMessages: week.messages,
                voiceMinutes: week.voiceMinutes,
            })),
        })),
    };
}
