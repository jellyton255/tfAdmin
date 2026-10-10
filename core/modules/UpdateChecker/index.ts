const modulename = 'UpdateChecker';
import consoleFactory from '@lib/console';
import { UpdateDataType } from '@shared/otherTypes';
import { UpdateAvailableEventType } from '@shared/socketioTypes';
import { queryChangelogApi } from './queryChangelogApi';
const console = consoleFactory(modulename);


/**
 * Checks the Cfx changelog API for FXServer artifact updates.
 * tfAdmin does not follow the stock txAdmin release stream: its own build and upstream
 * merge status come from @lib/tfadminStatus instead.
 */
export default class UpdateChecker {
    //Never set; kept because the panel boot data (getReactIndex) still reads it
    readonly txaUpdateData: UpdateDataType | undefined = undefined;
    fxsUpdateData?: UpdateDataType;

    constructor() {
        //Check for updates ASAP
        setImmediate(() => {
            this.checkChangelog();
        });

        //Check again every 15 mins
        setInterval(() => {
            this.checkChangelog();
        }, 15 * 60_000);
    }


    /**
     * Check for FXServer updates
     */
    async checkChangelog() {
        const fxsUpdate = await queryChangelogApi();
        if (!fxsUpdate) return;
        this.fxsUpdateData = fxsUpdate;
        console.verbose.debug(`FXServer update available: ${fxsUpdate.version}`);
        txCore.webServer.webSocket.pushEvent<UpdateAvailableEventType>('updateAvailable', {
            fxserver: this.fxsUpdateData,
        });
    }
};
