-- Prevent running in monitor mode
if not TX_SERVER_MODE then return end

-- =============================================
-- Everfall: server exports so game scripts moderate through tfAdmin directly.
-- tfAdmin is the source of truth for bans and warns; scripts never keep their own ban tables.
--
--   exports.monitor:BanPlayer(source, reason, { duration = '7 days', author = 'Anti-Cheat', note = 'evidence', onDone = fn })
--   exports.monitor:WarnPlayer(source, reason, { author = 'System', note = 'evidence', onDone = fn })
--   exports.monitor:KickPlayer(source, reason, { author = 'System', note = 'evidence', onDone = fn })
--   exports.monitor:MessagePlayer(source, message, { author = 'System' })
--   exports.monitor:AddActionNote(actionId, text, author)
--
-- Each export reads the player's identifiers immediately, sends them to core, and returns
-- true without waiting. It returns false and an error message for invalid input.
-- `note` is a staff note saved on the ban, warn or kick; the player never sees it.
-- `onDone(actionId)` runs once tfAdmin saved the action, so a script can add notes to it later.
-- A kick of a player with no valid identifiers is not recorded, so onDone gets nil.
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
---@param onDone? function|table
local function send(payload, onFailure, onDone)
    payload.txAdminToken = TX_LUACOMTOKEN
    PerformHttpRequest(MODERATION_URL, function(httpCode, rawData)
        local response = httpCode == 200 and rawData and json.decode(rawData)
        if type(response) == 'table' and response.success == true then
            if onDone then onDone(response.actionId) end
            return
        end

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
---@return function|table|nil onDone
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
    if options.note ~= nil and type(options.note) ~= 'string' then
        return nil, ('%s options.note must be a string'):format(action)
    end
    -- functions from another resource arrive as callable function references (tables)
    if options.onDone ~= nil and type(options.onDone) ~= 'function' and type(options.onDone) ~= 'table' then
        return nil, ('%s options.onDone must be a function'):format(action)
    end
    return {
        action = action,
        resource = GetInvokingResource() or 'monitor',
        author = readAuthor(options.author, defaultAuthor),
        note = options.note,
        target = target,
    }, nil, options.onDone
end

local function BanPlayer(source, reason, options)
    local payload, err, onDone = buildPayload('ban', source, reason, options, DEFAULT_BAN_AUTHOR)
    if not payload then return false, err end

    local playerId = tostring(payload.target.netid)
    if banning[playerId] then return false, 'player is already being banned' end
    banning[playerId] = true

    payload.reason = reason
    payload.duration = options and type(options.duration) == 'string' and options.duration or 'permanent'
    DropPlayer(playerId, BAN_DROP_MESSAGE)
    send(payload, nil, onDone)
    return true
end

local function WarnPlayer(source, reason, options)
    local payload, err, onDone = buildPayload('warn', source, reason, options, DEFAULT_AUTHOR)
    if not payload then return false, err end

    payload.reason = reason
    send(payload, nil, onDone)
    return true
end

local function KickPlayer(source, reason, options)
    local payload, err, onDone = buildPayload('kick', source, reason, options, DEFAULT_AUTHOR)
    if not payload then return false, err end

    payload.reason = reason
    local netid = payload.target.netid
    send(payload, function()
        if DoesPlayerExist(tostring(netid)) then
            DropPlayer(tostring(netid), '[txAdmin] You have been kicked: ' .. reason)
        end
    end, onDone)
    return true
end

local function MessagePlayer(source, message, options)
    local payload, err = buildPayload('message', source, message, options, DEFAULT_AUTHOR)
    if not payload then return false, err end

    payload.message = message
    send(payload)
    return true
end

---@param actionId any
---@param text any
---@param author any
local function AddActionNote(actionId, text, author)
    if type(actionId) ~= 'string' or not actionId:match('%S') then
        return false, 'AddActionNote needs an action id'
    end
    if type(text) ~= 'string' or not text:match('%S') then
        return false, 'AddActionNote needs a non-empty note'
    end

    send({
        action = 'note',
        resource = GetInvokingResource() or 'monitor',
        author = readAuthor(author, DEFAULT_AUTHOR),
        actionId = actionId,
        text = text,
    })
    return true
end

exports('BanPlayer', BanPlayer)
exports('WarnPlayer', WarnPlayer)
exports('KickPlayer', KickPlayer)
exports('MessagePlayer', MessagePlayer)
exports('AddActionNote', AddActionNote)
