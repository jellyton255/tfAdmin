import * as Sentry from "@sentry/browser";

export interface MenuSentryConfig {
  dsn: string;
  environment: string;
  release?: string;
}

/*
 * Error reporting for the in-game menu, enabled only when the server context carries Sentry
 * settings. This runs on player clients, so no user info or request data is sent.
 */
let started = false;

export function startMenuSentry(config: MenuSentryConfig | undefined) {
  if (started || !config) return;
  started = true;
  Sentry.init({
    ...config,
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
    },
    //An explicit null IP stops Sentry inferring the player's address.
    initialScope: { user: { ip_address: null }, tags: { surface: "menu" } },
  });
}

/** Errors a menu error boundary caught. */
export function captureMenuError(error: unknown, area: string) {
  Sentry.captureException(error, { tags: { area } });
}
