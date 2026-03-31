fx_version 'cerulean'
lua54 'yes'
game 'gta5'

name 'ktx_bridge_helper'
author 'Ktox'
version '0.1.0'
description 'Console capture + restart helper for ktx_claude_bridge — DO NOT RESTART'

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
