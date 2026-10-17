/**
 * The staff member behind an author name: API writes made for a staff member are stored as
 * `<admin> (via api:<key>)`, and that note still belongs to the admin.
 */
export function noteAuthorPerson(author: string) {
    return author.replace(/ \(via api:[^)]*\)$/, '');
}


/**
 * Whether the admin wrote the note. Notes without a known author belong to nobody.
 */
export function isNoteAuthor(note: { author: string }, adminName: string) {
    if (note.author === 'unknown') return false;
    return noteAuthorPerson(note.author) === noteAuthorPerson(adminName);
}
