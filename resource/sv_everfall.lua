-- Prevent running in monitor mode
if not TX_SERVER_MODE then return end

-- =============================================
-- Everfall: the panel's Everfall actions (characters, players, inventories, banking, groups, world).
-- Core POSTs { txAdminToken, actor = { discordId, name }, operation, payload } to /monitor/everfall;
-- sv_main.lua routes it here. ef_administration owns every operation and checks the admin's
-- Everfall staff rank (exports.ef_administration:RunTfAdminRequest).
-- =============================================

local MAX_BODY_LENGTH = 65536

local function sendJson(res, status, data)
    res.writeHead(status, { ['Content-Type'] = 'application/json' })
    res.send(json.encode(data))
end

function TxHandleEverfallHttp(req, res)
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
        if GetResourceState('ef_administration') ~= 'started' then
            return sendJson(res, 503, { error = 'ef_administration is not started' })
        end

        exports.ef_administration:RunTfAdminRequest({
            actor = data.actor,
            operation = data.operation,
            payload = data.payload,
        }, function(result)
            sendJson(res, 200, result)
        end)
    end)
end
