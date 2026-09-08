fx_version 'cerulean'
lua54 'yes'
game 'gta5'

name 'ktx_bridge_helper'
author 'Ktox'
version '1.0.0'
description 'Console capture and restart helper for ktx_claude_bridge. Do not restart it.'

server_scripts {
    'server.lua',
}

server_exports {
    'getConsole',
    'addConsole',
    'clearConsole',
    'getConsoleCount',
    'restartBridge',
}
