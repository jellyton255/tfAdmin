# Game exports

tfAdmin owns every ban, warn and kick on Everfall, and keeps a record of game sanctions such as jail. Game scripts moderate through the `monitor` resource's
server exports instead of keeping their own tables. Each export reads the player's identifiers and
hardware tokens when it is called, sends them to tfAdmin, and returns without waiting.

```lua
exports.monitor:BanPlayer(source, 'Exploit Attempt: CODE')                      -- permanent, author "Anti-Cheat"
exports.monitor:BanPlayer(source, reason, { duration = '7 days', author = 'Anti-Cheat' })
exports.monitor:WarnPlayer(source, reason, { author = 'System' })
exports.monitor:KickPlayer(source, reason)
exports.monitor:MessagePlayer(source, message)
exports.monitor:RecordSanction(source, 'Jail', 'Armed robbery', { author = 'Police', length = '30 months' })

-- staff notes: saved on the action, never shown to the player
exports.monitor:BanPlayer(source, reason, {
    note = 'Teleported 4 km in 1 s. Clip: https://medal.tv/...',
    onDone = function(actionId) print('saved as', actionId) end,
})
exports.monitor:AddActionNote('BABC-1234', 'Second detection an hour later.', 'Anti-Cheat')
```

| Export | Defaults | Stored |
| --- | --- | --- |
| `BanPlayer` | `duration = 'permanent'`, `author = 'Anti-Cheat'` | ban action, with HWIDs |
| `WarnPlayer` | `author = 'System'` | warn action |
| `KickPlayer` | `author = 'System'` | kick action (a record only; not stored when the player has no valid identifiers) |
| `MessagePlayer` | `author = 'System'` | nothing (fires `playerDirectMessage`) |
| `RecordSanction` | `author = 'System'` | sanction action (a record only) |
| `AddActionNote` | `author = 'System'` | a staff note on that action |

- Each export returns `true`, or `false, errorMessage` when the input is invalid or the player is
  not connected.
- `note` on `BanPlayer`, `WarnPlayer`, `KickPlayer` and `RecordSanction` adds a staff note to the new action.
- `RecordSanction(source, kind, reason, options)` records a punishment the calling resource applied
  itself, such as jail, community service or a mute, so the player's record shows it. tfAdmin does
  nothing to the player. `kind` is a short label (up to 32 characters, such as `'Jail'` or
  `'Community Service'`) and `length` is optional free text (such as `'30 months'` or `'20 tasks'`).
  The record is never active and cannot be revoked; the resource owns the punishment itself.
- `onDone(actionId)` runs once tfAdmin saved the action, so a script can add notes later. It gets
  `nil` for a kick that was not stored. It does not run when tfAdmin refused the request.
- `duration` takes the same strings as the panel and the API, such as `'2 hours'` or `'7 days'`.
- The author is a label and cannot be the name of a tfAdmin admin. Keep `Anti-Cheat` for automated
  bans: ef_administration's ban workspace and ef_bifrost look for it.
- The admin log line names the calling resource, for example `[ef_mining] Banned player ...`.
- If tfAdmin cannot record a ban or kick, the export still drops the player and prints the error.
- The exports go through the `/intercom/moderation` scope with the monitor resource's token, so only
  the `monitor` resource can call it. Staff tools that act for a person keep using `/api/v1` with the
  actor header.
