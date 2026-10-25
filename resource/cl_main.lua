-- =============================================
--  Debug mode
-- =============================================
RegisterNetEvent('txcl:setDebugMode', function(enabled)
    TX_DEBUG_MODE = enabled
end)


-- =============================================
--  Warn handling
-- =============================================
-- ef_hud draws warnings from txcl:showWarning and acknowledges them with txsv:ackWarning.

--- Awaits the player to start walking before issuing the warning
--- to prevent players from being warned during character selection.
--- Unlike the warn dismissal, stopping does not reset the counter.
--- NOTE: Doing walk detection this way because IsPedRunning isn't reliable,
--- and IsPedStopped is true even while teleporting.
CreateThread(function()
    local minimumMoveCycles = 20 -- around 5 seconds of walking
    local moveCycles = 0
    local hasPedStartedWalking = false
    while true do
        Wait(250)
        local ped = PlayerPedId()
        if type(ped) == 'number' and ped > 0 then
            if hasPedStartedWalking then
                if not IsPedStopped(ped) then
                    moveCycles = moveCycles + 1
                    if moveCycles >= minimumMoveCycles then
                        TriggerServerEvent('txsv:startedWalking')
                        debugPrint('Player started walking.')
                        return
                    end
                end
            elseif IsPedWalking(ped) or IsPedRunning(ped) then
                hasPedStartedWalking = true
            end
        end
    end
end)

-- =============================================
--  Other stuff
-- =============================================
-- Removing unwanted chat suggestions
-- The suggestion is added after 500ms, so we need to wait more
CreateThread(function()
    Wait(1000)
    local suggestionsToRemove = {
        --Commands
        '/txaPing',
        '/txaEvent',
        '/txaReportResources',
        '/txaSetDebugMode',
        '/txaInitialData',

        --Convars
        '/txAdmin-version',
        '/txAdmin-locale',
        '/txAdmin-localeFile',
        '/txAdmin-verbose',
        '/txAdmin-luaComHost',
        '/txAdmin-luaComToken',
        '/txAdmin-checkPlayerJoin',
        '/txAdmin-pipeToken',
        '/txAdmin-debugMode',
        '/txAdmin-hideAdminInPunishments',
        '/txAdmin-hideAdminInMessages',
        '/txAdmin-serverName',
        '/txAdminServerMode',
    }

    for _, suggestion in ipairs(suggestionsToRemove) do
        TriggerEvent('chat:removeSuggestion', suggestion)
    end
end)
