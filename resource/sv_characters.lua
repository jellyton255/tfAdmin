-- Prevent running in monitor mode
if not TX_SERVER_MODE then return end

-- =============================================
-- Everfall: QBox character lookup for the player modal and quick search.
-- Core POSTs { txAdminToken, licenses } or { txAdminToken, citizenIds } to /monitor/characters;
-- sv_main.lua routes it here.
-- Read-only: one SELECT through oxmysql, so it also works for offline players.
-- =============================================

local MAX_BODY_LENGTH = 4096
local MAX_KEYS = 16
local LICENSE_PATTERN = '^license2?:%x+$'
local CITIZEN_ID_PATTERN = '^%w+$'

local CHARACTERS_QUERY = [[
    SELECT
        p.citizenid AS citizenId,
        p.cid AS slot,
        COALESCE(NULLIF(p.fullName, ''), TRIM(CONCAT_WS(' ', p.firstName, p.lastName))) AS fullName,
        JSON_VALUE(p.job, '$.label') AS jobLabel,
        JSON_VALUE(p.job, '$.grade.name') AS jobGrade,
        JSON_VALUE(p.gang, '$.name') AS gangName,
        JSON_VALUE(p.gang, '$.label') AS gangLabel,
        JSON_VALUE(p.gang, '$.grade.name') AS gangGrade,
        JSON_VALUE(p.money, '$.cash') + 0 AS cash,
        JSON_VALUE(p.money, '$.bank') + 0 AS bank,
        UNIX_TIMESTAMP(p.last_updated) AS tsLastUpdated,
        UNIX_TIMESTAMP(p.last_logged_out) AS tsLastLoggedOut,
        u.license AS license,
        u.license2 AS license2
    FROM players p
    JOIN users u ON u.userId = p.userId
    WHERE %s
        AND p.deleted IS NULL
    ORDER BY p.last_updated DESC
]]

local function sendJson(res, status, data)
    res.writeHead(status, { ['Content-Type'] = 'application/json' })
    res.send(json.encode(data))
end

local function readKeys(list, pattern)
    if type(list) ~= 'table' or #list < 1 or #list > MAX_KEYS then return nil end
    for _, key in ipairs(list) do
        if type(key) ~= 'string' or not key:match(pattern) then return nil end
    end
    return list
end

-- Returns the WHERE clause and its parameters, or nil for an invalid request
local function readFilter(body)
    local data = json.decode(body)
    if type(data) ~= 'table' or data.txAdminToken ~= TX_LUACOMTOKEN then return nil end

    local citizenIds = data.citizenIds and readKeys(data.citizenIds, CITIZEN_ID_PATTERN)
    if citizenIds then
        local marks = ('?,'):rep(#citizenIds):sub(1, -2)
        return ('p.citizenid IN (%s)'):format(marks), citizenIds
    end

    local licenses = readKeys(data.licenses, LICENSE_PATTERN)
    if not licenses then return nil end
    local marks = ('?,'):rep(#licenses):sub(1, -2)
    local params = {}
    for index, license in ipairs(licenses) do
        params[index] = license
        params[#licenses + index] = license
    end
    return ('(u.license IN (%s) OR u.license2 IN (%s))'):format(marks, marks), params
end

local function queryCharacters(res, where, params)
    if GetResourceState('oxmysql') ~= 'started' then
        return sendJson(res, 503, { error = 'oxmysql is not started' })
    end

    exports.oxmysql:query(CHARACTERS_QUERY:format(where), params, function(rows, err)
        if err then
            txPrint('^1Character lookup failed: ' .. tostring(err))
            return sendJson(res, 500, { error = 'character query failed' })
        end

        for _, row in ipairs(rows) do
            row.online = GetResourceState('qbx_core') == 'started'
                and exports.qbx_core:GetPlayerByCitizenId(row.citizenId) ~= nil
        end

        sendJson(res, 200, { characters = rows })
    end, GetCurrentResourceName(), true)
end

function TxHandleCharactersHttp(req, res)
    if req.method ~= 'POST' then
        return sendJson(res, 405, { error = 'method not allowed' })
    end

    req.setDataHandler(function(body)
        if type(body) ~= 'string' or #body > MAX_BODY_LENGTH then
            return sendJson(res, 400, { error = 'invalid request' })
        end

        local where, params = readFilter(body)
        if not where then
            return sendJson(res, 401, { error = 'invalid request' })
        end

        queryCharacters(res, where, params)
    end)
end
