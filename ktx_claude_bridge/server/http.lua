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

-- ===========================================================================
-- Auftraege (jobs) — gegen die Zeitgrenze des Servers
--
-- FiveM schliesst eine offen gehaltene HTTP-Antwort nach wenigen Sekunden.
-- Alles, was laenger dauert (Client-Lua mit Wait, Messreihen, Screenshots),
-- lief deshalb ins Leere, obwohl der Code auf dem Client sauber durchlief.
--
-- Loesung: Der Aufruf legt einen Auftrag an und antwortet SOFORT mit dessen
-- Nummer. Das Ergebnis wird spaeter unter /job?id=<nr> abgeholt. Damit ist die
-- Laufzeit einer Ausfuehrung von der Lebensdauer einer HTTP-Verbindung
-- entkoppelt.
-- ===========================================================================
local Jobs = {}
local nextJob = 0

local function newJob()
    nextJob = nextJob + 1
    local id = ('job_%d_%d'):format(os.time(), nextJob)
    Jobs[id] = { done = false, created = os.time() }
    return id
end

--- Ein Antwort-Objekt, das statt zu senden in den Auftrag schreibt.
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

-- Alte Auftraege wegraeumen, damit die Tabelle nicht waechst.
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
-- Stueckweise Uebertragung — gegen die Laengengrenze der URL
--
-- Die Nutzlast reist als Query-Parameter, weil POST-Bodies unter b96 nicht
-- ankommen. Lange Lua-Schnipsel sprengen damit die URL. Der Client zerlegt
-- sie deshalb und schickt die Teile nacheinander an /chunk; der eigentliche
-- Aufruf verweist dann nur noch per ?chunked=<id> darauf.
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

--- Zusammengesetzte Nutzlast holen und den Zwischenspeicher freigeben.
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

            -- Der Auftragskoerper ist bereits fertiges JSON. Damit die
            -- Clientseite nicht doppelt auspacken muss, geht er roh raus.
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

            -- Auftragsbetrieb: sofort die Nummer zurueckgeben, Ergebnis spaeter
            -- unter /job abholen. Das entkoppelt die Laufzeit von der
            -- Lebensdauer der HTTP-Verbindung.
            if params.async == '1' then
                local id = newJob()

                -- In einem EIGENEN Thread ausfuehren. Laeuft der Handler
                -- synchron (Server-Lua mit Wait), wuerde er sonst genau die
                -- Antwort blockieren, die dem Aufrufer die Nummer mitteilt —
                -- und wir haetten nichts gewonnen.
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
