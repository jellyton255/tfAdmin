-- Modifying or rewriting this resource for local use only is strongly discouraged.
-- Feel free to open an issue or pull request in our GitHub.
-- Official discord server: https://discord.gg/txAdmin

author 'Tabarra'
description 'The official FiveM/RedM server web/in-game management platform.'
repository 'https://github.com/tabarra/txAdmin'
version 'REPLACE-VERSION'
ui_label 'txAdmin'

fx_version 'cerulean'
game 'common'
-- lua54 'yes' --TODO: check if it works
-- node_version '22'

-- NOTE: All server_scripts will be executed both on monitor and server mode 
-- NOTE: Due to global package constraints, js scripts will be loaded from entrypoint.js
-- NOTE: Due to people drag-n-dropping their artifacts, we can't do globbing
shared_scripts {
    'resource/shared.lua'
}

server_scripts {
    'entrypoint.js',
    'resource/sv_main.lua', --must run first
    'resource/sv_logger.lua',
    'resource/sv_resources.lua',
    'resource/sv_playerlist.lua',
    'resource/sv_initialData.lua',
    'resource/sv_characters.lua',
    'resource/sv_services.lua',
    'resource/sv_exports.lua'
}

client_scripts {
    'resource/cl_main.lua',
    'resource/cl_logger.lua'
}

