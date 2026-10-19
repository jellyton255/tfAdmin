import { z } from "zod";
import { typeDefinedConfig, typeNullableConfig } from "./utils";
import { SYM_FIXER_DEFAULT } from "@lib/symbols";

//everfall: where the Staff Activity page reads ticket and Discord activity from


const ticketsUrl = typeDefinedConfig({
    name: 'Tickets Agent API URL',
    default: 'https://everfallcommunity.com/api/tickets/agent',
    validator: z.string().url(),
    fixer: SYM_FIXER_DEFAULT,
});

const ticketsToken = typeNullableConfig({
    name: 'Tickets Agent Token',
    default: null,
    validator: z.string().min(1).nullable(),
    fixer: SYM_FIXER_DEFAULT,
});

const discordUrl = typeDefinedConfig({
    name: 'EF Bot API URL',
    default: 'http://127.0.0.1:46946',
    validator: z.string().url(),
    fixer: SYM_FIXER_DEFAULT,
});

const discordSecret = typeNullableConfig({
    name: 'EF Bot Staff Activity Secret',
    default: null,
    validator: z.string().min(1).nullable(),
    fixer: SYM_FIXER_DEFAULT,
});


export default {
    ticketsUrl,
    ticketsToken,
    discordUrl,
    discordSecret,
} as const;
