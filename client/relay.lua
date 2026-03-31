--- Client-side serialization (mirrors server/utils.lua Serialize).
---@param val any
---@param depth? integer
---@return any
local function SerializeValue(val, depth)
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
            out[k] = SerializeValue(v, depth + 1)
        end
        return out
    elseif t == 'function' or t == 'userdata' or t == 'thread' then
        return tostring(val)
    end

    return val
end

---@param ... any
---@return any
local function Serialize(...)
    local args = table.pack(...)
    if args.n == 0 then return nil end
    if args.n == 1 then return SerializeValue(args[1]) end

    local out = {}
    for i = 1, args.n do
        out[i] = SerializeValue(args[i])
    end
    return out
end

--- Execute code and return the result, mirroring server SafeExec.
---@param code string
---@return any result
---@return string? error
local function ExecCode(code)
    local fn, err = load('return ' .. code)
    if not fn then
        fn, err = load(code)
    end

    if not fn then
        return nil, err
    end

    local results = table.pack(pcall(fn))
    if not results[1] then
        return nil, tostring(results[2])
    end

    if results.n <= 1 then
        return nil, nil
    end

    if results.n == 2 then
        return Serialize(results[2]), nil
    end

    local serialized = {}
    for i = 2, results.n do
        serialized[i - 1] = Serialize(results[i])
    end
    return serialized, nil
end

-- Console capture buffer
local consoleBuffer = {}
local FLUSH_INTERVAL <const> = 5000 -- ms

-- Wrap client-side print
local _print <const> = print
---@diagnostic disable-next-line: lowercase-global
function print(...)
    _print(...)
    local parts = {}
    for i = 1, select('#', ...) do
        parts[i] = tostring(select(i, ...))
    end
    consoleBuffer[#consoleBuffer + 1] = {
        timestamp = GetGameTimer(),
        level = 'info',
        message = table.concat(parts, '\t'),
    }
end

-- Periodically flush console buffer to server
CreateThread(function()
    while true do
        Wait(FLUSH_INTERVAL)
        if #consoleBuffer > 0 then
            local batch = consoleBuffer
            consoleBuffer = {}
            TriggerServerEvent('ktx_cb:clientConsole', batch)
        end
    end
end)

-- Handle exec requests from server
RegisterNetEvent('ktx_cb:exec')
AddEventHandler('ktx_cb:exec', function(requestId, code)
    local result, err = ExecCode(code)

    -- Capture any prints that happened during execution
    if #consoleBuffer > 0 then
        local batch = consoleBuffer
        consoleBuffer = {}
        TriggerServerEvent('ktx_cb:clientConsole', batch)
    end

    TriggerServerEvent('ktx_cb:execResult', requestId, result, err)
end)
