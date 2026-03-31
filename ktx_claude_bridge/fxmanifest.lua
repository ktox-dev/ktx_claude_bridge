fx_version 'cerulean'
lua54 'yes'
game 'gta5'

name 'ktx_claude_bridge'
author 'Ktox'
version '0.1.0'
description 'HTTP bridge for Claude Code AI assistant — DEV ONLY'

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
