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

    ExecuteCommand('ensure ' .. data.resourceName)
    SendJson(res, 200, { success = true, message = 'ensure ' .. data.resourceName })
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
