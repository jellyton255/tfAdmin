-- Prevent running in monitor mode
if not TX_SERVER_MODE then return end

-- =============================================
-- Everfall: QBox character lookup for the player modal.
-- Core POSTs { txAdminToken, licenses } to /monitor/characters; sv_main.lua routes it here.
-- Read-only: one SELECT through oxmysql, so it also works for offline players.
-- =============================================

local MAX_BODY_LENGTH = 4096
local MAX_LICENSES = 16
local LICENSE_PATTERN = '^license2?:%x+$'

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
        UNIX_TIMESTAMP(p.last_logged_out) AS tsLastLoggedOut
    FROM players p
    JOIN users u ON u.userId = p.userId
    WHERE (u.license IN (%s) OR u.license2 IN (%s))
        AND p.deleted IS NULL
    ORDER BY p.last_updated DESC
]]

local function sendJson(res, status, data)
    res.writeHead(status, { ['Content-Type'] = 'application/json' })
    res.send(json.encode(data))
end

local function readLicenses(body)
    local data = json.decode(body)
    if type(data) ~= 'table' or data.txAdminToken ~= TX_LUACOMTOKEN then return nil end
    if type(data.licenses) ~= 'table' or #data.licenses < 1 or #data.licenses > MAX_LICENSES then return nil end

    for _, license in ipairs(data.licenses) do
        if type(license) ~= 'string' or not license:match(LICENSE_PATTERN) then return nil end
    end

    return data.licenses
end

local function queryCharacters(res, licenses)
    if GetResourceState('oxmysql') ~= 'started' then
        return sendJson(res, 503, { error = 'oxmysql is not started' })
    end

    local marks = ('?,'):rep(#licenses):sub(1, -2)
    local params = {}
    for index, license in ipairs(licenses) do
        params[index] = license
        params[#licenses + index] = license
    end

    exports.oxmysql:query(CHARACTERS_QUERY:format(marks, marks), params, function(rows, err)
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

        local licenses = readLicenses(body)
        if not licenses then
            return sendJson(res, 401, { error = 'invalid request' })
        end

        queryCharacters(res, licenses)
    end)
end
