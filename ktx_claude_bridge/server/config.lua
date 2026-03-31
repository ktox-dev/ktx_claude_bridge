Config = {}

Config.enabled = GetConvar('ktx_bridge_enabled', 'true') == 'true'
Config.authToken = GetConvar('ktx_bridge_token', '')
Config.clientExecTimeout = tonumber(GetConvar('ktx_bridge_client_timeout', '10000'))
Config.maxConsoleLines = tonumber(GetConvar('ktx_bridge_max_console', '500'))

CreateThread(function()
    if Config.enabled then
        print('^3[ktx_claude_bridge] DEV TOOL ACTIVE — Do not use in production^0')
    else
        print('^1[ktx_claude_bridge] Bridge is DISABLED via convar^0')
    end
end)
