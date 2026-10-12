import { z } from 'zod';

/**
 * Shapes of the browser's WebAuthn responses (SimpleWebAuthn JSON encoding).
 * The cryptographic checks happen in @simplewebauthn/server; this only validates the envelope.
 */
const base64url = z.string().min(1).max(16_384).regex(/^[A-Za-z0-9_-]+={0,2}$/);
const credentialEnvelope = {
    id: base64url,
    rawId: base64url,
    authenticatorAttachment: z.enum(['platform', 'cross-platform']).optional(),
    clientExtensionResults: z.object({}),
    type: z.literal('public-key'),
};

export const authenticationResponseSchema = z.object({
    ...credentialEnvelope,
    response: z.object({
        clientDataJSON: base64url,
        authenticatorData: base64url,
        signature: base64url,
        userHandle: base64url.optional(),
    }),
});

export const registrationResponseSchema = z.object({
    ...credentialEnvelope,
    response: z.object({
        clientDataJSON: base64url,
        attestationObject: base64url,
        authenticatorData: base64url.optional(),
        transports: z.array(z.string().max(32)).max(16).optional(),
        publicKeyAlgorithm: z.number().int().optional(),
        publicKey: base64url.optional(),
    }),
});
