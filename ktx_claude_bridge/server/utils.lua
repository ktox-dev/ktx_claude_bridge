--- Serialize a value into a JSON-safe representation.
--- Handles vector3, vector4, and recursive tables.
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

--- Serialize multiple return values into a JSON-safe result.
---@param ... any
---@return any
function Serialize(...)
    local args = table.pack(...)
    if args.n == 0 then return nil end
    if args.n == 1 then return SerializeValue(args[1]) end

    local out = {}
    for i = 1, args.n do
        out[i] = SerializeValue(args[i])
    end
    return out
end

--- Execute arbitrary Lua code safely.
--- Tries `return <code>` first (expression), falls back to raw `<code>` (statement).
---@param code string
---@return { success: boolean, result: any, error: string?, type: string? }
function SafeExec(code)
    local fn, err = load('return ' .. code)
    if not fn then
        fn, err = load(code)
    end

    if not fn then
        return { success = false, error = err }
    end

    local results = table.pack(pcall(fn))
    local ok = results[1]

    if not ok then
        return { success = false, error = tostring(results[2]) }
    end

    if results.n <= 1 then
        return { success = true, result = nil, type = 'nil' }
    end

    local serialized
    if results.n == 2 then
        serialized = Serialize(results[2])
    else
        serialized = {}
        for i = 2, results.n do
            serialized[i - 1] = Serialize(results[i])
        end
    end

    return {
        success = true,
        result = serialized,
        type = results.n == 2 and type(results[2]) or 'multi',
    }
end

--- Parse a JSON request body and call cb with the decoded data.
---@param req table FiveM HTTP request
---@param res table FiveM HTTP response
---@param cb fun(data: table)
function ParseBody(req, res, cb)
    req.setDataHandler(function(body)
        if not body or body == '' then
            SendJson(res, 400, { error = 'Empty request body' })
            return
        end

        local ok, data = pcall(json.decode, body)
        if not ok or type(data) ~= 'table' then
            SendJson(res, 400, { error = 'Invalid JSON' })
            return
        end

        cb(data)
    end)
end

--- Send a JSON response.
---@param res table FiveM HTTP response
---@param status integer HTTP status code
---@param data any
function SendJson(res, status, data)
    res.writeHead(status, { ['Content-Type'] = 'application/json' })
    local ok, encoded = pcall(json.encode, data)
    if ok then
        res.send(encoded)
    else
        res.send(json.encode({ error = 'Failed to encode response: ' .. tostring(encoded) }))
    end
end
