--[[
    ktx_bridge_helper
    1. Holds RegisterConsoleListener + persistent 1000-line ring buffer
    2. Restarts ktx_claude_bridge on demand (avoids SIGSEGV)
    DO NOT RESTART THIS RESOURCE.
]]

local BRIDGE <const> = 'ktx_claude_bridge'
local MAX_LINES <const> = 1000

-- Ring buffer (local to this resource, persists because this resource never restarts)
local lines = {}
local writePos = 1
local count = 0

local function push(entry)
    lines[writePos] = entry
    writePos = writePos % MAX_LINES + 1
    if count < MAX_LINES then
        count = count + 1
    end
end

local function get(maxCount, since)
    maxCount = maxCount or count
    if maxCount > count then maxCount = count end

    local result = {}
    local startPos = count < MAX_LINES and 1 or writePos

    local added = 0
    for i = 0, count - 1 do
        local idx = (startPos - 1 + i) % MAX_LINES + 1
        local entry = lines[idx]
        if entry and (not since or entry.timestamp > since) then
            result[#result + 1] = entry
            added = added + 1
        end
    end

    if added > maxCount then
        local trimmed = {}
        for i = added - maxCount + 1, added do
            trimmed[#trimmed + 1] = result[i]
        end
        return trimmed
    end

    return result
end

local function clear()
    lines = {}
    writePos = 1
    count = 0
end

local function getCount()
    return count
end

-- Exports for the bridge
exports('getConsole', get)
exports('addConsole', push)
exports('clearConsole', clear)
exports('getConsoleCount', getCount)

exports('restartBridge', function()
    SetTimeout(200, function()
        ExecuteCommand('ensure ' .. BRIDGE)
    end)
    return true
end)

-- RegisterConsoleListener — captures ALL server output
local inListener = false
RegisterConsoleListener(function(channel, message)
    if inListener then return end
    inListener = true
    pcall(function()
        local cleaned = message:gsub('[\r\n]+$', '')
        if cleaned ~= '' then
            push({
                timestamp = os.time(),
                level = 'info',
                message = cleaned,
                resource = channel ~= '' and channel or nil,
            })
        end
    end)
    inListener = false
end)

-- Resource lifecycle events
AddEventHandler('onServerResourceStart', function(resource)
    push({ timestamp = os.time(), level = 'event', message = 'Resource started: ' .. resource, resource = resource })
end)

AddEventHandler('onServerResourceStop', function(resource)
    push({ timestamp = os.time(), level = 'event', message = 'Resource stopped: ' .. resource, resource = resource })
end)

print('[ktx_bridge_helper] Console capture + restart helper active (' .. MAX_LINES .. ' lines) — DO NOT RESTART')
