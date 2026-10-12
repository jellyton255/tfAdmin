import {
    browserSupportsWebAuthn,
    sendSignal,
    WebAuthnError,
    type PublicKeyCredentialCreationOptionsJSON,
    type PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/browser';

export type PasskeyLoginOptionsResp = { error: string } | { options: PublicKeyCredentialRequestOptionsJSON };
export type PasskeyRegisterOptionsResp = { error: string } | { options: PublicKeyCredentialCreationOptionsJSON };

/**
 * Passkeys are bound to a domain name and need a secure context,
 * so they can't be used when the panel is opened by IP or over plain http.
 */
export function canUsePasskeys() {
    const hostname = window.location.hostname;
    const isIpAddress = /^\d+\.\d+\.\d+\.\d+$/.test(hostname) || hostname.includes(':') || hostname.startsWith('[');
    return window.isSecureContext && !isIpAddress && browserSupportsWebAuthn();
}

/**
 * Returns whether the error means the user dismissed the passkey prompt or another ceremony replaced it.
 */
export function isPasskeyPromptDismissed(error: unknown) {
    if (error instanceof WebAuthnError && error.code === 'ERROR_CEREMONY_ABORTED') return true;
    return error instanceof Error && (error.name === 'NotAllowedError' || error.name === 'AbortError');
}

/**
 * Tells the browser's passkey manager that this server no longer accepts a passkey,
 * so it stops offering it. Browsers without the WebAuthn signal API ignore it.
 */
export function signalUnknownPasskey(credentialID: string) {
    sendSignal({
        signalName: 'unknownCredential',
        rpID: window.location.hostname,
        credentialID,
    }).catch(() => { });
}

/**
 * Tells the browser's passkey manager which of the admin's passkeys this server still accepts.
 */
export function signalAcceptedPasskeys(userID: string, credentialIDs: string[]) {
    sendSignal({
        signalName: 'allAcceptedCredentials',
        rpID: window.location.hostname,
        userID,
        allAcceptedCredentialIDs: credentialIDs,
    }).catch(() => { });
}
