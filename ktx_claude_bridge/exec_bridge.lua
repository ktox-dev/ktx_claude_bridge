--[[
    ktx_claude_bridge — Injectable exec bridge
    Add to any resource's fxmanifest.lua:
        shared_script '@ktx_claude_bridge/exec_bridge.lua'
    This gives the bridge full access to this resource's Lua VM (server + client).
    DEV ONLY — remove before production.
]]

local resName <const> = GetCurrentResourceName()
local bridgeName <const> = 'ktx_claude_bridge'

-- Don't run inside the bridge itself
if resName == bridgeName then return end

local context <const> = IsDuplicityVersion() and 'server' or 'client'

local function execCode(code)
    local fn, err = load('return ' .. code, '@bridge_exec')
    if not fn then
        fn, err = load(code, '@bridge_exec')
    end
    if not fn then
        return { success = false, error = err, resource = resName, context = context }
    end

    local results = table.pack(pcall(fn))
    if not results[1] then
        return { success = false, error = tostring(results[2]), resource = resName, context = context }
    end

    -- Serialize result
    local function serialize(val, depth)
        depth = depth or 0
        if depth > 10 then return tostring(val) end
        local t = type(val)
        if t == 'vector3' then
            return { x = val.x, y = val.y, z = val.z, __type = 'vector3' }
        elseif t == 'vector4' then
            return { x = val.x, y = val.y, z = val.z, w = val.w, __type = 'vector4' }
        elseif t == 'table' then
            local out = {}
            for k, v in pairs(val) do
                out[k] = serialize(v, depth + 1)
            end
            return out
        elseif t == 'function' or t == 'userdata' or t == 'thread' then
            return tostring(val)
        end
        return val
    end

    if results.n <= 1 then
        return { success = true, resource = resName, context = context }
    elseif results.n == 2 then
        return { success = true, result = serialize(results[2]), resource = resName, context = context }
    else
        local out = {}
        for i = 2, results.n do
            out[i - 1] = serialize(results[i])
        end
        return { success = true, result = out, resource = resName, context = context }
    end
end

-- Register event handler for scoped execution
-- Server-side: local event only (NOT RegisterNetEvent — prevents clients from triggering arbitrary code)
-- Client-side: net event from server, results go back via separate net event
local eventName <const> = 'ktx_cb:execScoped'
local serverResultEvent <const> = 'ktx_cb:execScopedResult'
local clientResultEvent <const> = 'ktx_cb:execScopedClientResult'

if context == 'server' then
    -- Local-only handler: TriggerEvent from bridge, NOT reachable from network
    AddEventHandler(eventName, function(requestId, targetResource, code)
        if targetResource ~= resName then return end
        local result = execCode(code)
        result.requestId = requestId
        TriggerEvent(serverResultEvent, result)
    end)
else
    -- Client receives from server via net event
    RegisterNetEvent(eventName)
    AddEventHandler(eventName, function(requestId, targetResource, code)
        if targetResource ~= resName then return end
        local result = execCode(code)
        result.requestId = requestId
        TriggerServerEvent(clientResultEvent, result)
    end)
end
