-- Prevent running in monitor mode
if not TX_SERVER_MODE then return end

-- =============================================
-- Everfall: QBox character lookup for the player modal and quick search.
-- Core POSTs { txAdminToken } plus licenses, citizenIds or search to /monitor/characters;
-- a search also returns the vehicles whose plate, VIN, model or nickname contains it;
-- sv_main.lua routes it here.
-- Read-only: one SELECT through oxmysql, so it also works for offline players.
-- =============================================

local MAX_BODY_LENGTH = 4096
local MAX_KEYS = 16
local LICENSE_PATTERN = '^license2?:%x+$'
local CITIZEN_ID_PATTERN = '^%w+$'
-- quick search text: a citizen ID or character name fragment, never a LIKE wildcard
local SEARCH_PATTERN = "^%w[%w '%-]+$"
local MAX_SEARCH_LENGTH = 64
local ROW_LIMIT = 50
local FULL_NAME_SQL = "COALESCE(NULLIF(p.fullName, ''), TRIM(CONCAT_WS(' ', p.firstName, p.lastName)))"

local CHARACTERS_QUERY = [[
    SELECT
        p.citizenid AS citizenId,
        p.cid AS slot,
        ]] .. FULL_NAME_SQL .. [[ AS fullName,
        p.firstName AS firstName,
        p.lastName AS lastName,
        DATE_FORMAT(p.dateOfBirth, '%%Y-%%m-%%d') AS dateOfBirth,
        p.gender + 0 AS gender,
        JSON_VALUE(p.job, '$.name') AS jobName,
        JSON_VALUE(p.job, '$.label') AS jobLabel,
        JSON_VALUE(p.job, '$.grade.name') AS jobGrade,
        JSON_VALUE(p.gang, '$.name') AS gangName,
        JSON_VALUE(p.gang, '$.label') AS gangLabel,
        JSON_VALUE(p.gang, '$.grade.name') AS gangGrade,
        JSON_VALUE(p.money, '$.cash') + 0 AS cash,
        JSON_VALUE(p.money, '$.bank') + 0 AS bank,
        UNIX_TIMESTAMP(p.last_updated) AS tsLastUpdated,
        UNIX_TIMESTAMP(p.last_logged_out) AS tsLastLoggedOut,
        (SELECT COUNT(*) FROM player_vehicles v WHERE v.citizenid = p.citizenid) AS vehicleCount,
        u.license AS license,
        u.license2 AS license2
    FROM players p
    JOIN users u ON u.userId = p.userId
    WHERE %s
        AND p.deleted IS NULL
    ORDER BY %sp.last_updated DESC
    LIMIT ]] .. ROW_LIMIT

-- Vehicles for quick search, with the owning character's licenses so core can find the player
local VEHICLES_SEARCH_QUERY = [[
    SELECT
        v.plate AS plate,
        v.fakeplate AS fakePlate,
        v.vin AS vin,
        v.vehicle AS model,
        v.nickname AS nickname,
        v.citizenid AS citizenId,
        ]] .. FULL_NAME_SQL .. [[ AS ownerName,
        u.license AS license,
        u.license2 AS license2
    FROM player_vehicles v
    LEFT JOIN players p ON p.citizenid = v.citizenid AND p.deleted IS NULL
    LEFT JOIN users u ON u.userId = p.userId
    WHERE v.plate LIKE ? OR v.fakeplate LIKE ? OR v.vin LIKE ? OR v.vehicle LIKE ? OR v.nickname LIKE ?
    ORDER BY v.plate LIKE ? DESC, v.plate
    LIMIT ]] .. ROW_LIMIT

-- ef_scoreboard's JobConfig colors, the same ones ef_administration shows: a Mantine color
-- name such as 'teal.7' or a hex code. Read once; the config file is a plain returned table.
local jobColors

local function loadJobColors()
    local source = LoadResourceFile('ef_scoreboard', 'config.lua')
    local chunk = source and load(source, '@ef_scoreboard/config.lua', 't', {})
    local config = chunk and chunk()
    jobColors = { default = config and config.DefaultColor or nil }
    for name, job in pairs(config and config.JobConfig or {}) do
        if type(job.Color) == 'string' then jobColors[name] = job.Color end
    end
end

local function jobColor(name)
    if not jobColors then loadJobColors() end
    return jobColors[name] or jobColors.default
end

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

-- Returns the WHERE clause, the ORDER BY prefix, their parameters and the search text when it is
-- a search, or nil for an invalid request
local function readFilter(body)
    local data = json.decode(body)
    if type(data) ~= 'table' or data.txAdminToken ~= TX_LUACOMTOKEN then return nil end

    local search = data.search
    if type(search) == 'string' and #search <= MAX_SEARCH_LENGTH and search:match(SEARCH_PATTERN) then
        -- citizen IDs are upper case; a citizen ID that starts with the text ranks first
        local upper = search:upper()
        local where = ('(p.citizenid LIKE ? OR %s LIKE ?)'):format(FULL_NAME_SQL)
        return where, 'p.citizenid LIKE ? DESC, ', { '%' .. upper .. '%', '%' .. search .. '%', upper .. '%' }, search
    end

    local citizenIds = data.citizenIds and readKeys(data.citizenIds, CITIZEN_ID_PATTERN)
    if citizenIds then
        local marks = ('?,'):rep(#citizenIds):sub(1, -2)
        return ('p.citizenid IN (%s)'):format(marks), '', citizenIds
    end

    local licenses = readKeys(data.licenses, LICENSE_PATTERN)
    if not licenses then return nil end
    local marks = ('?,'):rep(#licenses):sub(1, -2)
    local params = {}
    for index, license in ipairs(licenses) do
        params[index] = license
        params[#licenses + index] = license
    end
    return ('(u.license IN (%s) OR u.license2 IN (%s))'):format(marks, marks), '', params
end

local function searchVehicles(res, search, characters)
    local contains = '%' .. search .. '%'
    local params = { contains, contains, contains, contains, contains, search .. '%' }
    exports.oxmysql:query(VEHICLES_SEARCH_QUERY, params, function(rows, err)
        if err then
            txPrint('^1Vehicle search failed: ' .. tostring(err))
            return sendJson(res, 500, { error = 'vehicle query failed' })
        end
        sendJson(res, 200, { characters = characters, vehicles = rows })
    end, GetCurrentResourceName(), true)
end

local function queryCharacters(res, where, order, params, search)
    if GetResourceState('oxmysql') ~= 'started' then
        return sendJson(res, 503, { error = 'oxmysql is not started' })
    end

    exports.oxmysql:query(CHARACTERS_QUERY:format(where, order), params, function(rows, err)
        if err then
            txPrint('^1Character lookup failed: ' .. tostring(err))
            return sendJson(res, 500, { error = 'character query failed' })
        end

        for _, row in ipairs(rows) do
            row.jobColor = row.jobName and jobColor(row.jobName) or nil
            row.online = GetResourceState('qbx_core') == 'started'
                and exports.qbx_core:GetPlayerByCitizenId(row.citizenId) ~= nil
        end

        if search then return searchVehicles(res, search, rows) end
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

        local where, order, params, search = readFilter(body)
        if not where then
            return sendJson(res, 401, { error = 'invalid request' })
        end

        queryCharacters(res, where, order, params, search)
    end)
end

-- =============================================
-- Everfall: one character's vehicles and inventory for the player modal's Characters tab.
-- Core POSTs { txAdminToken, citizenId } to /monitor/characters/detail. Read-only.
-- =============================================

local DETAIL_ROW_LIMIT = 200
local VEHICLES_QUERY = [[
    SELECT plate, vehicle AS model, garage, state, mileage
    FROM player_vehicles
    WHERE citizenid = ?
    ORDER BY plate
    LIMIT ]] .. DETAIL_ROW_LIMIT
local INVENTORY_QUERY = 'SELECT inventory FROM players WHERE citizenid = ? AND deleted IS NULL LIMIT 1'

local function itemLabel(name)
    if GetResourceState('ox_inventory') ~= 'started' then return nil end
    local item = exports.ox_inventory:Items(name)
    return item and item.label or nil
end

-- players.inventory holds ox_inventory's saved slots; online players save on logout and autosave
local function readInventory(raw)
    local slots = raw and json.decode(raw)
    if type(slots) ~= 'table' then return {} end
    local items = {}
    for _, slot in pairs(slots) do
        if type(slot) == 'table' and type(slot.name) == 'string' then
            items[#items + 1] = {
                slot = tonumber(slot.slot),
                name = slot.name,
                label = itemLabel(slot.name),
                count = tonumber(slot.count) or 1,
            }
        end
    end
    table.sort(items, function(a, b) return (a.slot or 0) < (b.slot or 0) end)
    return items
end

function TxHandleCharacterDetailHttp(req, res)
    if req.method ~= 'POST' then
        return sendJson(res, 405, { error = 'method not allowed' })
    end

    req.setDataHandler(function(body)
        if type(body) ~= 'string' or #body > MAX_BODY_LENGTH then
            return sendJson(res, 400, { error = 'invalid request' })
        end
        local data = json.decode(body)
        if type(data) ~= 'table' or data.txAdminToken ~= TX_LUACOMTOKEN
            or type(data.citizenId) ~= 'string' or not data.citizenId:match(CITIZEN_ID_PATTERN) then
            return sendJson(res, 401, { error = 'invalid request' })
        end
        if GetResourceState('oxmysql') ~= 'started' then
            return sendJson(res, 503, { error = 'oxmysql is not started' })
        end

        exports.oxmysql:query(INVENTORY_QUERY, { data.citizenId }, function(players, playerErr)
            if playerErr then
                txPrint('^1Character detail lookup failed: ' .. tostring(playerErr))
                return sendJson(res, 500, { error = 'character query failed' })
            end
            if not players[1] then
                return sendJson(res, 404, { error = 'character not found' })
            end
            exports.oxmysql:query(VEHICLES_QUERY, { data.citizenId }, function(vehicles, vehicleErr)
                if vehicleErr then
                    txPrint('^1Character vehicle lookup failed: ' .. tostring(vehicleErr))
                    return sendJson(res, 500, { error = 'vehicle query failed' })
                end
                sendJson(res, 200, {
                    inventory = readInventory(players[1].inventory),
                    vehicles = vehicles,
                })
            end, GetCurrentResourceName(), true)
        end, GetCurrentResourceName(), true)
    end)
end
