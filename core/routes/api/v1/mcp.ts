import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { txEnv } from '@core/globalData';
import got from '@lib/got';
import { ACTOR_ID_HEADER, type ApiKeyCtx } from '@modules/ApiServer/apiKeyAuthMw';
import { API_EVENT_TYPES } from '@shared/apiV1Types';
import { licenseParamSchema, searchQuerySchema as playersQuerySchema } from './players';
import { idParamSchema as actionIdParamSchema, searchQuerySchema as actionsQuerySchema } from './actions';
import { listQuerySchema as whitelistQuerySchema } from './whitelist';
import { querySchema as eventsQuerySchema } from './events';
import { idParamSchema as webhookIdParamSchema } from './webhooks';
import { adminLogQueryShape } from '@routes/adminLogSearch';
import { staffActivityQuerySchema } from '@routes/staffActivity';
import { actionNoteBodySchema, actionNoteParamSchema, banIdsBodySchema, banAppealBodySchema, banLengthBodySchema, revokeBodySchema } from './actionWrites';
import { identifierBodySchema, reqIdParamSchema, denyAllBodySchema } from './whitelistWrites';
import {
    banBodySchema, warnBodySchema, kickBodySchema, messageBodySchema, whitelistBodySchema, noteBodySchema, noteIdParamSchema,
    watchBodySchema, tagsBodySchema,
} from './playerWrites';
import {
    controlParamSchema, announceBodySchema, kickAllBodySchema, commandBodySchema, resourceParamSchema,
} from './server';

/*
 * POST /api/v1/mcp - Model Context Protocol endpoint (stateless Streamable HTTP, JSON responses).
 * Each tool is one /api/v1 route: the call is replayed against this same server with the caller's
 * own bearer token (and actor header), so the route's scope check, validation, rate limit and
 * action log stay the only authority. tools/list only shows the tools the key's scopes allow.
 */

type ToolRequest = {
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    path: string;
    query?: Record<string, unknown>;
    body?: Record<string, unknown>;
};

type ToolDefinition = {
    name: string;
    title: string;
    description: string;
    scopes?: string[]; //the key needs one of these; none = any key
    input?: z.ZodRawShape;
    annotations: typeof readOnly | typeof write | typeof destructive;
    request: (input: any) => ToolRequest;
};

const readOnly = { readOnlyHint: true, openWorldHint: false } as const;
const write = { readOnlyHint: false, destructiveHint: false, openWorldHint: false } as const;
const destructive = { readOnlyHint: false, destructiveHint: true, openWorldHint: false } as const;
const enc = encodeURIComponent;

const paging = 'Results are paginated: pass meta.nextCursor back as cursor for the next page.';
const durationHelp = 'Ban length, such as "2 hours", "3 days", "1 week", or "permanent".';

export const MCP_TOOLS: ToolDefinition[] = [
    //Identity and server
    {
        name: 'tfadmin_whoami',
        title: 'Who Am I',
        description: 'The API key this agent uses: its name, scopes, and expiry, plus the tfAdmin version.',
        annotations: readOnly,
        request: () => ({ method: 'GET', path: '/me' }),
    },
    {
        name: 'tfadmin_status',
        title: 'Server Status',
        description: 'tfAdmin and FXServer status: server health, uptime, player count and slots, whitelist mode, next scheduled restart, and Discord bot state. Start here.',
        annotations: readOnly,
        request: () => ({ method: 'GET', path: '/status' }),
    },
    {
        name: 'tfadmin_resources_list',
        title: 'List Resources',
        description: 'Every resource the game server knows about with its state (started, stopped...), path, version, and author. Only works while the server is running.',
        annotations: readOnly,
        request: () => ({ method: 'GET', path: '/resources' }),
    },

    //Players
    {
        name: 'tfadmin_players_search',
        title: 'Search Players',
        description: `Search the player database by name, identifiers (license:, discord:, fivem:, hwid...), note text, or one tag (type=tag). filter is a comma list of isAdmin, isOnline, isWhitelisted, hasNote, isWatched. ${paging}`,
        input: playersQuerySchema.shape,
        annotations: readOnly,
        request: (query) => ({ method: 'GET', path: '/players', query }),
    },
    {
        name: 'tfadmin_players_online',
        title: 'Online Players',
        description: 'Players connected right now, with their server id (netid), name, and license.',
        annotations: readOnly,
        request: () => ({ method: 'GET', path: '/players/online' }),
    },
    {
        name: 'tfadmin_players_stats',
        title: 'Player Counts',
        description: 'Total players, players seen and joined in the last 24 hours and 7 days, and players online now.',
        annotations: readOnly,
        request: () => ({ method: 'GET', path: '/players/stats' }),
    },
    {
        name: 'tfadmin_players_get',
        title: 'Read Player',
        description: 'One player in full by license: identifiers, hardware ids, play time, staff notes (noteHistory, newest first), the current session if online, and every ban and warning.',
        input: licenseParamSchema.shape,
        annotations: readOnly,
        request: ({ license }) => ({ method: 'GET', path: `/players/${enc(license)}` }),
    },
    {
        name: 'tfadmin_players_linked',
        title: 'Linked Accounts',
        description: 'Other players that share an identifier (license, license2, discord, fivem, steam, live, xbl; never IP) or a hardware id with this license, with what matched and whether each one is banned. At most 50, strongest links first; hardware ids shared by more than 25 players are skipped and listed in ignoredHwids.',
        input: licenseParamSchema.shape,
        annotations: readOnly,
        request: ({ license }) => ({ method: 'GET', path: `/players/${enc(license)}/linked` }),
    },
    {
        name: 'tfadmin_players_ban',
        title: 'Ban Player',
        description: `Ban a player by license. Kicks them if online. ${durationHelp} The optional note is a staff note saved on the ban, never shown to the player.`,
        scopes: ['players.ban'],
        input: { ...licenseParamSchema.shape, ...banBodySchema.shape },
        annotations: destructive,
        request: ({ license, ...body }) => ({ method: 'POST', path: `/players/${enc(license)}/ban`, body }),
    },
    {
        name: 'tfadmin_players_warn',
        title: 'Warn Player',
        description: 'Record a warning on a player by license. An online player sees it right away; an offline player sees it on next join. The optional note is a staff note, never shown to the player.',
        scopes: ['players.warn'],
        input: { ...licenseParamSchema.shape, ...warnBodySchema.shape },
        annotations: destructive,
        request: ({ license, ...body }) => ({ method: 'POST', path: `/players/${enc(license)}/warn`, body }),
    },
    {
        name: 'tfadmin_players_kick',
        title: 'Kick Player',
        description: 'Kick an online player by license, with an optional reason and an optional staff note. The kick is recorded in the player history.',
        scopes: ['players.kick'],
        input: { ...licenseParamSchema.shape, ...kickBodySchema.shape },
        annotations: destructive,
        request: ({ license, ...body }) => ({ method: 'POST', path: `/players/${enc(license)}/kick`, body }),
    },
    {
        name: 'tfadmin_players_message',
        title: 'Message Player',
        description: 'Send a direct message to an online player by license.',
        scopes: ['players.direct_message'],
        input: { ...licenseParamSchema.shape, ...messageBodySchema.shape },
        annotations: write,
        request: ({ license, ...body }) => ({ method: 'POST', path: `/players/${enc(license)}/message`, body }),
    },
    {
        name: 'tfadmin_players_set_whitelist',
        title: 'Set Player Whitelist',
        description: 'Whitelist a player by license (whitelisted: true) or remove their whitelist (false).',
        scopes: ['players.whitelist'],
        input: { ...licenseParamSchema.shape, ...whitelistBodySchema.shape },
        annotations: destructive,
        request: ({ license, ...body }) => ({ method: 'PUT', path: `/players/${enc(license)}/whitelist`, body }),
    },
    {
        name: 'tfadmin_players_add_note',
        title: 'Add Player Note',
        description: 'Add a staff note to a player by license. Earlier notes are kept; read them with tfadmin_players_get.',
        scopes: ['players.note'],
        input: { ...licenseParamSchema.shape, ...noteBodySchema.shape },
        annotations: write,
        request: ({ license, ...body }) => ({ method: 'POST', path: `/players/${enc(license)}/notes`, body }),
    },
    {
        name: 'tfadmin_players_delete_note',
        title: 'Delete Player Note',
        description: 'Delete one staff note from a player by license and note id (from noteHistory in tfadmin_players_get).',
        scopes: ['players.note'],
        input: { ...licenseParamSchema.shape, ...noteIdParamSchema.shape },
        annotations: destructive,
        request: ({ license, noteId }) => ({ method: 'DELETE', path: `/players/${enc(license)}/notes/${enc(noteId)}` }),
    },
    {
        name: 'tfadmin_players_watch',
        title: 'Watch Player',
        description: 'Put a player on the watchlist by license, with the reason. Online staff are alerted when they join. Replaces the reason if already watched.',
        scopes: ['players.note'],
        input: { ...licenseParamSchema.shape, ...watchBodySchema.shape },
        annotations: write,
        request: ({ license, ...body }) => ({ method: 'PUT', path: `/players/${enc(license)}/watch`, body }),
    },
    {
        name: 'tfadmin_players_unwatch',
        title: 'Unwatch Player',
        description: 'Take a player off the watchlist by license.',
        scopes: ['players.note'],
        input: { ...licenseParamSchema.shape },
        annotations: write,
        request: ({ license }) => ({ method: 'DELETE', path: `/players/${enc(license)}/watch` }),
    },
    {
        name: 'tfadmin_players_set_tags',
        title: 'Set Player Tags',
        description: 'Replace all tags on a player by license (for example ["VIP", "Content Creator"]). Pass the current tags from tfadmin_players_get plus or minus the change.',
        scopes: ['players.note'],
        input: { ...licenseParamSchema.shape, ...tagsBodySchema.shape },
        annotations: write,
        request: ({ license, ...body }) => ({ method: 'PUT', path: `/players/${enc(license)}/tags`, body }),
    },

    //Bans, warnings and kicks
    {
        name: 'tfadmin_actions_search',
        title: 'Search Bans, Warnings and Kicks',
        description: `Search bans, warnings and kicks by identifiers (type ids), action id, reason or staff notes (type reason), or player name, filtered by kind, author, status, and hasNotes. ${paging}`,
        input: actionsQuerySchema.shape,
        annotations: readOnly,
        request: (query) => ({ method: 'GET', path: '/actions', query }),
    },
    {
        name: 'tfadmin_actions_stats',
        title: 'Ban, Warning and Kick Counts',
        description: 'Total bans, warnings and kicks, counts for the last 7 days, and counts per admin.',
        annotations: readOnly,
        request: () => ({ method: 'GET', path: '/actions/stats' }),
    },
    {
        name: 'tfadmin_actions_get',
        title: 'Read Ban, Warning or Kick',
        description: 'One ban, warning or kick by its action id (such as BABC-1234), with its staff notes.',
        input: actionIdParamSchema.shape,
        annotations: readOnly,
        request: ({ id }) => ({ method: 'GET', path: `/actions/${enc(id)}` }),
    },
    {
        name: 'tfadmin_actions_ban_identifiers',
        title: 'Ban Identifiers',
        description: `Ban a list of identifiers (license:, discord:, fivem:, ip:...) that may not belong to a known player. ${durationHelp}`,
        scopes: ['players.ban'],
        input: banIdsBodySchema.shape,
        annotations: destructive,
        request: (body) => ({ method: 'POST', path: '/actions/ban-identifiers', body }),
    },
    {
        name: 'tfadmin_actions_revoke',
        title: 'Revoke Ban or Warning',
        description: 'Revoke a ban (needs players.ban) or a warning (needs players.warn) by its action id, with an optional staff reason. Kicks cannot be revoked.',
        scopes: ['players.ban', 'players.warn'],
        input: { ...actionIdParamSchema.shape, ...revokeBodySchema.shape },
        annotations: destructive,
        request: ({ id, ...body }) => ({ method: 'POST', path: `/actions/${enc(id)}/revoke`, body }),
    },
    {
        name: 'tfadmin_actions_change_ban_length',
        title: 'Change Ban Length',
        description: `Change how long a ban lasts, with a required staff reason. The new length counts from when the ban was issued. ${durationHelp}`,
        scopes: ['players.ban'],
        input: { ...actionIdParamSchema.shape, ...banLengthBodySchema.shape },
        annotations: destructive,
        request: ({ id, ...body }) => ({ method: 'POST', path: `/actions/${enc(id)}/length`, body }),
    },
    {
        name: 'tfadmin_actions_set_appeal',
        title: 'Set Ban Appeal',
        description: 'Record where a ban\'s appeal stands: open, denied or accepted, with an optional ticket link or number. null clears it. Accepting does not lift the ban; revoke it or change its length.',
        scopes: ['players.ban'],
        input: { ...actionIdParamSchema.shape, ...banAppealBodySchema.shape },
        annotations: write,
        request: ({ id, ...body }) => ({ method: 'PUT', path: `/actions/${enc(id)}/appeal`, body }),
    },
    {
        name: 'tfadmin_actions_add_note',
        title: 'Add Action Note',
        description: 'Add a staff note to a ban, warning or kick by its action id. Notes are never shown to the player.',
        scopes: ['players.note', 'players.ban', 'players.warn', 'players.kick'],
        input: { ...actionIdParamSchema.shape, ...actionNoteBodySchema.shape },
        annotations: write,
        request: ({ id, ...body }) => ({ method: 'POST', path: `/actions/${enc(id)}/notes`, body }),
    },
    {
        name: 'tfadmin_actions_edit_note',
        title: 'Edit Action Note',
        description: 'Replace the text of a staff note on an action. Only the note\'s author can edit it.',
        scopes: ['players.note', 'players.ban', 'players.warn', 'players.kick'],
        input: { ...actionNoteParamSchema.shape, ...actionNoteBodySchema.shape },
        annotations: write,
        request: ({ id, noteId, ...body }) => ({ method: 'PATCH', path: `/actions/${enc(id)}/notes/${enc(noteId)}`, body }),
    },
    {
        name: 'tfadmin_actions_delete_note',
        title: 'Delete Action Note',
        description: 'Delete a staff note from an action. The note\'s author can delete it, and so can a key with manage.admins. The note is hidden, not erased.',
        scopes: ['players.note', 'players.ban', 'players.warn', 'players.kick'],
        input: actionNoteParamSchema.shape,
        annotations: destructive,
        request: ({ id, noteId }) => ({ method: 'DELETE', path: `/actions/${enc(id)}/notes/${enc(noteId)}` }),
    },

    //Whitelist
    {
        name: 'tfadmin_whitelist_approvals',
        title: 'List Whitelist Approvals',
        description: `Approved whitelist identifiers (license: or discord:), newest first, with an optional fuzzy search. ${paging}`,
        input: whitelistQuerySchema.shape,
        annotations: readOnly,
        request: (query) => ({ method: 'GET', path: '/whitelist/approvals', query }),
    },
    {
        name: 'tfadmin_whitelist_requests',
        title: 'List Whitelist Requests',
        description: `Pending whitelist join requests, most recent attempt first, with an optional fuzzy search. Approve one with tfadmin_whitelist_approve. ${paging}`,
        input: whitelistQuerySchema.shape,
        annotations: readOnly,
        request: (query) => ({ method: 'GET', path: '/whitelist/requests', query }),
    },
    {
        name: 'tfadmin_whitelist_approve',
        title: 'Approve Whitelist Request',
        description: 'Approve a pending whitelist request by its request id (such as R1234).',
        scopes: ['players.whitelist'],
        input: reqIdParamSchema.shape,
        annotations: write,
        request: ({ id }) => ({ method: 'POST', path: `/whitelist/requests/${enc(id)}/approve` }),
    },
    {
        name: 'tfadmin_whitelist_deny',
        title: 'Deny Whitelist Request',
        description: 'Deny (remove) a pending whitelist request by its request id.',
        scopes: ['players.whitelist'],
        input: reqIdParamSchema.shape,
        annotations: destructive,
        request: ({ id }) => ({ method: 'POST', path: `/whitelist/requests/${enc(id)}/deny` }),
    },
    {
        name: 'tfadmin_whitelist_deny_all',
        title: 'Deny All Whitelist Requests',
        description: 'Deny every pending whitelist request, or only those last attempted before `before` (epoch milliseconds).',
        scopes: ['players.whitelist'],
        input: denyAllBodySchema.shape,
        annotations: destructive,
        request: (body) => ({ method: 'POST', path: '/whitelist/requests/deny-all', body }),
    },
    {
        name: 'tfadmin_whitelist_add_approval',
        title: 'Pre-Approve Identifier',
        description: 'Pre-approve a license: or discord: identifier so that player can join without a request.',
        scopes: ['players.whitelist'],
        input: identifierBodySchema.shape,
        annotations: write,
        request: (body) => ({ method: 'POST', path: '/whitelist/approvals', body }),
    },
    {
        name: 'tfadmin_whitelist_remove_approval',
        title: 'Remove Whitelist Approval',
        description: 'Remove an approved whitelist identifier.',
        scopes: ['players.whitelist'],
        input: identifierBodySchema.shape,
        annotations: destructive,
        request: ({ identifier }) => ({ method: 'DELETE', path: `/whitelist/approvals/${enc(identifier)}` }),
    },

    //Server control and commands
    {
        name: 'tfadmin_server_announce',
        title: 'Announce',
        description: 'Show an announcement to every player in game.',
        scopes: ['announcement'],
        input: announceBodySchema.shape,
        annotations: write,
        request: (body) => ({ method: 'POST', path: '/server/announce', body }),
    },
    {
        name: 'tfadmin_server_kick_all',
        title: 'Kick All Players',
        description: 'Kick every connected player, with an optional reason.',
        scopes: ['control.server'],
        input: kickAllBodySchema.shape,
        annotations: destructive,
        request: (body) => ({ method: 'POST', path: '/server/kick-all', body }),
    },
    {
        name: 'tfadmin_server_command',
        title: 'Run Console Command',
        description: 'Run one FXServer console command. Returns once it is sent; it does not return the console output.',
        scopes: ['console.write'],
        input: commandBodySchema.shape,
        annotations: destructive,
        request: (body) => ({ method: 'POST', path: '/server/command', body }),
    },
    {
        name: 'tfadmin_server_control',
        title: 'Start, Stop, or Restart Server',
        description: 'Start, stop, or restart the game server (FXServer) that tfAdmin manages. Stop and restart disconnect every player.',
        scopes: ['control.server'],
        input: controlParamSchema.shape,
        annotations: destructive,
        request: ({ action }) => ({ method: 'POST', path: `/server/${enc(action)}` }),
    },
    {
        name: 'tfadmin_resources_refresh',
        title: 'Refresh Resources',
        description: 'Make FXServer rescan its resource folders (the refresh command).',
        scopes: ['commands.resources'],
        annotations: write,
        request: () => ({ method: 'POST', path: '/resources/refresh' }),
    },
    {
        name: 'tfadmin_resources_command',
        title: 'Start, Stop, or Restart Resource',
        description: 'Start, stop, restart, or ensure one resource by name.',
        scopes: ['commands.resources'],
        input: resourceParamSchema.shape,
        annotations: destructive,
        request: ({ name, command }) => ({ method: 'POST', path: `/resources/${enc(name)}/${enc(command)}` }),
    },

    //Events, admins, webhooks
    {
        name: 'tfadmin_events_list',
        title: 'Read Events',
        description: `Recent tfAdmin events (player joins and drops, bans, warnings, server state, whitelist changes...) after the cursor since. types is a comma list from tfadmin_events_types. Pass meta.cursor back as since to read only newer events.`,
        input: eventsQuerySchema.shape,
        annotations: readOnly,
        request: (query) => ({ method: 'GET', path: '/events', query }),
    },
    {
        name: 'tfadmin_events_types',
        title: 'Event Types',
        description: `Event type names for tfadmin_events_list: ${API_EVENT_TYPES.join(', ')}.`,
        annotations: readOnly,
        request: () => ({ method: 'GET', path: '/events/types' }),
    },
    {
        name: 'tfadmin_admins_list',
        title: 'List Admins',
        description: 'tfAdmin admins with their permissions and linked identifiers (no passwords or tokens).',
        scopes: ['manage.admins'],
        annotations: readOnly,
        request: () => ({ method: 'GET', path: '/admins' }),
    },
    {
        name: 'tfadmin_audit_log_search',
        title: 'Search the Admin Log',
        description: 'Who did what in tfAdmin (bans, kicks, console commands, resource restarts, logins, settings), newest page of up to 500 entries, oldest first. Filter by text, admin name, categories (comma-separated, such as ban,kick,command) and from/to (epoch milliseconds). Pass cursor back as to for older entries.',
        scopes: ['manage.admins'],
        input: adminLogQueryShape.shape,
        annotations: readOnly,
        request: (query) => ({ method: 'GET', path: '/audit-log', query }),
    },
    {
        name: 'tfadmin_staff_activity',
        title: 'Staff Activity',
        description: 'Each admin\'s bans, warns, kicks, revokes, notes and minutes in game per UTC week (Monday start), for the last `weeks` weeks (default 8, max 26).',
        scopes: ['manage.admins'],
        input: staffActivityQuerySchema.shape,
        annotations: readOnly,
        request: (query) => ({ method: 'GET', path: '/staff/activity', query }),
    },
    {
        name: 'tfadmin_webhooks_list',
        title: 'List Webhooks',
        description: 'Configured outgoing webhooks with their events and delivery health (secrets are never included).',
        scopes: ['manage.admins'],
        annotations: readOnly,
        request: () => ({ method: 'GET', path: '/webhooks' }),
    },
    {
        name: 'tfadmin_webhooks_deliveries',
        title: 'Webhook Deliveries',
        description: 'Recent delivery attempts for one webhook by id, with status codes and errors.',
        scopes: ['manage.admins'],
        input: webhookIdParamSchema.shape,
        annotations: readOnly,
        request: ({ id }) => ({ method: 'GET', path: `/webhooks/${enc(id)}/deliveries` }),
    },
];


const errorBodySchema = z.object({
    error: z.object({ code: z.string(), message: z.string(), details: z.unknown().optional() }),
});

/**
 * Replays one tool call against this server's own /api/v1 with the caller's credentials.
 */
async function callRoute(ctx: ApiKeyCtx, req: ToolRequest) {
    const local = ctx.req.socket;
    const host = (local.localAddress ?? '127.0.0.1').replace(/^::ffff:/, '');
    const origin = `http://${host.includes(':') ? `[${host}]` : host}:${local.localPort}`;
    const headers: Record<string, string> = { authorization: ctx.headers.authorization ?? '' };
    const actorId = ctx.headers[ACTOR_ID_HEADER];
    if (typeof actorId === 'string') headers[ACTOR_ID_HEADER] = actorId;
    const searchParams = Object.fromEntries(
        Object.entries(req.query ?? {})
            .filter(([, value]) => value !== undefined)
            .map(([key, value]) => [key, String(value)]),
    );

    const resp = await got(`${origin}/api/v1${req.path}`, {
        method: req.method,
        headers,
        searchParams,
        ...(req.body ? { json: req.body } : {}),
        throwHttpErrors: false,
        retry: { limit: 0 },
        timeout: { request: 60_000 },
    });
    let body: unknown = null;
    try {
        body = JSON.parse(resp.body);
    } catch { }

    if (resp.statusCode >= 400) {
        const failure = errorBodySchema.safeParse(body);
        const text = failure.success
            ? [
                `${failure.data.error.message} (${failure.data.error.code}, HTTP ${resp.statusCode})`,
                ...(failure.data.error.details !== undefined ? [JSON.stringify(failure.data.error.details)] : []),
            ].join('\n')
            : `tfAdmin answered HTTP ${resp.statusCode}.`;
        return { isError: true, content: [{ type: 'text' as const, text }] };
    }
    return { content: [{ type: 'text' as const, text: JSON.stringify(body, null, 2) }] };
}


const buildInstructions = (ctx: ApiKeyCtx) => [
    `tfAdmin is Everfall's fork of txAdmin, the panel that runs and moderates a FiveM game server.`,
    `This endpoint belongs to the tfAdmin of "${txConfig.general.serverName}" (${ctx.host}); every tool reads or changes that one server.`,
    `This key is "${ctx.apiKey.name}". Writes are logged as ${ctx.admin.name} and appear in the panel's action history.`,
    `Tools are limited to this key's scopes. Start with tfadmin_status. Identify players by license (40 hex characters) from tfadmin_players_search.`,
    `Bans, kicks, warnings, resource and server control affect real players: only use them when a person explicitly asks for that action.`,
    `Never use this to stop or restart the whole Main (production) server process; server control here only manages the game server child, and Main restarts are the owner's decision.`,
].join('\n');


/**
 * POST /api/v1/mcp - one stateless MCP exchange for the calling key
 */
export default async function ApiMcp(ctx: ApiKeyCtx) {
    const server = new McpServer(
        { name: 'tfadmin', version: txEnv.txaVersion },
        { instructions: buildInstructions(ctx) },
    );
    for (const tool of MCP_TOOLS) {
        if (tool.scopes && !tool.scopes.some((scope) => ctx.admin.hasPermission(scope))) continue;
        server.registerTool(
            tool.name,
            {
                title: tool.title,
                description: tool.description,
                annotations: { title: tool.title, ...tool.annotations },
                ...(tool.input ? { inputSchema: tool.input } : {}),
            },
            async (input: unknown) => callRoute(ctx, tool.request(input ?? {})),
        );
    }

    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    ctx.res.on('close', () => {
        transport.close().catch(() => { });
        server.close().catch(() => { });
    });
    await server.connect(transport);
    ctx.respond = false;
    await transport.handleRequest(ctx.req, ctx.res, ctx.request.body);
};
