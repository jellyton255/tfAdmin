import { expect, it, suite } from 'vitest';
import { parseReleaseNoteSubject } from './releaseNotes';


suite('parseReleaseNoteSubject', () => {
    it('keeps features, fixes and performance changes', () => {
        expect(parseReleaseNoteSubject('feat(panel): edit an API key\'s scopes')).toEqual({
            type: 'feat',
            scope: 'panel',
            text: 'Edit an API key\'s scopes',
        });
        expect(parseReleaseNoteSubject('fix: stop a crash')?.scope).toBeNull();
        expect(parseReleaseNoteSubject('perf(core): load faster')?.type).toBe('perf');
    });

    it('drops hidden, maintenance and unconventional subjects', () => {
        expect(parseReleaseNoteSubject('hidden: feat(panel): secret thing')).toBeNull();
        expect(parseReleaseNoteSubject('hidden: merge pull request #12')).toBeNull();
        expect(parseReleaseNoteSubject('docs(api): document webhooks')).toBeNull();
        expect(parseReleaseNoteSubject('ci(client): publish on tags')).toBeNull();
        expect(parseReleaseNoteSubject('Update sv.json')).toBeNull();
    });

    it('masks everything from internal: on', () => {
        expect(parseReleaseNoteSubject('fix(api): retry ban imports internal: near Sandy Shores atlas-with: ef_admin@1234567')?.text)
            .toBe('Retry ban imports');
        expect(parseReleaseNoteSubject('feat(core): internal: only private details')).toBeNull();
    });
});
