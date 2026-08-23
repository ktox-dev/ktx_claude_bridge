local TOKEN <const> = Config.authToken

--- Percent-decode a query string value.
--- Note: `+` is deliberately NOT treated as a space. The client encodes with
--- encodeURIComponent, which turns a literal `+` into `%2B` and a space into
--- `%20`. Treating `+` as a space here would corrupt Lua code containing `+`.
---@param str string?
---@return string?
local function urlDecode(str)
    if not str or str == '' then return str end

    return (str:gsub('%%(%x%x)', function(hex)
        return string.char(tonumber(hex, 16))
    end))
end

--- Parse query string parameters from a URL path.
---@param path string
---@return string cleanPath
---@return table<string, string> params
local function parseQuery(path)
    local qPos = path:find('?')
    if not qPos then return path, {} end

    local cleanPath = path:sub(1, qPos - 1)
    local queryStr = path:sub(qPos + 1)
    local params = {}

    for pair in queryStr:gmatch('[^&]+') do
        local key, value = pair:match('([^=]+)=?(.*)')
        if key then
            params[urlDecode(key)] = urlDecode(value) or ''
        end
    end

    return cleanPath, params
end

--- The peer address without its port.
--- FiveM hands it over as "127.0.0.1:54321", over IPv6 as "[::1]:54321".
--- A plain find for "::1" would also match 2001:db8::1234, so the host is
--- pulled out properly.
---@param address string
---@return string
local function hostOf(address)
    if address:sub(1, 1) == '[' then
        return address:match('^%[([^%]]+)%]') or ''
    end
    local _, colons = address:gsub(':', '')
    if colons <= 1 then
        return address:match('^([^:]+)') or ''
    end
    return address
end

--- Did this request come from the machine the server runs on?
---@param req table
---@return boolean
local function isLocal(req)
    local host = hostOf(req.address or '')
    return host == '::1' or host == 'localhost' or host == '::ffff:127.0.0.1'
        or host:match('^127%.%d+%.%d+%.%d+$') ~= nil
end

--- Who gets through.
---
--- The handler hangs off SetHttpHandler, which is the server's public HTTP
--- port, and behind it sit /exec/server, /db/query and /resource/file/write.
--- An empty token used to let every request through: whoever knew the address
--- had the server. A development tool should still work without being set up
--- first, so the rule is now: with a token the token counts, without one only
--- this machine does.
---
--- The header is read in both spellings, the client sends it capitalised.
---@param req table
---@return boolean
local function checkAuth(req)
    if TOKEN ~= '' then
        local headers = req.headers
        local auth = headers and (headers['authorization'] or headers['Authorization'])
        return auth == 'Bearer ' .. TOKEN
    end

    return isLocal(req)
end

-- GET route table
local GET_ROUTES <const> = {
    ['/status']          = HandleStatus,
    ['/players']         = HandlePlayers,
    ['/resources']       = HandleResources,
    ['/server/info']     = HandleServerInfo,
    ['/player/data']     = HandlePlayerData,
    ['/resource/info']   = HandleResourceInfo,
    ['/entities']        = HandleEntities,
    ['/console/server']  = HandleServerConsole,
    ['/console/client']  = HandleClientConsole,
    ['/commands']        = HandleGetCommands,
}

-- POST route table
local POST_ROUTES <const> = {
    ['/exec/server']         = HandleExecServer,
    ['/exec/client']         = HandleExecClient,
    ['/exec/server/scoped']  = HandleExecServerScoped,
    ['/exec/client/scoped']  = HandleExecClientScoped,
    ['/event/server']     = HandleTriggerServerEvent,
    ['/event/client']     = HandleTriggerClientEvent,
    ['/command']          = HandleCommand,
    ['/command/client']   = HandleClientCommand,
    ['/db/query']         = HandleDbQuery,
    ['/nui/state']        = HandleNuiState,
    ['/resource/restart']    = HandleRestartResource,
    ['/resource/file/read']  = HandleReadResourceFile,
    ['/resource/file/write'] = HandleWriteResourceFile,
    ['/resource/files']      = HandleListResourceFiles,
    ['/screenshot']          = HandleScreenshot,
}

-- ===========================================================================
-- Jobs, against the server's time limit
--
-- FiveM closes an HTTP response that is held open after a few seconds.
-- Anything slower than that (client Lua with Wait, measurement runs,
-- screenshots) ran into nothing, even though the code on the client finished
-- cleanly.
--
-- So a call now creates a job and answers with its id IMMEDIATELY. The result
-- is picked up later from /job?id=<id>. That decouples how long the work takes
-- from how long a connection lives.
-- ===========================================================================
local Jobs = {}
local nextJob = 0

local function newJob()
    nextJob = nextJob + 1
    local id = ('job_%d_%d'):format(os.time(), nextJob)
    Jobs[id] = { done = false, created = os.time() }
    return id
end

--- A response object that writes into the job instead of sending.
---@param id string
---@return table
local function jobRes(id)
    return {
        writeHead = function() end,
        write = function() end,
        send = function(body)
            local job = Jobs[id]
            if not job then return end
            job.done = true
            job.body = body
            job.finished = os.time()
        end,
    }
end

-- Clear out old jobs so the table does not grow forever.
CreateThread(function()
    while true do
        Wait(60000)
        local now = os.time()
        for id, job in pairs(Jobs) do
            if now - (job.finished or job.created) > 600 then Jobs[id] = nil end
        end
    end
end)

-- ===========================================================================
-- Chunked upload, against the length limit of a URL
--
-- The payload travels as a query parameter because POST bodies do not arrive
-- under b96. Long pieces of Lua blow past what a URL holds. The client splits
-- them and sends the pieces to /chunk one after another; the actual call then
-- only points at them with ?chunked=<id>.
-- ===========================================================================
local Chunks = {}

CreateThread(function()
    while true do
        Wait(60000)
        local now = os.time()
        for id, c in pairs(Chunks) do
            if now - c.t > 300 then Chunks[id] = nil end
        end
    end
end)

--- Teile eines Uploads einsammeln.
local function handleChunk(params, res)
    local id, idx, total = params.id, tonumber(params.i), tonumber(params.n)

    if not id or not idx or not total then
        SendJson(res, 400, { error = '/chunk needs id, i, n and d' })
        return
    end

    local c = Chunks[id]
    if not c then
        c = { parts = {}, total = total, t = os.time() }
        Chunks[id] = c
    end

    c.parts[idx] = params.d or ''
    c.t = os.time()

    local have = 0
    for _ in pairs(c.parts) do have = have + 1 end

    SendJson(res, 200, { success = true, received = have, total = total })
end

--- Take the assembled payload and free the buffer.
---@param id string
---@return string?
local function takeChunked(id)
    local c = Chunks[id]
    if not c then return nil end

    local out = {}
    for i = 1, c.total do
        if c.parts[i] == nil then return nil end
        out[#out + 1] = c.parts[i]
    end

    Chunks[id] = nil
    return table.concat(out)
end

SetHttpHandler(function(req, res)
    if not Config.enabled then
        SendJson(res, 503, { error = 'Bridge is disabled' })
        return
    end

    if not checkAuth(req) then
        SendJson(res, 401, { error = 'Unauthorized' })
        return
    end

    local path, params = parseQuery(req.path)

    if req.method == 'GET' then
        -- Teil-Upload einer langen Nutzlast
        if path == '/chunk' then
            handleChunk(params, res)
            return
        end

        -- Ergebnis eines Auftrags abholen
        if path == '/job' then
            local job = Jobs[params.id or '']

            if not job then
                SendJson(res, 404, { error = 'Unknown job: ' .. tostring(params.id) })
                return
            end

            if not job.done then
                SendJson(res, 200, { done = false, waited = os.time() - job.created })
                return
            end

            -- The job body is finished JSON already. It goes out raw so
            -- the client side does not have to unwrap it twice.
            res.writeHead(200, { ['Content-Type'] = 'application/json' })
            res.send(job.body or '{"error":"empty job body"}')
            Jobs[params.id] = nil
            return
        end

        local handler = GET_ROUTES[path]
        if handler then
            handler(params, res)
            return
        end

        -- The GET detour for the POST routes.
        --
        -- On FiveM for GTAV Enhanced (b96) the callback of req.setDataHandler
        -- does not fire any more, so every POST hangs without an answer
        -- (reported as citizenfx/rfc#279). While that lasts the client sends
        -- the payload as ?body=<json> and we call the same handler. Once it is
        -- fixed, switching back is a change on the client side only, nothing
        -- here has to be undone.
        --
        -- The limit: the payload sits in the URL. Very long pieces of Lua can
        -- run into length limits, and then a file or an export is the way.
        local postHandler = POST_ROUTES[path]

        if postHandler then
            -- Nutzlast entweder direkt in ?body= oder stueckweise vorab
            -- hochgeladen und per ?chunked= referenziert.
            local raw = params.body

            if params.chunked then
                raw = takeChunked(params.chunked)

                if not raw then
                    SendJson(res, 400, {
                        error = 'Incomplete or unknown chunk upload: ' .. tostring(params.chunked),
                    })
                    return
                end
            end

            if not raw then
                SendJson(res, 400, {
                    error = 'This route needs a payload. Send it as ?body=<url-encoded json> or upload it to /chunk and pass ?chunked=<id>.',
                })
                return
            end

            local ok, data = pcall(json.decode, raw)

            if not ok or type(data) ~= 'table' then
                local preview = #raw > 120 and raw:sub(1, 120) .. '...' or raw
                SendJson(res, 400, { error = 'Invalid JSON in payload: ' .. preview })
                return
            end

            -- Job mode: answer with the id at once, pick the result up
            -- from /job later. This decouples how long the work takes from
            -- how long the connection lives.
            if params.async == '1' then
                local id = newJob()

                -- Run it in a thread of its OWN. If the handler runs
                -- synchronously (server Lua with Wait) it would otherwise
                -- block the very response that tells the caller the id, and
                -- nothing would be gained.
                CreateThread(function()
                    local ok, err = pcall(postHandler, data, jobRes(id))

                    if not ok then
                        local job = Jobs[id]

                        if job and not job.done then
                            job.done = true
                            job.body = json.encode({ error = 'Handler failed: ' .. tostring(err) })
                            job.finished = os.time()
                        end
                    end
                end)

                SendJson(res, 202, { job = id })
                return
            end

            postHandler(data, res)
            return
        end

        SendJson(res, 404, { error = 'Not found: ' .. path })
    elseif req.method == 'POST' then
        local handler = POST_ROUTES[path]
        if not handler then
            SendJson(res, 404, { error = 'Not found: ' .. path })
            return
        end
        ParseBody(req, res, function(data)
            handler(data, res)
        end)
    else
        SendJson(res, 405, { error = 'Method not allowed' })
    end
end)

local function countKeys(t)
    local n = 0
    for _ in pairs(t) do n = n + 1 end
    return n
end

print(('[ktx_claude_bridge] HTTP handler registered — %d GET, %d POST routes'):format(
    countKeys(GET_ROUTES),
    countKeys(POST_ROUTES)
))
