# @everfall/txadmin-client

Typed client for the Everfall txAdmin API (`/api/v1`). Zero dependencies, uses the global `fetch` (Node 18+, Bun, Workers).
The request/response types are the same ones the server compiles against (`shared/apiV1Types.ts`), so a type error here means a real contract change.

```ts
import { TxAdminClient, TxAdminApiError } from '@everfall/txadmin-client';

const tx = new TxAdminClient({ baseUrl: 'https://admin.example.com', apiKey: process.env.TXADMIN_KEY! });

const status = await tx.status();
const { data: players, meta } = await tx.players.search({ filter: ['isOnline'], limit: 50 });
await tx.players.ban(players[0].license, { reason: 'cheating', duration: '2 days' });

try {
    await tx.server.restart();
} catch (err) {
    if (err instanceof TxAdminApiError && err.code === 'RATE_LIMITED') console.log(`retry in ${err.retryAfterSec}s`);
}
```

Paginated calls return `{ data, meta }`; pass `meta.nextCursor` back as `cursor` for the next page.

## Receiving webhooks

```ts
import { parseWebhookRequest } from '@everfall/txadmin-client';

app.post('/hooks/txadmin', express.raw({ type: 'application/json' }), async (req, res) => {
    try {
        const payload = await parseWebhookRequest(process.env.TXADMIN_WEBHOOK_SECRET!, req.header('x-txadmin-signature'), req.body.toString());
        if (payload.event.type === 'player.banned') { /* ... */ }
        res.sendStatus(204);
    } catch {
        res.sendStatus(401);
    }
});
```

Respond with a 2xx within 5 seconds; txAdmin retries anything else after 10 s, 1 min, 10 min and 1 h.
Deliveries are at-least-once, so dedupe on `payload.deliveryId` (retries) or `payload.event.id` (the event).

## Polling instead of webhooks

```ts
for await (const event of tx.events.poll({ types: ['player.joined', 'player.left'] })) {
    console.log(event.type, event.data);
}
```

## Build

```sh
pnpm --filter @everfall/txadmin-client build   # emits dist/
```
