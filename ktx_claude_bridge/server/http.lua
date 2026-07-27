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

--- Check auth token if configured.
---@param req table
---@return boolean
local function checkAuth(req)
    if TOKEN == '' then return true end

    local auth = req.headers and req.headers['authorization']
    if not auth then return false end

    return auth == 'Bearer ' .. TOKEN
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
        local handler = GET_ROUTES[path]
        if handler then
            handler(params, res)
            return
        end

        -- GET-Umweg fuer die POST-Routen.
        --
        -- Unter FiveM fuer GTAV Enhanced (b96) feuert der Rueckruf von
        -- req.setDataHandler nicht mehr, deshalb bleibt jeder POST ohne
        -- Antwort haengen (gemeldet als citizenfx/rfc#279). Solange das so
        -- ist, schickt der Client die Nutzlast als ?body=<json> mit und wir
        -- rufen denselben Handler auf. Kommt der Fehlerfix, reicht ein
        -- Umschalten auf der Clientseite - hier muss nichts zurueckgebaut
        -- werden.
        --
        -- Grenze: die Nutzlast steht in der URL. Sehr lange Lua-Schnipsel
        -- koennen an Laengenbegrenzungen scheitern; dann ueber eine Datei
        -- oder einen Export gehen.
        local postHandler = POST_ROUTES[path]

        if postHandler then
            if not params.body then
                SendJson(res, 400, {
                    error = 'This route needs a payload. Send it as ?body=<url-encoded json>.',
                })
                return
            end

            local ok, data = pcall(json.decode, params.body)

            if not ok or type(data) ~= 'table' then
                local preview = #params.body > 120 and params.body:sub(1, 120) .. '...' or params.body
                SendJson(res, 400, { error = 'Invalid JSON in body parameter: ' .. preview })
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
