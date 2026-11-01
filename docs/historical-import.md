# Historical punishment records

At startup, before the player database becomes ready, tfAdmin checks the profile's
`data/historicalActionsImport.json`. This is an authorized data transfer, not a
manual database edit. An absent file does nothing. Invalid input blocks database
readiness instead of partially importing a batch.

The file contains `{ "version": 1, "actions": [...] }`. Each record has:

- `externalRef`: a stable source reference, unique within the file.
- `sourceUrl`: the original Discord post URL.
- `type`: `ban`, `warn`, or `kick`.
- `ids`: only verified player identifiers; use an empty array when unresolved.
- `playerName`: the name recorded in the source, or `null`.
- `author`, `reason`, and `timestamp`: original staff label, source wording, and
  source date in Unix seconds.
- `expiration`: the recorded absolute ban expiry in Unix seconds, or `false`.
- `expirationKnown`: whether the source actually states the expiry or permanence.
  Unknown expiry uses `false` with `expirationKnown: false`; it does not claim a
  permanent ban.
- `duration`: original duration wording, or `null`. Do not calculate a claimed
  exact expiry from a forum post date when the actual issue time is unknown.
- `notes`: source messages and evidence links as `{ id, text, author, ts }`.
  Stable note IDs make attaching source evidence repeatable.
- Optional `existingActionId`: an existing action verified against the source by
  exact player name, type, reason, and nearby time. This attaches source notes
  without changing that action's date, expiry, revocation, or enforcement.

Unmatched records retain their original type and receive `historical` source
metadata. They appear in history with a Historical label and original source
link. They do not block joins, deliver warnings, or trigger ban-evasion alerts.
They cannot be revoked or have their original punishment changed. Staff can
still add notes. Unknown warning acknowledgment is shown as Unknown.

The importer validates the entire batch and resolves every existing target
before changing data. It copies the current database to
`playersDB.json.before-history-import-<timestamp>.json`, applies the records,
and writes through the database's own adapter before marking it ready. It
skips imported external references and existing source-note IDs on later starts.
The transfer file remains in place for audit and safe replay.

Deployment stages the code and the transfer file. It does not restart Main.
The import takes effect at its next normal startup. Verify the stored historical
references and source-note IDs after startup; a staged file is not a completed
live import.
