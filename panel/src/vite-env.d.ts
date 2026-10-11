/// <reference types="vite/client" />

declare module 'virtual:release-notes' {
    const notes: import('@shared/releaseNotesTypes').ReleaseNote[];
    export default notes;
}
