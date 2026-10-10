import { SYM_SYSTEM_AUTHOR } from '@lib/symbols';

const REPORT_TIMEOUT_MS = 1500;
const REPORT_MAX_AGE_MS = 1000;


/**
 * Asks FXServer for a fresh resource report (txaReportResources) and waits for it to land in
 * FxResources.resourceReport via the intercom `resources` scope.
 * Resolves to null if the command could not be sent or the report did not arrive in time.
 */
export const requestResourceReport = () => {
    const sent = txCore.fxRunner.sendCommand('txaReportResources', [], SYM_SYSTEM_AUTHOR);
    if (!sent) return Promise.resolve(null);
    const requestedAt = Date.now();
    return new Promise<any[] | null>((resolve) => {
        const poll = setInterval(() => {
            const report = txCore.fxResources.resourceReport;
            if (
                report
                && report.ts.getTime() >= requestedAt - REPORT_MAX_AGE_MS
                && Array.isArray(report.resources)
            ) {
                clearInterval(poll);
                clearTimeout(timeout);
                resolve(report.resources);
            }
        }, 50);
        const timeout = setTimeout(() => {
            clearInterval(poll);
            resolve(null);
        }, REPORT_TIMEOUT_MS);
    });
};
