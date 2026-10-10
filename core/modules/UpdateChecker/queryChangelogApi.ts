const modulename = 'UpdateChecker';
import { z } from "zod";
import got from '@lib/got';
import { txEnv } from '@core/globalData';
import consoleFactory from '@lib/console';
import { UpdateDataType } from '@shared/otherTypes';
import { fromError } from 'zod-validation-error';
const console = consoleFactory(modulename);


//Schemas
const changelogRespSchema = z.object({
    recommended: z.coerce.number().positive(),
    optional: z.coerce.number().positive(),
    critical: z.coerce.number().positive(),
});

export const queryChangelogApi = async () => {
    //GET changelog data
    let apiResponse: z.infer<typeof changelogRespSchema>;
    try {
        //perform request - cache busting every ~1.4h
        const osTypeApiUrl = (txEnv.isWindows) ? 'win32' : 'linux';
        const cacheBuster = Math.floor(Date.now() / 5_000_000);
        const reqUrl = `https://changelogs-live.fivem.net/api/changelog/versions/${osTypeApiUrl}/server?${cacheBuster}`;
        const resp = await got(reqUrl).json()
        apiResponse = changelogRespSchema.parse(resp);
    } catch (error) {
        let msg = (error as Error).message;
        if(error instanceof z.ZodError){
            msg = fromError(error, { prefix: null }).message
        }
        console.verbose.warn(`Failed to retrieve FXServer update data with error: ${msg}`);
        return;
    }

    //Checking FXServer version
    let fxsUpdateData: UpdateDataType | undefined;
    try {
        if (txEnv.fxsVersion < apiResponse.critical) {
            if (apiResponse.critical > apiResponse.recommended) {
                fxsUpdateData = {
                    version: apiResponse.critical.toString(),
                    isImportant: true,
                }
            } else {
                fxsUpdateData = {
                    version: apiResponse.recommended.toString(),
                    isImportant: true,
                }
            }
        } else if (txEnv.fxsVersion < apiResponse.recommended) {
            fxsUpdateData = {
                version: apiResponse.recommended.toString(),
                isImportant: true,
            };
        } else if (txEnv.fxsVersion < apiResponse.optional) {
            fxsUpdateData = {
                version: apiResponse.optional.toString(),
                isImportant: false,
            };
        }
    } catch (error) {
        console.warn('Error checking for FXServer updates.');
        console.verbose.dir(error);
    }

    return fxsUpdateData;
};
