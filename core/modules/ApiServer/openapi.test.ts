/**
 * Keeps docs/openapi.json in sync with the builder. When this fails, regenerate with:
 *   UPDATE_OPENAPI=1 pnpm --filter txadmin-core exec vitest run modules/ApiServer/openapi.test.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildOpenApiDocument } from './openapi';
import apiV1Router from './router';

const specPath = path.resolve(__dirname, '../../../docs/openapi.json');

describe('openapi document', () => {
    const doc = buildOpenApiDocument();

    it('describes every mounted route and nothing else', () => {
        const mounted = new Set<string>();
        for (const layer of apiV1Router().stack) {
            const specPathName = layer.path.replace('/api/v1', '').replace(/:(\w+)/g, '{$1}');
            for (const method of layer.methods) {
                if (method === 'HEAD') continue;
                mounted.add(`${method.toLowerCase()} ${specPathName}`);
            }
        }
        const documented = new Set<string>();
        for (const [p, methods] of Object.entries(doc.paths)) {
            for (const method of Object.keys(methods)) documented.add(`${method} ${p}`);
        }
        expect([...documented].sort()).toEqual([...mounted].sort());
    });

    it('only references schemas that exist', () => {
        const names = new Set(Object.keys(doc.components.schemas));
        const refs = JSON.stringify(doc).match(/#\/components\/schemas\/(\w+)/g) ?? [];
        for (const r of refs) {
            expect(names.has(r.split('/').pop()!), r).toBe(true);
        }
    });

    it('matches the committed docs/openapi.json', () => {
        const serialized = JSON.stringify(doc, null, 2) + '\n';
        if (process.env.UPDATE_OPENAPI) {
            fs.writeFileSync(specPath, serialized);
        }
        const committed = fs.existsSync(specPath) ? fs.readFileSync(specPath, 'utf8') : '';
        expect(committed, 'docs/openapi.json is stale, regenerate with UPDATE_OPENAPI=1 (see file header)').toBe(serialized);
    });
});
