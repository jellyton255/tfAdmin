import { z } from "zod";
import { typeDefinedConfig } from "./utils";
import { SYM_FIXER_DEFAULT } from "@lib/symbols";


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
    hideAdminInPunishments,
    hideAdminInMessages,
} as const;
