#!/usr/bin/env node
// Pre-stage smoke test for a built tfAdmin bundle (dist/).
//
//   node scripts/everfall/smoke-core-bundle.mjs [--repo <dir>] [--dist <dir>] [--work-dir <dir>] [--no-boot]
//
// 1. Scope scan: parses dist/core/index.js and fails on any free identifier that is not a
//    known Node, FXServer or txAdmin global. esbuild does not typecheck, so a missing import
//    builds fine: the bundle keeps the bare name and renames the real binding (txEnv -> txEnv2).
// 2. Boot test: loads the bundle in a child node process with stubbed FXServer natives, a
//    scratch txData and a free loopback port, and waits for the panel to answer /login.
//    No FXServer starts (a new profile stays in setup mode) and no Dev2/Main port is used.
//
// Exits 0 when both pass, 1 on any failure. --repo defaults to this file's repository and is
// used to resolve eslint and core/global.d.ts, so an installed copy of this script also works.
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

// Free identifiers that are fine at runtime even though Node does not define them.
// Every entry is a third-party reference guarded by a runtime check (try/catch, `in` test,
// environment detection) or a bundler define that is only read behind `typeof`.
const THIRD_PARTY_GUARDED = new Set([
    'define', 'window', 'self', 'document', 'localStorage', 'XMLHttpRequest', 'HTMLElement',
    'DedicatedWorkerGlobalScope', 'EdgeRuntime', 'Bun', 'AsyncIterator', 'WebSocketPair',
    '__magic__', 'esbuildDetection',
]);
// Sentry SDK build flags, always read behind a `typeof` check.
const SENTRY_BUILD_FLAG = /^__SENTRY_[A-Z_]+__$/;

// Known defects in code we have not fixed yet, with the number of free references each one
// makes today. Each only throws on a rare path. A higher count fails the scan, so a new missing
// `sendTypedResp` declaration elsewhere is still caught. Remove an entry once its fix ships.
const KNOWN_DEFECTS = new Map([
    ['sendTypedResp', { max: 1, note: 'core/routes/serverLogPartial.js permission-denied branch (upstream defect)' }],
    ['lodash', { max: 1, note: 'core/modules/Database/migrations.js v0 database wipe (upstream defect)' }],
    ['textLen', { max: 3, note: 'eastasianwidth implicit global assignment (sloppy mode, works)' }],
]);

const BOOT_TIMEOUT_MS = 60_000;
const BOOT_FAILURE_PATTERN = /ReferenceError|is not defined|TypeError|Uncaught|unhandledRejection|uncaughtException/;

function parseArgs(argv) {
    const scriptRepo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
    const args = { repo: scriptRepo, dist: undefined, workDir: undefined, boot: true, bootChild: undefined };
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '--repo') args.repo = path.resolve(argv[++i]);
        else if (arg === '--dist') args.dist = path.resolve(argv[++i]);
        else if (arg === '--work-dir') args.workDir = path.resolve(argv[++i]);
        else if (arg === '--no-boot') args.boot = false;
        else if (arg === '--boot-child') args.bootChild = path.resolve(argv[++i]);
        else throw new Error(`unknown option: ${arg}`);
    }
    args.dist ??= path.join(args.repo, 'dist');
    return args;
}

function log(message) {
    console.log(`[smoke] ${message}`);
}

/**
 * Names declared by `declare function X` / `declare const X` in core/global.d.ts: the FXServer
 * natives and the txCore/txConfig/txManager globals the core sets up at boot.
 */
function readDeclaredHostGlobals(repo) {
    const source = fs.readFileSync(path.join(repo, 'core', 'global.d.ts'), 'utf8');
    return new Set([...source.matchAll(/^declare (?:function|const) (\w+)/gm)].map((match) => match[1]));
}

function scanBundle(repo, bundlePath) {
    const { Linter } = createRequire(path.join(repo, 'package.json'))('eslint');
    const code = fs.readFileSync(bundlePath, 'utf8');
    const linter = new Linter();
    const fatal = linter
        .verify(code, { languageOptions: { ecmaVersion: 'latest', sourceType: 'script' } })
        .filter((message) => message.fatal);
    if (fatal.length) {
        return [`bundle does not parse: ${fatal[0].message} (line ${fatal[0].line})`];
    }

    const { scopeManager } = linter.getSourceCode();
    const declared = new Set();
    for (const scope of scopeManager.scopes) {
        for (const variable of scope.variables) declared.add(variable.name);
    }

    const allowed = new Set([
        ...Object.getOwnPropertyNames(globalThis),
        'require', 'module', 'exports', '__filename', '__dirname',
        ...readDeclaredHostGlobals(repo),
        ...THIRD_PARTY_GUARDED,
    ]);

    const unresolved = new Map();
    for (const reference of scopeManager.globalScope.through) {
        const { name, parent, range } = reference.identifier;
        if (allowed.has(name) || SENTRY_BUILD_FLAG.test(name)) continue;
        if (parent?.type === 'UnaryExpression' && parent.operator === 'typeof') continue;
        const entry = unresolved.get(name) ?? { count: 0, offset: range[0] };
        entry.count++;
        unresolved.set(name, entry);
    }

    const failures = [];
    for (const [name, { count, offset }] of unresolved) {
        const known = KNOWN_DEFECTS.get(name);
        if (known && count <= known.max) {
            log(`known defect, allowed: '${name}' x${count} (${known.note})`);
            continue;
        }
        const renamed = [...declared].filter((candidate) => new RegExp(`^${name.replace(/\$/g, '\\$')}\\d+$`).test(candidate));
        const context = code.slice(Math.max(0, offset - 80), offset + 40).replace(/\s+/g, ' ');
        const hint = renamed.length
            ? `esbuild renamed a binding to ${renamed.slice(0, 3).join(', ')}, so this is almost certainly a missing import`
            : 'not a Node, FXServer or txAdmin global';
        failures.push(`'${name}' is referenced ${count}x but never defined; ${hint}\n        near: …${context}…`);
    }
    return failures;
}

// FXServer and txAdmin defaults live in these ranges; never borrow one even briefly.
const isReservedPort = (port) => (port >= 30000 && port < 30300) || (port >= 40000 && port < 40300);

async function getFreePort() {
    let port;
    do {
        port = await getEphemeralPort();
    } while (isReservedPort(port));
    return port;
}

function getEphemeralPort() {
    return new Promise((resolve, reject) => {
        const server = net.createServer();
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const { port } = server.address();
            server.close(() => resolve(port));
        });
    });
}

async function waitForLogin(url, child, deadline) {
    while (Date.now() < deadline && child.exitCode === null) {
        try {
            const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
            if (response.status === 200) return true;
        } catch {
            // not listening yet
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
    }
    return false;
}

async function stopChild(child) {
    if (child.exitCode !== null) return;
    const exited = new Promise((resolve) => child.once('exit', resolve));
    child.kill('SIGTERM');
    const timer = setTimeout(() => child.kill('SIGKILL'), 10_000);
    await exited;
    clearTimeout(timer);
}

async function bootBundle(dist, workDir) {
    // The core writes runtime files next to itself, so boot a copy and keep dist/ clean.
    const monitorDir = path.join(workDir, 'monitor');
    const dataDir = path.join(workDir, 'txData');
    const citizenDir = path.join(workDir, 'fxserver', 'citizen');
    fs.cpSync(dist, monitorDir, { recursive: true });
    fs.mkdirSync(dataDir, { recursive: true });
    fs.mkdirSync(citizenDir, { recursive: true });

    const port = await getFreePort();
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url), '--boot-child', path.join(monitorDir, 'core', 'index.js')], {
        cwd: workDir,
        // Minimal environment: no inherited TXHOST_*, TXDEV_*, TFADMIN_* or Sentry settings.
        env: {
            PATH: process.env.PATH,
            HOME: workDir,
            SMOKE_CITIZEN_ROOT: citizenDir,
            TXHOST_DATA_PATH: dataDir,
            TXHOST_TXA_PORT: String(port),
            TXHOST_INTERFACE: '127.0.0.1',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.stderr.on('data', (chunk) => { output += chunk; });

    const url = `http://127.0.0.1:${port}/login`;
    const ready = await waitForLogin(url, child, Date.now() + BOOT_TIMEOUT_MS);
    // Let boot-time timers run briefly so early async errors show up in the output.
    if (ready) await new Promise((resolve) => setTimeout(resolve, 3_000));
    const exitedEarly = child.exitCode !== null;
    await stopChild(child);

    const tail = output.trim().split('\n').slice(-25).map((line) => `        ${line}`).join('\n');
    const failures = [];
    if (exitedEarly) failures.push(`core exited during boot (code ${child.exitCode})`);
    else if (!ready) failures.push(`${url} did not answer 200 within ${BOOT_TIMEOUT_MS / 1000}s`);
    const runtimeError = output.match(new RegExp(`.*(${BOOT_FAILURE_PATTERN.source}).*`));
    if (runtimeError) failures.push(`runtime error during boot: ${runtimeError[0].trim()}`);
    if (failures.length) failures.push(`last output:\n${tail}`);
    else log(`boot ok: ${url} answered 200`);
    return failures;
}

/**
 * Child mode: stub the FXServer natives the core reads at boot, then load the bundle.
 */
function runBootChild(bundlePath) {
    const txaPath = path.resolve(path.dirname(bundlePath), '..');
    Object.assign(globalThis, {
        ExecuteCommand: () => {},
        GetConvar: (name, fallback) => {
            if (name === 'version') return 'FXServer-master v1.0.0.17000 linux';
            if (name === 'citizen_root') return process.env.SMOKE_CITIZEN_ROOT;
            return fallback;
        },
        GetCurrentResourceName: () => 'monitor',
        GetResourceMetadata: (_resource, key) => (key === 'version' ? '8.1.1' : ''),
        GetResourcePath: () => txaPath,
        IsDuplicityVersion: () => true,
        PrintStructuredTrace: () => {},
        RegisterCommand: () => {},
        ScanResourceRoot: () => false,
        GetPasswordHash: () => '',
        VerifyPasswordHash: () => false,
    });
    createRequire(import.meta.url)(bundlePath);
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    if (args.bootChild) return runBootChild(args.bootChild);

    const bundlePath = path.join(args.dist, 'core', 'index.js');
    if (!fs.existsSync(bundlePath)) {
        log(`FAIL: ${bundlePath} does not exist`);
        process.exit(1);
    }

    log(`scanning ${bundlePath}`);
    const failures = scanBundle(args.repo, bundlePath);
    if (!failures.length) log('scan ok: no undefined free identifiers');

    if (args.boot) {
        const workDir = args.workDir ?? fs.mkdtempSync(path.join(os.tmpdir(), 'tfadmin-smoke-'));
        fs.rmSync(workDir, { recursive: true, force: true });
        fs.mkdirSync(workDir, { recursive: true });
        log(`booting a copy in ${workDir}`);
        try {
            failures.push(...await bootBundle(args.dist, workDir));
        } finally {
            fs.rmSync(workDir, { recursive: true, force: true });
        }
    }

    if (failures.length) {
        for (const failure of failures) log(`FAIL: ${failure}`);
        process.exit(1);
    }
    log('PASS');
}

await main();
