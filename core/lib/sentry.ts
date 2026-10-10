import * as Sentry from '@sentry/node';
import { txEnv } from '@core/globalData';
import { readBuildCommit } from '@lib/stagedBuild';


/**
 * Error reporting is opt-in: nothing is sent unless TFADMIN_SENTRY_DSN is set.
 * The same settings are handed to the panel and the in-game menu.
 */
const dsn = process.env.TFADMIN_SENTRY_DSN?.trim() || undefined;
const commit = readBuildCommit(txEnv.txaPath);

export const sentryConfig = dsn ? {
    dsn,
    environment: process.env.TFADMIN_SENTRY_ENVIRONMENT?.trim() || 'production',
    release: commit ? `tfadmin@${commit}` : undefined,
} : undefined;


export const initSentry = () => {
    if (!sentryConfig) return;
    Sentry.init({
        ...sentryConfig,
        //This process hosts the whole server, so no auto-instrumentation and no
        //global handlers: txAdmin keeps its own uncaught error handling.
        defaultIntegrations: false,
        enableRuntimeChannelInjection: false,
        enhanceFetchErrorMessages: 'report-only',
        integrations: [
            Sentry.eventFiltersIntegration(),
            Sentry.functionToStringIntegration(),
            Sentry.linkedErrorsIntegration(),
            Sentry.dedupeIntegration(),
        ],
        dataCollection: {
            userInfo: false,
            cookies: false,
            httpHeaders: false,
            httpBodies: [],
            urlQueryParams: false,
        },
        initialScope: {
            tags: {
                txaVersion: txEnv.txaVersion,
                fxsVersion: txEnv.fxsVersionTag,
            },
        },
    });
}
