local startTime <const> = os.time()
local resourceName <const> = GetCurrentResourceName()

--- GET /status — server health check
---@param _params table
---@param res table
function HandleStatus(_params, res)
    local players = GetPlayers()
    local resourceCount = 0
    for i = 0, GetNumResources() - 1 do
        if GetResourceByFindIndex(i) then
            resourceCount = resourceCount + 1
        end
    end

    SendJson(res, 200, {
        success = true,
        server = GetConvar('sv_hostname', 'Unknown'),
        players = #players,
        resources = resourceCount,
        uptime = os.time() - startTime,
        bridge = resourceName,
    })
end

--- GET /players — detailed player list
---@param _params table
---@param res table
function HandlePlayers(_params, res)
    local players = GetPlayers()
    local result = {}

    for _, id in ipairs(players) do
        local src = tonumber(id)
        local ped = GetPlayerPed(src)
        local coords = GetEntityCoords(ped)
        local vehicle = GetVehiclePedIsIn(ped, false)

        result[#result + 1] = {
            id = src,
            name = GetPlayerName(src),
            identifiers = GetPlayerIdentifiers(src),
            ping = GetPlayerPing(src),
            position = { x = coords.x, y = coords.y, z = coords.z },
            vehicle = vehicle ~= 0 and vehicle or nil,
        }
    end

    SendJson(res, 200, { success = true, players = result })
end

--- GET /resources — list all resources with states
---@param _params table
---@param res table
function HandleResources(_params, res)
    local result = {}
    for i = 0, GetNumResources() - 1 do
        local name = GetResourceByFindIndex(i)
        if name then
            result[#result + 1] = {
                name = name,
                state = GetResourceState(name),
            }
        end
    end

    SendJson(res, 200, { success = true, resources = result })
end

--- GET /server/info — extended server information
---@param _params table
---@param res table
function HandleServerInfo(_params, res)
    local players = GetPlayers()
    local started, stopped = 0, 0
    for i = 0, GetNumResources() - 1 do
        local name = GetResourceByFindIndex(i)
        if name then
            if GetResourceState(name) == 'started' then started = started + 1
            else stopped = stopped + 1 end
        end
    end

    SendJson(res, 200, {
        success = true,
        hostname = GetConvar('sv_hostname', 'Unknown'),
        maxClients = tonumber(GetConvar('sv_maxclients', '48')),
        onesync = GetConvar('onesync', 'off'),
        locale = GetConvar('ox:locale', GetConvar('qbx:locale', 'en')),
        gametype = GetConvar('gametype', ''),
        uptime = os.time() - startTime,
        players = {
            count = #players,
            ids = players,
        },
        resources = {
            total = started + stopped,
            started = started,
            stopped = stopped,
        },
        frameworks = {
            qbx_core = GetResourceState('qbx_core') == 'started',
            ox_lib = GetResourceState('ox_lib') == 'started',
            ox_inventory = GetResourceState('ox_inventory') == 'started',
            oxmysql = GetResourceState('oxmysql') == 'started',
        },
    })
end

--- POST /db/query — execute a read-only SQL query via oxmysql
---@param data table { query: string, params?: any[] }
---@param res table
function HandleDbQuery(data, res)
    if not data.query or data.query == '' then
        SendJson(res, 400, { error = 'query is required' })
        return
    end

    -- Safety: only allow SELECT, SHOW, DESCRIBE, EXPLAIN
    local trimmed = data.query:gsub('^%s+', ''):upper()
    if not (trimmed:match('^SELECT') or trimmed:match('^SHOW') or trimmed:match('^DESCRIBE') or trimmed:match('^EXPLAIN')) then
        SendJson(res, 400, { error = 'Only SELECT, SHOW, DESCRIBE, and EXPLAIN queries are allowed' })
        return
    end

    if GetResourceState('oxmysql') ~= 'started' then
        SendJson(res, 400, { error = 'oxmysql is not running' })
        return
    end

    local ok, result = pcall(function()
        return exports.oxmysql:executeSync(data.query, data.params or {})
    end)

    if not ok then
        SendJson(res, 500, { success = false, error = tostring(result) })
    else
        SendJson(res, 200, { success = true, rows = result, count = #result })
    end
end

--- GET /player/data — get Qbox player data (online or offline)
---@param params table { playerId?: number, citizenid?: string }
---@param res table
function HandlePlayerData(params, res)
    if GetResourceState('qbx_core') ~= 'started' then
        SendJson(res, 400, { error = 'qbx_core is not running' })
        return
    end

    local player
    if params.playerId then
        local src = tonumber(params.playerId)
        local ok, p = pcall(function() return exports.qbx_core:GetPlayer(src) end)
        if ok and p then player = p end
    elseif params.citizenid then
        -- Try online first, then offline
        local ok, p = pcall(function() return exports.qbx_core:GetPlayerByCitizenId(params.citizenid) end)
        if ok and p then
            player = p
        else
            local ok2, p2 = pcall(function() return exports.qbx_core:GetOfflinePlayer(params.citizenid) end)
            if ok2 and p2 then player = p2 end
        end
    else
        SendJson(res, 400, { error = 'playerId or citizenid query param is required' })
        return
    end

    if not player or not player.PlayerData then
        SendJson(res, 404, { error = 'Player not found' })
        return
    end

    local pd = player.PlayerData
    SendJson(res, 200, {
        success = true,
        player = {
            source = pd.source,
            citizenid = pd.citizenid,
            name = pd.name,
            charinfo = pd.charinfo,
            job = pd.job,
            gang = pd.gang,
            money = pd.money,
            metadata = pd.metadata,
            position = pd.position,
        },
    })
end

--- GET /resource/info — detailed info about a specific resource
---@param params table { name: string }
---@param res table
function HandleResourceInfo(params, res)
    local name = params.name
    if not name or name == '' then
        SendJson(res, 400, { error = 'name query param is required' })
        return
    end

    local state = GetResourceState(name)
    if state == 'missing' then
        SendJson(res, 404, { error = 'Resource not found: ' .. name })
        return
    end

    -- Gather metadata
    local function getMeta(key)
        local count = GetNumResourceMetadata(name, key)
        if count == 0 then return nil end
        if count == 1 then return GetResourceMetadata(name, key, 0) end
        local values = {}
        for i = 0, count - 1 do
            values[#values + 1] = GetResourceMetadata(name, key, i)
        end
        return values
    end

    SendJson(res, 200, {
        success = true,
        resource = {
            name = name,
            state = state,
            version = getMeta('resource_version'),
            author = getMeta('author'),
            description = getMeta('description'),
            fx_version = getMeta('fx_version'),
            game = getMeta('game'),
            lua54 = getMeta('lua54'),
            dependencies = getMeta('dependency'),
            server_scripts = getMeta('server_script'),
            client_scripts = getMeta('client_script'),
            shared_scripts = getMeta('shared_script'),
            exports = getMeta('export'),
            server_exports = getMeta('server_export'),
            ui_page = getMeta('ui_page'),
        },
    })
end

--- GET /entities — list all server-side entities (requires OneSync)
---@param params table { type?: string }
---@param res table
function HandleEntities(params, res)
    local ok, vehicles = pcall(GetAllVehicles)
    if not ok then
        SendJson(res, 400, { error = 'Entity enumeration requires OneSync to be enabled' })
        return
    end

    local filter = params.type
    local result = {}

    if not filter or filter == 'vehicle' then
        for _, handle in ipairs(vehicles) do
            local coords = GetEntityCoords(handle)
            result[#result + 1] = {
                type = 'vehicle',
                handle = handle,
                model = GetEntityModel(handle),
                position = { x = coords.x, y = coords.y, z = coords.z },
                heading = GetEntityHeading(handle),
                health = GetEntityHealth(handle),
            }
        end
    end

    if not filter or filter == 'ped' then
        for _, handle in ipairs(GetAllPeds()) do
            local coords = GetEntityCoords(handle)
            result[#result + 1] = {
                type = 'ped',
                handle = handle,
                model = GetEntityModel(handle),
                position = { x = coords.x, y = coords.y, z = coords.z },
                health = GetEntityHealth(handle),
            }
        end
    end

    if not filter or filter == 'object' then
        for _, handle in ipairs(GetAllObjects()) do
            local coords = GetEntityCoords(handle)
            result[#result + 1] = {
                type = 'object',
                handle = handle,
                model = GetEntityModel(handle),
                position = { x = coords.x, y = coords.y, z = coords.z },
            }
        end
    end

    SendJson(res, 200, { success = true, entities = result, total = #result })
end

--- GET /console/server — recent server console lines
---@param params table { count?, since? }
---@param res table
function HandleServerConsole(params, res)
    local count = params.count and tonumber(params.count)
    local since = params.since and tonumber(params.since)
    local lines = GetServerConsole(count, since)
    SendJson(res, 200, { success = true, lines = lines, total = #lines })
end

--- GET /console/client — recent client console lines
---@param params table { playerId, count?, since? }
---@param res table
function HandleClientConsole(params, res)
    local playerId = params.playerId and tonumber(params.playerId)
    if not playerId then
        SendJson(res, 400, { error = 'playerId is required' })
        return
    end

    local count = params.count and tonumber(params.count)
    local since = params.since and tonumber(params.since)
    local lines = GetClientConsole(playerId, count, since)
    SendJson(res, 200, { success = true, lines = lines, total = #lines })
end

--- POST /exec/server — execute Lua on the server
---@param data table { code: string }
---@param res table
function HandleExecServer(data, res)
    if not data.code or data.code == '' then
        SendJson(res, 400, { error = 'code is required' })
        return
    end

    local result = SafeExec(data.code)

    -- Log to server console
    if not result.success then
        AddServerConsole('error', 'exec/server error: ' .. (result.error or 'unknown'))
    end

    SendJson(res, 200, result)
end

--- POST /exec/client — execute Lua on a player's client
---@param data table { code: string, playerId?: integer }
---@param res table
function HandleExecClient(data, res)
    if not data.code or data.code == '' then
        SendJson(res, 400, { error = 'code is required' })
        return
    end

    local playerId = data.playerId
    if not playerId then
        local players = GetPlayers()
        if #players == 0 then
            SendJson(res, 400, { error = 'No players connected' })
            return
        end
        playerId = tonumber(players[1])
    end

    ExecOnClient(playerId, data.code, function(result)
        SendJson(res, 200, result)
    end)
end

--- POST /event/server — trigger a server event
---@param data table { eventName: string, args?: any[] }
---@param res table
function HandleTriggerServerEvent(data, res)
    if not data.eventName or data.eventName == '' then
        SendJson(res, 400, { error = 'eventName is required' })
        return
    end

    TriggerEvent(data.eventName, table.unpack(data.args or {}))
    SendJson(res, 200, { success = true })
end

--- POST /event/client — trigger a client event on a player
---@param data table { eventName: string, playerId: integer, args?: any[] }
---@param res table
function HandleTriggerClientEvent(data, res)
    if not data.eventName or data.eventName == '' then
        SendJson(res, 400, { error = 'eventName is required' })
        return
    end

    local playerId = data.playerId
    if not playerId then
        SendJson(res, 400, { error = 'playerId is required' })
        return
    end

    TriggerClientEvent(data.eventName, playerId, table.unpack(data.args or {}))
    SendJson(res, 200, { success = true })
end

--- POST /command — execute a server console command
---@param data table { command: string }
---@param res table
function HandleCommand(data, res)
    if not data.command or data.command == '' then
        SendJson(res, 400, { error = 'command is required' })
        return
    end

    -- Block helper restart and handle self-restart via helper
    local lower = data.command:lower()
    if lower:match('ktx_bridge_helper') then
        SendJson(res, 400, { error = 'Cannot restart ktx_bridge_helper (holds RegisterConsoleListener). Use txAdmin.' })
        return
    end

    if lower:match('^%s*ensure%s+' .. resourceName) or
       lower:match('^%s*restart%s+' .. resourceName) or
       lower:match('^%s*stop%s+' .. resourceName) then
        local ok = pcall(exports['ktx_bridge_helper'].restartBridge)
        if ok then
            SendJson(res, 200, { success = true, deferred = true })
        else
            SendJson(res, 400, { error = 'Cannot self-restart: ktx_bridge_helper not running. Use txAdmin.' })
        end
        return
    end

    ExecuteCommand(data.command)
    SendJson(res, 200, { success = true })
end

--- POST /resource/restart — restart a resource
---@param data table { resourceName: string }
---@param res table
function HandleRestartResource(data, res)
    if not data.resourceName or data.resourceName == '' then
        SendJson(res, 400, { error = 'resourceName is required' })
        return
    end

    if data.resourceName == 'ktx_bridge_helper' then
        SendJson(res, 400, { error = 'Cannot restart ktx_bridge_helper (holds RegisterConsoleListener). Use txAdmin.' })
        return
    end

    if data.resourceName == resourceName then
        -- Use helper resource to restart us from outside
        local ok = pcall(exports['ktx_bridge_helper'].restartBridge)
        if ok then
            SendJson(res, 200, { success = true, message = 'ensure ' .. data.resourceName, deferred = true })
        else
            SendJson(res, 400, { error = 'Cannot self-restart: ktx_bridge_helper not running. Use txAdmin.' })
        end
        return
    end

    ExecuteCommand('ensure ' .. data.resourceName)
    SendJson(res, 200, { success = true, message = 'ensure ' .. data.resourceName })
end

--- POST /command/client — execute a registered command on a player's client
---@param data table { command: string, playerId?: integer }
---@param res table
function HandleClientCommand(data, res)
    if not data.command or data.command == '' then
        SendJson(res, 400, { error = 'command is required' })
        return
    end

    local playerId = data.playerId
    if not playerId then
        local players = GetPlayers()
        if #players == 0 then
            SendJson(res, 400, { error = 'No players connected' })
            return
        end
        playerId = tonumber(players[1])
    end

    -- Build Lua code that executes the command on the client
    local escaped = data.command:gsub('\\', '\\\\'):gsub("'", "\\'")
    local code = ("ExecuteCommand('%s') return 'executed'"):format(escaped)

    ExecOnClient(playerId, code, function(result)
        SendJson(res, 200, result)
    end)
end

--- POST /nui/state — get NUI state from a player's client
---@param data table { playerId?: integer }
---@param res table
function HandleNuiState(data, res)
    local playerId = data.playerId
    if not playerId then
        local players = GetPlayers()
        if #players == 0 then
            SendJson(res, 400, { error = 'No players connected' })
            return
        end
        playerId = tonumber(players[1])
    end

    local code = [[
        local focused = IsNuiFocused()
        local focusedKeepInput = IsNuiFocusKeepingInput()
        local cursorActive = IsCursorActiveThisFrame and IsCursorActiveThisFrame() or false
        return {
            focused = focused,
            focusedKeepInput = focusedKeepInput,
            cursorActive = cursorActive,
        }
    ]]

    ExecOnClient(playerId, code, function(result)
        SendJson(res, 200, result)
    end)
end

--- POST /screenshot — take a screenshot of a player's screen
---@param data table { playerId?: integer }
---@param res table
function HandleScreenshot(data, res)
    local playerId = data.playerId
    if not playerId then
        local players = GetPlayers()
        if #players == 0 then
            SendJson(res, 400, { error = 'No players connected' })
            return
        end
        playerId = tonumber(players[1])
    end

    TakeScreenshot(playerId, function(result)
        SendJson(res, 200, result)
    end)
end
