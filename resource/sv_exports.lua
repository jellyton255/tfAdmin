-- Prevent running in monitor mode
if not TX_SERVER_MODE then return end

-- =============================================
-- Everfall: server exports so game scripts moderate through tfAdmin directly.
-- tfAdmin is the source of truth for bans and warns; scripts never keep their own ban tables.
--
--   exports.monitor:BanPlayer(source, reason, { duration = '7 days', author = 'Anti-Cheat' })
--   exports.monitor:WarnPlayer(source, reason, { author = 'System' })
--   exports.monitor:KickPlayer(source, reason, { author = 'System' })
--   exports.monitor:MessagePlayer(source, message, { author = 'System' })
--
-- Each export reads the player's identifiers immediately, sends them to core, and returns
-- true without waiting. It returns false and an error message for invalid input.
-- A ban defaults to permanent with the author 'Anti-Cheat'. BanPlayer drops the player before it
-- returns, so the calling script can stop at once, and ignores repeat calls for the same player.
-- =============================================

local MODERATION_URL = 'http://' .. TX_LUACOMHOST .. '/intercom/moderation'
local DEFAULT_BAN_AUTHOR = 'Anti-Cheat'
local DEFAULT_AUTHOR = 'System'
local BAN_DROP_MESSAGE = '[txAdmin] You have been banned for cheating. If you believe this is an error, make a ticket.'
local banning = {}

AddEventHandler('playerDropped', function()
    banning[tostring(source)] = nil
end)

---@param source any
---@return table? target
---@return string? error
local function readTarget(source)
    local netid = tonumber(source)
    if not netid or netid <= 0 or not DoesPlayerExist(tostring(netid)) then
        return nil, ('player %s is not connected'):format(tostring(source))
    end

    local playerId = tostring(netid)
    return {
        netid = netid,
        name = GetPlayerName(playerId) or ('#' .. playerId),
        ids = GetPlayerIdentifiers(playerId) or {},
        hwids = GetPlayerTokens(playerId) or {},
    }
end

---@param value any
---@param fallback string
---@return string
local function readAuthor(value, fallback)
    if type(value) == 'string' and value:match('%S') then return value end
    return fallback
end

---@param payload table
---@param onFailure? fun(message: string)
local function send(payload, onFailure)
    payload.txAdminToken = TX_LUACOMTOKEN
    PerformHttpRequest(MODERATION_URL, function(httpCode, rawData)
        local response = httpCode == 200 and rawData and json.decode(rawData)
        if type(response) == 'table' and response.success == true then return end

        local message = type(response) == 'table' and response.error
            or ('HTTP %s: %s'):format(tostring(httpCode), tostring(rawData))
        txPrintError(('[exports] %s from %s failed: %s'):format(payload.action, payload.resource, message))
        if onFailure then onFailure(message) end
    end, 'POST', json.encode(payload), { ['Content-Type'] = 'application/json' })
end

---@param action string
---@param source any
---@param text any
---@param options table?
---@param defaultAuthor string
---@return table? payload
---@return string? error
local function buildPayload(action, source, text, options, defaultAuthor)
    if type(text) ~= 'string' or not text:match('%S') then
        return nil, ('%s needs a non-empty reason'):format(action)
    end
    if options ~= nil and type(options) ~= 'table' then
        return nil, ('%s options must be a table'):format(action)
    end

    local target, targetError = readTarget(source)
    if not target then return nil, targetError end

    options = options or {}
    return {
        action = action,
        resource = GetInvokingResource() or 'monitor',
        author = readAuthor(options.author, defaultAuthor),
        target = target,
    }
end

local function BanPlayer(source, reason, options)
    local payload, err = buildPayload('ban', source, reason, options, DEFAULT_BAN_AUTHOR)
    if not payload then return false, err end

    local playerId = tostring(payload.target.netid)
    if banning[playerId] then return false, 'player is already being banned' end
    banning[playerId] = true

    payload.reason = reason
    payload.duration = options and type(options.duration) == 'string' and options.duration or 'permanent'
    DropPlayer(playerId, BAN_DROP_MESSAGE)
    send(payload)
    return true
end

local function WarnPlayer(source, reason, options)
    local payload, err = buildPayload('warn', source, reason, options, DEFAULT_AUTHOR)
    if not payload then return false, err end

    payload.reason = reason
    send(payload)
    return true
end

local function KickPlayer(source, reason, options)
    local payload, err = buildPayload('kick', source, reason, options, DEFAULT_AUTHOR)
    if not payload then return false, err end

    payload.reason = reason
    local netid = payload.target.netid
    send(payload, function()
        if DoesPlayerExist(tostring(netid)) then
            DropPlayer(tostring(netid), '[txAdmin] You have been kicked: ' .. reason)
        end
    end)
    return true
end

local function MessagePlayer(source, message, options)
    local payload, err = buildPayload('message', source, message, options, DEFAULT_AUTHOR)
    if not payload then return false, err end

    payload.message = message
    send(payload)
    return true
end

exports('BanPlayer', BanPlayer)
exports('WarnPlayer', WarnPlayer)
exports('KickPlayer', KickPlayer)
exports('MessagePlayer', MessagePlayer)
