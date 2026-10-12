import { z } from "zod";
import { typeDefinedConfig } from "./utils";
import { SYM_FIXER_DEFAULT } from "@lib/symbols";


const menuEnabled = typeDefinedConfig({
    name: 'Menu Enabled',
    default: true,
    validator: z.boolean(),
    fixer: SYM_FIXER_DEFAULT,
});

const menuAlignRight = typeDefinedConfig({
    name: 'Align Menu Right',
    default: false,
    validator: z.boolean(),
    fixer: SYM_FIXER_DEFAULT,
});

const menuPageKey = typeDefinedConfig({
    name: 'Menu Page Switch Key',
    default: 'Tab',
    validator: z.string().min(1),
    fixer: SYM_FIXER_DEFAULT,
});

const playerModePtfx = typeDefinedConfig({
    name: 'Player Mode Change Effect',
    default: true,
    validator: z.boolean(),
    fixer: SYM_FIXER_DEFAULT,
});

const hideAdminInPunishments = typeDefinedConfig({
    name: 'Hide Admin Name In Punishments',
    default: true,
    validator: z.boolean(),
    fixer: SYM_FIXER_DEFAULT,
});

const hideAdminInMessages = typeDefinedConfig({
    name: 'Hide Admin Name In Messages',
    default: false,
    validator: z.boolean(),
    fixer: SYM_FIXER_DEFAULT,
});


export default {
    menuEnabled,
    menuAlignRight,
    menuPageKey,
    playerModePtfx,
    hideAdminInPunishments,
    hideAdminInMessages,
} as const;
