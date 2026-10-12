// Refreshes the passkey provider names and logos shown in the panel's Passkeys tab.
// Source: the community passkey provider AAGUID list, which is meant for naming passkeys in
// account settings: https://github.com/passkeydeveloper/passkey-authenticator-aaguids
// Usage: node scripts/everfall/update-passkey-providers.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SOURCE_URL = 'https://raw.githubusercontent.com/passkeydeveloper/passkey-authenticator-aaguids/main/aaguid.json';
const TARGET = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../core/modules/WebServer/passkeys/passkeyProviders.json');

const response = await fetch(SOURCE_URL);
if (!response.ok) throw new Error(`Download failed: HTTP ${response.status}`);
const list = await response.json();

// The maintainers retire the list by replacing it with an empty object; keep the current copy then.
const entries = Object.entries(list);
if (!entries.length) throw new Error('The provider list is empty, so it may have been retired. Keeping the current file.');

const providers = {};
for (const [aaguid, entry] of entries.sort(([a], [b]) => a.localeCompare(b))) {
    if (typeof entry?.name !== 'string' || !entry.name) continue;
    providers[aaguid.toLowerCase()] = {
        name: entry.name,
        ...(typeof entry.icon_light === 'string' && { icon_light: entry.icon_light }),
        ...(typeof entry.icon_dark === 'string' && { icon_dark: entry.icon_dark }),
    };
}
fs.writeFileSync(TARGET, JSON.stringify(providers, null, 2) + '\n');
console.log(`Saved ${Object.keys(providers).length} passkey providers to ${path.relative(process.cwd(), TARGET)}`);
