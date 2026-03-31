local MAX_LINES <const> = Config.maxConsoleLines

--- Ring buffer for console lines.
---@class ConsoleBuffer
---@field lines table[]
---@field writePos integer
---@field count integer
local ConsoleBuffer = {}
ConsoleBuffer.__index = ConsoleBuffer

function ConsoleBuffer.new()
    return setmetatable({ lines = {}, writePos = 1, count = 0 }, ConsoleBuffer)
end

---@param entry table
function ConsoleBuffer:push(entry)
    self.lines[self.writePos] = entry
    self.writePos = self.writePos % MAX_LINES + 1
    if self.count < MAX_LINES then
        self.count = self.count + 1
    end
end

--- Get recent entries, optionally filtered by timestamp.
---@param count? integer
---@param since? number
---@return table[]
function ConsoleBuffer:get(count, since)
    count = count or self.count
    if count > self.count then count = self.count end

    local result = {}
    -- Read from oldest to newest
    local startPos
    if self.count < MAX_LINES then
        startPos = 1
    else
        startPos = self.writePos -- oldest entry in a full buffer
    end

    local added = 0
    for i = 0, self.count - 1 do
        local idx = (startPos - 1 + i) % MAX_LINES + 1
        local entry = self.lines[idx]
        if entry and (not since or entry.timestamp > since) then
            result[#result + 1] = entry
            added = added + 1
        end
    end

    -- Trim to requested count from the end (most recent)
    if added > count then
        local trimmed = {}
        for i = added - count + 1, added do
            trimmed[#trimmed + 1] = result[i]
        end
        return trimmed
    end

    return result
end

function ConsoleBuffer:clear()
    self.lines = {}
    self.writePos = 1
    self.count = 0
end

-- Server console buffer
ServerConsole = ConsoleBuffer.new()

-- Client console buffers keyed by player server ID
ClientConsoles = {}

--- Add a line to the server console buffer.
---@param level string "info"|"warn"|"error"|"event"
---@param message string
---@param resource? string
function AddServerConsole(level, message, resource)
    ServerConsole:push({
        timestamp = os.time(),
        level = level,
        message = message,
        resource = resource or GetCurrentResourceName(),
    })
end

--- Add lines to a player's client console buffer.
---@param playerId integer
---@param entries table[]
function AddClientConsole(playerId, entries)
    if not ClientConsoles[playerId] then
        ClientConsoles[playerId] = ConsoleBuffer.new()
    end
    for _, entry in ipairs(entries) do
        entry.timestamp = entry.timestamp or os.time()
        ClientConsoles[playerId]:push(entry)
    end
end

---@param count? integer
---@param since? number
---@return table[]
function GetServerConsole(count, since)
    return ServerConsole:get(count, since)
end

---@param playerId integer
---@param count? integer
---@param since? number
---@return table[]?
function GetClientConsole(playerId, count, since)
    local buf = ClientConsoles[playerId]
    if not buf then return {} end
    return buf:get(count, since)
end

function ClearServerConsole()
    ServerConsole:clear()
end

---@param playerId integer
function ClearClientConsole(playerId)
    if ClientConsoles[playerId] then
        ClientConsoles[playerId]:clear()
    end
end

-- Wrap print to also capture output
local _print <const> = print
---@diagnostic disable-next-line: lowercase-global
function print(...)
    _print(...)
    local parts = {}
    for i = 1, select('#', ...) do
        parts[i] = tostring(select(i, ...))
    end
    AddServerConsole('info', table.concat(parts, '\t'))
end

-- Capture resource lifecycle events
AddEventHandler('onServerResourceStart', function(resource)
    AddServerConsole('event', 'Resource started: ' .. resource, resource)
end)

AddEventHandler('onServerResourceStop', function(resource)
    AddServerConsole('event', 'Resource stopped: ' .. resource, resource)
end)

-- Clean up client console when player drops
AddEventHandler('playerDropped', function()
    local src = source
    ClientConsoles[src] = nil
end)
