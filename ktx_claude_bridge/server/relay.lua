local TIMEOUT <const> = Config.clientExecTimeout
local nextId = 0

---@class PendingCallback
---@field resolve fun(result: table)
---@field source integer

--- Pending callbacks keyed by request ID.
---@type table<string, PendingCallback>
PendingCallbacks = {}

--- Generate a unique request ID.
---@return string
local function generateId()
    nextId = nextId + 1
    return ('cb_%d_%d'):format(os.time(), nextId)
end

--- Execute code on a connected client.
---@param playerId integer
---@param code string
---@param resolve fun(result: table)
function ExecOnClient(playerId, code, resolve)
    local id = generateId()

    PendingCallbacks[id] = { resolve = resolve, source = playerId }

    TriggerClientEvent('ktx_cb:exec', playerId, id, code)

    -- Timeout
    SetTimeout(TIMEOUT, function()
        local pending = PendingCallbacks[id]
        if pending then
            PendingCallbacks[id] = nil
            pending.resolve({
                success = false,
                error = ('Client exec timed out after %dms (player %d)'):format(TIMEOUT, playerId),
            })
        end
    end)
end

--- Take a screenshot via screencapture server export.
---@param playerId integer
---@param resolve fun(result: table)
function TakeScreenshot(playerId, resolve)
    if GetResourceState('screencapture') ~= 'started' then
        resolve({ success = false, error = 'screencapture resource is not running. Install from: https://github.com/itschip/screencapture' })
        return
    end

    local id = generateId()
    PendingCallbacks[id] = { resolve = resolve, source = playerId }

    -- Use server-side export — no client relay needed
    exports.screencapture:serverCapture(playerId, { encoding = 'webp' }, function(data)
        local pending = PendingCallbacks[id]
        if pending then
            PendingCallbacks[id] = nil
            pending.resolve({ success = true, data = data, encoding = 'webp' })
        end
    end, 'base64')

    -- Timeout
    SetTimeout(TIMEOUT * 2, function()
        local pending = PendingCallbacks[id]
        if pending then
            PendingCallbacks[id] = nil
            pending.resolve({ success = false, error = 'Screenshot timed out' })
        end
    end)
end

-- Receive client exec result
RegisterNetEvent('ktx_cb:execResult')
AddEventHandler('ktx_cb:execResult', function(requestId, result, err)
    local pending = PendingCallbacks[requestId]
    if not pending then return end

    -- Validate source matches the player we sent the request to
    if pending.source ~= source then return end

    PendingCallbacks[requestId] = nil

    if err then
        pending.resolve({ success = false, error = err })
    else
        pending.resolve({ success = true, result = result })
    end
end)

-- Receive client console lines
RegisterNetEvent('ktx_cb:clientConsole')
AddEventHandler('ktx_cb:clientConsole', function(entries)
    local src = source
    if type(entries) == 'table' then
        AddClientConsole(src, entries)
    end
end)

--- Execute code inside another resource's Lua VM (server-side).
--- Requires the target resource to have: shared_script '@ktx_claude_bridge/exec_bridge.lua'
---@param resource string
---@param code string
---@param resolve fun(result: table)
function ExecScoped(resource, code, resolve)
    local id = generateId()
    PendingCallbacks[id] = { resolve = resolve, source = 0 }

    TriggerEvent('ktx_cb:execScoped', id, resource, code)

    SetTimeout(TIMEOUT, function()
        local pending = PendingCallbacks[id]
        if pending then
            PendingCallbacks[id] = nil
            pending.resolve({
                success = false,
                error = ('Scoped exec timed out after %dms — does %s have shared_script \'@ktx_claude_bridge/exec_bridge.lua\' in its fxmanifest?'):format(TIMEOUT, resource),
            })
        end
    end)
end

--- Execute code inside another resource's client-side Lua VM.
--- Requires the target resource to have: shared_script '@ktx_claude_bridge/exec_bridge.lua'
---@param playerId integer
---@param resource string
---@param code string
---@param resolve fun(result: table)
function ExecScopedClient(playerId, resource, code, resolve)
    local id = generateId()
    PendingCallbacks[id] = { resolve = resolve, source = playerId }

    TriggerClientEvent('ktx_cb:execScoped', playerId, id, resource, code)

    SetTimeout(TIMEOUT, function()
        local pending = PendingCallbacks[id]
        if pending then
            PendingCallbacks[id] = nil
            pending.resolve({
                success = false,
                error = ('Scoped client exec timed out after %dms — does %s have shared_script \'@ktx_claude_bridge/exec_bridge.lua\' in its fxmanifest?'):format(TIMEOUT, resource),
            })
        end
    end)
end

-- Receive scoped exec results (server-side, local event only — NOT network-reachable)
AddEventHandler('ktx_cb:execScopedResult', function(result)
    if not result or not result.requestId then return end
    local pending = PendingCallbacks[result.requestId]
    if not pending then return end
    PendingCallbacks[result.requestId] = nil
    pending.resolve(result)
end)

-- Receive scoped exec results (client-side, separate net event name)
RegisterNetEvent('ktx_cb:execScopedClientResult')
AddEventHandler('ktx_cb:execScopedClientResult', function(result)
    if not result or not result.requestId then return end
    local pending = PendingCallbacks[result.requestId]
    if not pending then return end
    if pending.source ~= source then return end
    PendingCallbacks[result.requestId] = nil
    pending.resolve(result)
end)

-- Sync time with client on connect
AddEventHandler('playerJoining', function()
    local src = source
    SetTimeout(2000, function()
        TriggerClientEvent('ktx_cb:timeSync', src, os.time())
    end)
end)

-- Also sync existing players on resource start
CreateThread(function()
    Wait(1000)
    for _, id in ipairs(GetPlayers()) do
        TriggerClientEvent('ktx_cb:timeSync', tonumber(id), os.time())
    end
end)
