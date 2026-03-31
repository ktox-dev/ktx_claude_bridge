local MAX_LINES <const> = Config.maxConsoleLines
local HELPER <const> = 'ktx_bridge_helper'

--- Ring buffer for client console lines only.
---@class ConsoleBuffer
---@field lines table[]
---@field writePos integer
---@field count integer
---@field maxLines integer
local ConsoleBuffer = {}
ConsoleBuffer.__index = ConsoleBuffer

function ConsoleBuffer.new(maxLines)
    return setmetatable({ lines = {}, writePos = 1, count = 0, maxLines = maxLines or MAX_LINES }, ConsoleBuffer)
end

---@param entry table
function ConsoleBuffer:push(entry)
    self.lines[self.writePos] = entry
    self.writePos = self.writePos % self.maxLines + 1
    if self.count < self.maxLines then
        self.count = self.count + 1
    end
end

---@param count? integer
---@param since? number
---@return table[]
function ConsoleBuffer:get(count, since)
    count = count or self.count
    if count > self.count then count = self.count end

    local result = {}
    local startPos = self.count < self.maxLines and 1 or self.writePos

    local added = 0
    for i = 0, self.count - 1 do
        local idx = (startPos - 1 + i) % self.maxLines + 1
        local entry = self.lines[idx]
        if entry and (not since or entry.timestamp > since) then
            result[#result + 1] = entry
            added = added + 1
        end
    end

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

-- Client console buffers keyed by player server ID
ClientConsoles = {}

-- Server console: delegate to ktx_bridge_helper (never restarts, data persists)
---@param count? integer
---@param since? number
---@return table[]
function GetServerConsole(count, since)
    local ok, result = pcall(exports[HELPER].getConsole, count, since)
    if ok then return result end
    return {}
end

---@param level string
---@param message string
---@param resource? string
function AddServerConsole(level, message, resource)
    pcall(exports[HELPER].addConsole, {
        timestamp = os.time(),
        level = level,
        message = message,
        resource = resource or GetCurrentResourceName(),
    })
end

function ClearServerConsole()
    pcall(exports[HELPER].clearConsole)
end

-- Client console functions
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

---@param playerId integer
---@param count? integer
---@param since? number
---@return table[]?
function GetClientConsole(playerId, count, since)
    local buf = ClientConsoles[playerId]
    if not buf then return {} end
    return buf:get(count, since)
end

---@param playerId integer
function ClearClientConsole(playerId)
    if ClientConsoles[playerId] then
        ClientConsoles[playerId]:clear()
    end
end

-- Clean up client console when player drops
AddEventHandler('playerDropped', function()
    local src = source
    ClientConsoles[src] = nil
end)
