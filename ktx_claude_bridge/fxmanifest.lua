fx_version 'cerulean'
lua54 'yes'
game 'gta5'

name 'ktx_claude_bridge'
author 'Ktox'
version '1.0.1'
description 'HTTP bridge for Claude Code, development tool only'

-- The helper holds the console buffer and is the only way this resource
-- can restart itself. Without it both fail later instead of here.
dependency 'ktx_bridge_helper'

server_scripts {
    'server/config.lua',
    'server/utils.lua',
    'server/console.lua',
    'server/relay.lua',
    'server/routes.lua',
    'server/http.lua',
}

client_scripts {
    'client/relay.lua',
}

-- exec_bridge.lua must be in files{} so other resources can load it client-side via shared_script '@ktx_claude_bridge/exec_bridge.lua'
files {
    'exec_bridge.lua',
}
