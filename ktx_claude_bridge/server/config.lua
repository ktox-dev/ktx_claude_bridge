Config = {}

Config.enabled = GetConvar('ktx_bridge_enabled', 'true') == 'true'
Config.authToken = GetConvar('ktx_bridge_token', '')
-- Generous, because calls run as jobs now and no longer hold a connection
-- open. The only purpose left for this value is to give up on a client that
-- hangs.
Config.clientExecTimeout = tonumber(GetConvar('ktx_bridge_client_timeout', '300000'))
Config.maxConsoleLines = tonumber(GetConvar('ktx_bridge_max_console', '500'))

CreateThread(function()
    if not Config.enabled then
        print('^1[ktx_claude_bridge] Bridge is DISABLED via convar^0')
        return
    end

    print('^3[ktx_claude_bridge] DEV TOOL ACTIVE — Do not use in production^0')
    if Config.authToken == '' then
        print('^3[ktx_claude_bridge] No token set, requests are accepted from this machine only.^0')
        print('^3[ktx_claude_bridge] To reach the bridge from another machine, set ktx_bridge_token in your server.cfg.^0')
    else
        print('^2[ktx_claude_bridge] Token set, every request needs it.^0')
    end
end)
