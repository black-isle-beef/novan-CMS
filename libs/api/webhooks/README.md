# api-webhooks

Webhooks (package 17), under `/v1/management/spaces/:spaceId/webhooks`, for space admins, developers and agency staff.
Receivers verify requests as `docs/webhooks.md` explains.

| Route | What |
| --- | --- |
| `GET /` | Webhooks, with their last delivery (never the secret) |
| `POST /` | `{ name, url, events, active? }`; the response holds the secret, shown this once (400 `webhook_url_refused`) |
| `PATCH :id` | Name, address, events, on or off |
| `POST :id/rotate-secret` | A new secret, shown this once |
| `DELETE :id` | With its deliveries |
| `GET :id/deliveries` | The last 50, newest first |
| `POST :id/deliveries/:deliveryId/resend` | The same event again, as a new delivery |
| `POST :id/test` | A `ping` event |

- **How changes get out.** `ContentEvents` and `MediaEvents` send a `dispatch` job to the `webhooks` queue in the
  changing transaction (`dispatchWebhooks`, `@novan/api-jobs`). `WebhookRunner.dispatch` records one delivery per active,
  subscribed webhook (once per change: `webhook_deliveries_event_idx`) and queues a `deliver` job for each.
- **Sending.** `deliver` POSTs the payload with `X-Novan-Signature: t=<unix>,v1=<hex HMAC-SHA256("<t>.<body>")>`,
  `X-Novan-Event` and `X-Novan-Delivery`, a 10 s timeout and no redirects. A non-2xx answer or no answer is thrown, so the
  worker retries with back-off (8 attempts); each attempt is recorded on the delivery.
- **Addresses.** In production (`NODE_ENV=production`) only https addresses that resolve to public IPs are called;
  `WEBHOOKS_ALLOW_PRIVATE_URLS` changes that (local receivers, tests). Checked when a webhook is saved and before each
  request.
- **Secrets.** Made here (`whsec_` + 32 random bytes), stored in `webhooks.secret`, which no client role can read
  (column privileges, 0017); only the API's own connection reads it, to sign.

Run `nx test api-webhooks` (signatures, addresses) and `nx test api` (`apps/api/src/app/webhooks.spec.ts`, with a local
receiver); `nx e2e api-e2e` checks a signed delivery and a retry against the running worker.
