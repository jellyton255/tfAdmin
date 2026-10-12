const modulename = 'WebServer:AuthPasskeyManage';
import { generateRegistrationOptions, verifyRegistrationResponse } from '@simplewebauthn/server';
import { isoBase64URL } from '@simplewebauthn/server/helpers';
import { z } from 'zod';
import consoleFactory from '@lib/console';
import { AuthedCtx } from '@modules/WebServer/ctxTypes';
import { defaultPasskeyName, passkeyNameSchema } from '@modules/WebServer/passkeys/PasskeyStore';
import { resolveRelyingParty } from '@modules/WebServer/passkeys/relyingParty';
import { registrationResponseSchema } from '@modules/WebServer/passkeys/responseSchemas';
import { ApiPasskeyListResp, ApiPasskeyRegisterResp } from '@shared/authApiTypes';
import { GenericApiOkResp } from '@shared/genericApiTypes';
import { passkeyUnavailableError } from './passkeyLogin';
const console = consoleFactory(modulename);

const REGISTRATION_TTL_MS = 5 * 60_000;

const registerBodySchema = z.object({
    response: registrationResponseSchema,
});
const renameBodySchema = z.object({
    id: z.string().min(1),
    name: passkeyNameSchema,
});
export type ApiPasskeyRenameReqSchema = z.infer<typeof renameBodySchema>;
const removeBodySchema = z.object({
    id: z.string().min(1),
});
export type ApiPasskeyRemoveReqSchema = z.infer<typeof removeBodySchema>;


/**
 * Lists your own passkeys.
 */
export async function AuthPasskeyList(ctx: AuthedCtx) {
    const sessAuth = ctx.sessTools.get()?.auth;
    return ctx.send<ApiPasskeyListResp>({
        passkeys: txCore.webServer.passkeyStore.list(ctx.admin.name),
        currentPasskeyId: sessAuth?.type === 'passkey' ? sessAuth.credentialId : null,
        userHandle: txCore.webServer.passkeyStore.getUserHandle(ctx.admin.name) ?? null,
    });
}


/**
 * Starts registering a new passkey for your account.
 * The challenge is kept in your session until the browser answers.
 */
export async function AuthPasskeyRegisterOptions(ctx: AuthedCtx) {
    const sendError = (error: string) => ctx.send<{ error: string }>({ error });
    const currSess = ctx.sessTools.get();
    if (!currSess?.auth) return sendError('Passkeys can only be added from the web panel.');
    if (ctx.admin.isTempPassword) return sendError('Change your temporary password first.');
    const rp = resolveRelyingParty(ctx.get('origin'));
    if (!rp) return sendError(passkeyUnavailableError);

    const passkeyStore = txCore.webServer.passkeyStore;
    const userHandle = passkeyStore.getOrCreateUserHandle(ctx.admin.name);
    const options = await generateRegistrationOptions({
        rpName: txConfig.general.serverName || 'tfAdmin',
        rpID: rp.rpID,
        userID: isoBase64URL.toBuffer(userHandle),
        userName: ctx.admin.name,
        userDisplayName: ctx.admin.name,
        attestationType: 'none',
        excludeCredentials: passkeyStore.listRaw(ctx.admin.name)
            .filter((p) => p.rpId === rp.rpID)
            .map((p) => ({ id: p.id, transports: p.transports })),
        authenticatorSelection: {
            residentKey: 'required',
            userVerification: 'required',
        },
    });

    ctx.sessTools.set({
        ...currSess,
        tmpPasskeyRegistration: {
            challenge: options.challenge,
            origin: rp.origin,
            rpID: rp.rpID,
            expiresAt: Date.now() + REGISTRATION_TTL_MS,
        },
    });
    return ctx.send({ options });
}


/**
 * Finishes registering a new passkey for your account.
 */
export async function AuthPasskeyRegister(ctx: AuthedCtx) {
    const sendError = (error: string) => ctx.send<ApiPasskeyRegisterResp>({ error });
    const currSess = ctx.sessTools.get();
    const pending = currSess?.tmpPasskeyRegistration;
    if (!currSess?.auth || !pending) return sendError('No passkey registration in progress.');

    //The challenge is single-use
    const { tmpPasskeyRegistration: _consumed, ...sessWithoutPending } = currSess;
    ctx.sessTools.set(sessWithoutPending);
    if (pending.expiresAt < Date.now()) return sendError('The passkey registration expired, please try again.');

    const schemaRes = registerBodySchema.safeParse(ctx.request.body);
    if (!schemaRes.success) {
        return sendError(`Invalid request body: ${schemaRes.error.message}`);
    }

    let registrationInfo;
    try {
        const verification = await verifyRegistrationResponse({
            response: schemaRes.data.response,
            expectedChallenge: pending.challenge,
            expectedOrigin: pending.origin,
            expectedRPID: pending.rpID,
            requireUserVerification: true,
        });
        if (!verification.verified) return sendError('The passkey could not be verified.');
        registrationInfo = verification.registrationInfo;
    } catch (error) {
        console.warn(`Passkey registration failed for ${ctx.admin.name}: ${(error as Error).message}`);
        return sendError('The passkey could not be verified.');
    }

    const { credential, aaguid, credentialDeviceType, credentialBackedUp } = registrationInfo;
    const transports = credential.transports ?? [];
    try {
        const passkey = txCore.webServer.passkeyStore.add({
            id: credential.id,
            admin: ctx.admin.name,
            publicKey: isoBase64URL.fromBuffer(credential.publicKey),
            counter: credential.counter,
            transports,
            deviceType: credentialDeviceType,
            backedUp: credentialBackedUp,
            aaguid,
            rpId: pending.rpID,
            name: defaultPasskeyName(aaguid, credentialDeviceType, transports),
        });
        ctx.admin.logAction(`Added passkey "${passkey.name}" for ${passkey.rpId}.`);
        return ctx.send<ApiPasskeyRegisterResp>({ passkey });
    } catch (error) {
        return sendError((error as Error).message);
    }
}


/**
 * Renames one of your passkeys.
 */
export async function AuthPasskeyRename(ctx: AuthedCtx) {
    const schemaRes = renameBodySchema.safeParse(ctx.request.body);
    if (!schemaRes.success) {
        return ctx.send<GenericApiOkResp>({ error: 'Passkey names must be 1 to 48 characters long.' });
    }
    const { id, name } = schemaRes.data;
    try {
        if (!txCore.webServer.passkeyStore.rename(ctx.admin.name, id, name)) {
            return ctx.send<GenericApiOkResp>({ error: 'Passkey not found.' });
        }
    } catch (error) {
        return ctx.send<GenericApiOkResp>({ error: (error as Error).message });
    }
    return ctx.send<GenericApiOkResp>({ success: true });
}


/**
 * Removes one of your passkeys, which also ends the sessions started with it.
 */
export async function AuthPasskeyRemove(ctx: AuthedCtx) {
    const schemaRes = removeBodySchema.safeParse(ctx.request.body);
    if (!schemaRes.success) {
        return ctx.send<GenericApiOkResp>({ error: 'Invalid request body.' });
    }
    const passkeyStore = txCore.webServer.passkeyStore;
    const passkey = passkeyStore.getById(schemaRes.data.id);
    try {
        if (!passkey || !passkeyStore.remove(ctx.admin.name, passkey.id)) {
            return ctx.send<GenericApiOkResp>({ error: 'Passkey not found.' });
        }
    } catch (error) {
        return ctx.send<GenericApiOkResp>({ error: (error as Error).message });
    }
    ctx.admin.logAction(`Removed passkey "${passkey.name}".`);
    return ctx.send<GenericApiOkResp>({ success: true });
}
