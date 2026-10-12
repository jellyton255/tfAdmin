import { z } from 'zod';
import type { PasskeyProvider } from '@shared/authApiTypes';
import providersJson from './passkeyProviders.json';

/**
 * Passkey providers (Apple Passwords, Google Password Manager, 1Password...) by authenticator AAGUID.
 * The list is a snapshot of the community passkey provider AAGUID list,
 * refreshed with scripts/everfall/update-passkey-providers.mjs.
 */
const svgDataUri = z.string().startsWith('data:image/svg+xml;base64,');
const providersSchema = z.record(z.string(), z.object({
    name: z.string().min(1),
    icon_light: svgDataUri.optional(),
    icon_dark: svgDataUri.optional(),
}));
const providers = providersSchema.parse(providersJson);

export const getPasskeyProvider = (aaguid: string): PasskeyProvider | null => {
    const entry = providers[aaguid.toLowerCase()];
    if (!entry) return null;
    const iconLight = entry.icon_light ?? entry.icon_dark ?? null;
    const iconDark = entry.icon_dark ?? entry.icon_light ?? null;
    return { name: entry.name, iconLight, iconDark };
};
