-- Prevent running in monitor mode
if not TX_SERVER_MODE then return end

-- =============================================
-- Everfall: service signals for the panel's Services block.
-- Core POSTs { txAdminToken } to /monitor/services/<name>; sv_main.lua routes it here.
-- Read-only: each route copies one resource's own status export and adds the server clock.
-- =============================================

local MAX_BODY_LENGTH = 512

local function sendJson(res, status, data)
    res.writeHead(status, { ['Content-Type'] = 'application/json' })
    res.send(json.encode(data))
end

local services = {
    database = {
        resource = 'ef_lib',
        read = function()
            local health = exports.ef_lib:GetDatabaseHealth()
            if type(health) ~= 'table' then return nil, 'no database check has completed yet' end
            return health
        end,
    },
    logDelivery = {
        resource = 'ef_logs',
        read = function()
            local status = exports.ef_logs:GetDeliveryStatus()
            if type(status) ~= 'table' then return nil, 'delivery status is unavailable' end
            return {
                pendingBatches = status.pendingBatches,
                oldestPendingSeconds = status.oldestPendingSeconds,
                lastSuccessAt = status.lastSuccessAt,
                failureSince = status.failureSince,
            }
        end,
    },
    playerSaves = {
        resource = 'qbx_core',
        read = function()
            local health = exports.qbx_core:GetPlayerSaveHealth()
            if type(health) ~= 'table' then return nil, 'save health is unavailable' end
            if type(health.severity) ~= 'string' then return nil, 'qbx_core has not loaded its save diagnosis yet' end
            return { severity = health.severity, headline = health.headline }
        end,
    },
}

local function readService(res, service)
    if GetResourceState(service.resource) ~= 'started' then
        return sendJson(res, 503, { error = service.resource .. ' is not started' })
    end

    -- Catch export errors: a source resource that predates its export must read as unavailable.
    local success, data, reason = pcall(service.read)
    if not success then
        return sendJson(res, 503, { error = service.resource .. ' did not answer its status export' })
    end
    if not data then
        return sendJson(res, 503, { error = reason })
    end

    sendJson(res, 200, { now = os.time(), data = data })
end

function TxHandleServicesHttp(req, res)
    local service = services[req.path:match('^/services/(%a+)$') or '']
    if not service then
        return sendJson(res, 404, { error = 'route not found' })
    end
    if req.method ~= 'POST' then
        return sendJson(res, 405, { error = 'method not allowed' })
    end

    req.setDataHandler(function(body)
        if type(body) ~= 'string' or #body > MAX_BODY_LENGTH then
            return sendJson(res, 400, { error = 'invalid request' })
        end

        local data = json.decode(body)
        if type(data) ~= 'table' or data.txAdminToken ~= TX_LUACOMTOKEN then
            return sendJson(res, 401, { error = 'invalid request' })
        end

        readService(res, service)
    end)
end
