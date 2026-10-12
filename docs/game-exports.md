# Game exports

tfAdmin owns every ban and warn on Everfall. Game scripts moderate through the `monitor` resource's
server exports instead of keeping their own tables. Each export reads the player's identifiers and
hardware tokens when it is called, sends them to tfAdmin, and returns without waiting.

```lua
exports.monitor:BanPlayer(source, 'Exploit Attempt: CODE')                      -- permanent, author "Anti-Cheat"
exports.monitor:BanPlayer(source, reason, { duration = '7 days', author = 'Anti-Cheat' })
exports.monitor:WarnPlayer(source, reason, { author = 'System' })
exports.monitor:KickPlayer(source, reason)
exports.monitor:MessagePlayer(source, message)
```

| Export | Defaults | Stored |
| --- | --- | --- |
| `BanPlayer` | `duration = 'permanent'`, `author = 'Anti-Cheat'` | ban action, with HWIDs |
| `WarnPlayer` | `author = 'System'` | warn action |
| `KickPlayer` | `author = 'System'` | nothing (fires `playerKicked`) |
| `MessagePlayer` | `author = 'System'` | nothing (fires `playerDirectMessage`) |

- Each export returns `true`, or `false, errorMessage` when the input is invalid or the player is
  not connected.
- `duration` takes the same strings as the panel and the API, such as `'2 hours'` or `'7 days'`.
- The author is a label and cannot be the name of a tfAdmin admin. Keep `Anti-Cheat` for automated
  bans: ef_administration's ban workspace and ef_bifrost look for it.
- The admin log line names the calling resource, for example `[ef_mining] Banned player ...`.
- If tfAdmin cannot record a ban or kick, the export still drops the player and prints the error.
- The exports go through the `/intercom/moderation` scope with the monitor resource's token, so only
  the `monitor` resource can call it. Staff tools that act for a person keep using `/api/v1` with the
  actor header.
