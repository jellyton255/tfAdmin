-- Prevent running in monitor mode
if not TX_SERVER_MODE then return end


-- =============================================
--  Player join/leave reporting
--  Core's player list, player database and the
--  API's online counts are fed only by these events.
-- =============================================

local function logError(x)
    txPrint("^1" .. x)
end

AddEventHandler('playerJoining', function(srcString, _oldID)
    -- sanity checking source
    if source <= 0 then
        logError('playerJoining event with source ' .. json.encode(source))
        return
    end

    -- checking if the player was not already dropped
    local playerDetectedName = GetPlayerName(source)
    if type(playerDetectedName) ~= 'string' then
        logError('Received a playerJoining for a player that was already dropped. There is some resource dropping the player at the playerJoining event handler without first waiting for the next tick.')
        return
    end

    PrintStructuredTrace(json.encode({
        type = 'txAdminPlayerlistEvent',
        event = 'playerJoining',
        id = source,
        player = {
            name = string.sub(playerDetectedName, 1, 128),
            ids = GetPlayerIdentifiers(source),
            hwids = GetPlayerTokens(source),
        }
    }))
end)

AddEventHandler('playerDropped', function(reason, resource, category)
    -- sanity checking source
    if source <= 0 then
        logError('playerDropped event with source ' .. json.encode(source))
        return
    end

    if resource == 'monitor' and TX_IS_SERVER_SHUTTING_DOWN then
        reason = 'server_shutting_down'
    end

    PrintStructuredTrace(json.encode({
        type = 'txAdminPlayerlistEvent',
        event = 'playerDropped',
        id = source,
        reason = reason,
        resource = resource,
        category = category,
    }))
end)
