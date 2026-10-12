const modulename = 'WebServer:AuthPasskeyLogin';
import { generateAuthenticationOptions, verifyAuthenticationResponse } from '@simplewebauthn/server';
import { isoBase64URL } from '@simplewebauthn/server/helpers';
import { z } from 'zod';
import { txEnv } from '@core/globalData';
import consoleFactory from '@lib/console';
import { AuthedAdmin, PasskeySessAuthType } from '@modules/WebServer/authLogic';
import { InitializedCtx } from '@modules/WebServer/ctxTypes';
import { resolveRelyingParty } from '@modules/WebServer/passkeys/relyingParty';
import { authenticationResponseSchema } from '@modules/WebServer/passkeys/responseSchemas';
import { ReactAuthDataType } from '@shared/authApiTypes';
const console = consoleFactory(modulename);

export const passkeyUnavailableError = 'Passkeys need the panel to be opened over HTTPS with a domain name.';

const verifyBodySchema = z.object({
    response: authenticationResponseSchema,
});


/**
 * Returns the options for a passkey login, with a one-time challenge.
 * No credentials are listed, so the browser offers any discoverable passkey for this site.
 */
export async function AuthPasskeyLoginOptions(ctx: InitializedCtx) {
    const rp = resolveRelyingParty(ctx.get('origin'));
    if (!rp) {
        return ctx.send({ error: passkeyUnavailableError });
    }
    if (!txCore.adminStore.hasAdmins()) {
        return ctx.send({ error: 'no_admins_setup' });
    }

    const options = await generateAuthenticationOptions({
        rpID: rp.rpID,
        userVerification: 'required',
    });
    txCore.webServer.passkeyStore.issueLoginChallenge(options.challenge);
    return ctx.send({ options });
}


/**
 * Verifies a passkey login and starts the session.
 */
export async function AuthPasskeyLoginVerify(ctx: InitializedCtx) {
    const sendError = (error: string) => ctx.send<{ error: string }>({ error });

    //Check UI version
    const { uiVersion } = ctx.request.query;
    if (uiVersion && uiVersion !== txEnv.txaVersion) {
        return sendError('refreshToUpdate');
    }

    const rp = resolveRelyingParty(ctx.get('origin'));
    if (!rp) return sendError(passkeyUnavailableError);
    if (!txCore.adminStore.hasAdmins()) return sendError('no_admins_setup');

    const schemaRes = verifyBodySchema.safeParse(ctx.request.body);
    if (!schemaRes.success) {
        return sendError(`Invalid request body: ${schemaRes.error.message}`);
    }
    const { response } = schemaRes.data;

    //The passkey must belong to this site, and the user handle must match its owner
    const passkeyStore = txCore.webServer.passkeyStore;
    const passkey = passkeyStore.getById(response.id);
    if (
        !passkey
        || passkey.rpId !== rp.rpID
        || response.response.userHandle !== passkeyStore.getUserHandle(passkey.admin)
    ) {
        console.warn(`Unknown passkey from: ${ctx.ip}`);
        //the client asks the browser to forget it (WebAuthn signal API)
        return sendError('unknown_passkey');
    }
    const vaultAdmin = txCore.adminStore.getAdminByName(passkey.admin);
    if (!vaultAdmin) {
        return sendError('unknown_passkey');
    }

    let challengeAccepted = false;
    try {
        const verification = await verifyAuthenticationResponse({
            response,
            expectedChallenge: (challenge) => {
                challengeAccepted = passkeyStore.consumeLoginChallenge(challenge);
                return challengeAccepted;
            },
            expectedOrigin: rp.origin,
            expectedRPID: rp.rpID,
            credential: {
                id: passkey.id,
                publicKey: isoBase64URL.toBuffer(passkey.publicKey),
                counter: passkey.counter,
                transports: passkey.transports,
            },
            requireUserVerification: true,
        });
        if (!verification.verified) {
            return sendError('The passkey could not be verified.');
        }
        passkeyStore.recordUse(passkey.id, verification.authenticationInfo.newCounter);
    } catch (error) {
        if (!challengeAccepted) {
            //the client requests a fresh challenge and tries again
            return sendError('challenge_expired');
        }
        console.warn(`Passkey verification failed for ${vaultAdmin.name} from ${ctx.ip}: ${(error as Error).message}`);
        return sendError('The passkey could not be verified.');
    }

    //Setting up session
    const sessData = {
        type: 'passkey',
        username: vaultAdmin.name,
        credentialId: passkey.id,
        expiresAt: false,
        csrfToken: txCore.adminStore.genCsrfToken(),
    } satisfies PasskeySessAuthType;
    ctx.sessTools.set({ auth: sessData });

    const authedAdmin = new AuthedAdmin(vaultAdmin, sessData.csrfToken);
    authedAdmin.logAction(`logged in from ${ctx.ip} via passkey "${passkey.name}"`);
    txCore.apiServer?.publishEvent('admin.login', { name: vaultAdmin.name, method: 'passkey', ip: ctx.ip }); // everfall:api
    txCore.metrics.txRuntime.loginOrigins.count(ctx.txVars.hostType);
    txCore.metrics.txRuntime.loginMethods.count('passkey');
    return ctx.send<ReactAuthDataType>(authedAdmin.getAuthData());
}
