import * as Sentry from '@sentry/browser';

/**
 * Error reporting, enabled only when txAdmin injects Sentry settings.
 * No user info, cookies, headers, bodies or query strings are sent.
 */
export function startPanelSentry() {
    const config = window.txConsts.sentry;
    if (!config) return;
    Sentry.init({
        ...config,
        dataCollection: {
            userInfo: false,
            cookies: false,
            httpHeaders: false,
            httpBodies: [],
            urlQueryParams: false,
        },
        //An explicit null IP stops Sentry inferring the admin's address.
        initialScope: {
            user: { ip_address: null },
            tags: { surface: window.txConsts.isWebInterface ? 'web' : 'nui' },
        },
    });
}

/** Errors the top-level error boundary caught. */
export function capturePanelError(error: unknown) {
    Sentry.captureException(error, { tags: { area: 'boundary' } });
}
