import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, suite, it } from 'vitest';
import { getPendingStagedBuild } from './stagedBuild';


suite('getPendingStagedBuild', () => {
    let root: string;
    let runningDir: string;
    let stageDir: string;
    const writeBuild = (dir: string, commit: string) => {
        fs.mkdirSync(path.join(dir, 'core'), { recursive: true });
        fs.writeFileSync(path.join(dir, 'core', 'index.js'), '');
        fs.writeFileSync(path.join(dir, '.tfadmin-build'), `version=8.1.1\ncommit=${commit}\ndeployed=now\n`);
    };

    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'tfadmin-stage-'));
        runningDir = path.join(root, 'monitor');
        stageDir = path.join(root, 'tfadmin');
    });
    afterEach(() => {
        fs.rmSync(root, { recursive: true, force: true });
    });

    it('returns the staged commit when it differs from the running build', () => {
        writeBuild(runningDir, '378f61d7');
        writeBuild(stageDir, '483d6d2a');
        expect(getPendingStagedBuild(runningDir, stageDir)).toBe('483d6d2a');
    });
    it('returns nothing when the staged build is already running', () => {
        writeBuild(runningDir, '483d6d2a');
        writeBuild(stageDir, '483d6d2a');
        expect(getPendingStagedBuild(runningDir, stageDir)).toBeUndefined();
    });
    it('returns nothing without a stage dir or a complete staged build', () => {
        writeBuild(runningDir, '378f61d7');
        expect(getPendingStagedBuild(runningDir, undefined)).toBeUndefined();
        expect(getPendingStagedBuild(runningDir, stageDir)).toBeUndefined();
        fs.mkdirSync(stageDir);
        fs.writeFileSync(path.join(stageDir, '.tfadmin-build'), 'commit=483d6d2a\n');
        expect(getPendingStagedBuild(runningDir, stageDir)).toBeUndefined();
    });
});
