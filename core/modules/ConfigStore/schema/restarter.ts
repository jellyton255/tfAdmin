import { z } from "zod";
import { typeDefinedConfig } from "./utils";
import { SYM_FIXER_DEFAULT } from "@lib/symbols";
import { parseSchedule, regexHoursMinutes } from "@lib/misc";

export const polishScheduleTimesArray = (input: string[]) => {
    return parseSchedule(input).valid.map((v) => v.string);
};

const schedule = typeDefinedConfig({
    name: 'Restart Schedule',
    default: [],
    validator: z.string().regex(regexHoursMinutes).array().transform(polishScheduleTimesArray),
    fixer: (input: any) => {
        if(!Array.isArray(input)) return [];
        return polishScheduleTimesArray(input);
    },
});

const timeZone = typeDefinedConfig({
    name: 'Restart Schedule Time Zone',
    default: Intl.DateTimeFormat().resolvedOptions().timeZone,
    validator: z.string().refine((tz) => {
        //Intl throws a RangeError for unknown time zones
        try {
            new Intl.DateTimeFormat('en-US', { timeZone: tz });
            return true;
        } catch {
            return false;
        }
    }, 'Invalid IANA time zone'),
    fixer: SYM_FIXER_DEFAULT,
});

const bootGracePeriod = typeDefinedConfig({
    name: 'Boot Grace Period',
    default: 45,
    validator: z.number().int().min(15),
    fixer: SYM_FIXER_DEFAULT,
});

const resourceStartingTolerance = typeDefinedConfig({
    name: 'Resource Starting Tolerance',
    default: 90,
    validator: z.number().int().min(30),
    fixer: SYM_FIXER_DEFAULT,
});


export default {
    schedule,
    timeZone,
    bootGracePeriod,
    resourceStartingTolerance,
} as const;
