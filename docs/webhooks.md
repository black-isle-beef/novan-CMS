# Receiving Novan CMS webhooks

A webhook tells your system when content in a Novan CMS space changes, for example to rebuild a search index or clear
a cache. Space admins and developers add webhooks in the admin under **Settings > Webhooks**: an address to call, the
events to send, and a secret. The secret is shown once, when the webhook is made (or its secret replaced). Store it
like a password.

## The request

Novan sends an HTTP `POST` with a JSON body:

```json
{
  "id": "0b8f3c1e-6f0a-4a63-9a43-3c1f2b7d9e10",
  "type": "entry.published",
  "createdAt": "2026-10-12T08:00:00.123Z",
  "spaceId": "00000000-0000-4000-8000-000000000200",
  "data": {
    "entryId": "4b4d2f2d-2df1-412c-8b81-efa1c700fadb",
    "environmentId": "…",
    "contentType": "page",
    "path": "/blog/hello-world",
    "cacheTags": ["entry:4b4d…", "type:…:page"],
    "versionId": "…",
    "publishedAt": "2026-10-12T08:00:00.120Z",
    "actorId": "…"
  }
}
```

| Header | Value |
| --- | --- |
| `X-Novan-Signature` | `t=<unix seconds>,v1=<signature>`: see below |
| `X-Novan-Event` | The event type, as `type` in the body |
| `X-Novan-Delivery` | This delivery's id: it changes when a request is retried or resent |
| `Content-Type` | `application/json` |

Events: `entry.published`, `entry.unpublished`, `paths.changed` (published addresses moved), `redirects.changed`,
`locales.changed`, `asset.replaced`, `asset.deleted`, and `ping` from **Send a test**.

## Answering

Answer with any `2xx` status within 10 seconds. Anything else, or no answer, is retried after about 10 s, 20 s, 40 s and so on,
8 times in all (about 20 minutes). After that the delivery is marked failed; an admin can resend it from the delivery log.
Do slow work after you answer.

A change can arrive more than once (a retry after your answer was lost, or a resend). Every delivery of the same change
carries the same `id`, so remember the ids you have handled and ignore repeats. Deliveries can arrive out of order:
compare `createdAt` if order matters.

## Verifying the signature

Check every request before trusting it. The signature is an HMAC-SHA256, keyed with your secret, of the timestamp, a
full stop and the **raw** request body (the exact bytes, before any JSON parsing), written in hex:

```
v1 = hex(HMAC_SHA256(secret, "<t>.<raw body>"))
```

Refuse the request when the signature does not match, or when `t` is more than 5 minutes from your clock: an old,
valid request replayed by someone who captured it then fails.

### Node.js (Express)

```js
import crypto from 'node:crypto';
import express from 'express';

const secret = process.env.NOVAN_WEBHOOK_SECRET; // whsec_…
const seen = new Set(); // use a database or cache in production

function verify(rawBody, header) {
  const parts = Object.fromEntries((header ?? '').split(',').map((p) => p.trim().split('=', 2)));
  const t = Number(parts.t);
  if (!Number.isInteger(t) || Math.abs(Date.now() / 1000 - t) > 300) return false;
  if (!/^[0-9a-f]{64}$/.test(parts.v1 ?? '')) return false;
  const expected = crypto.createHmac('sha256', secret).update(`${t}.${rawBody}`).digest();
  return crypto.timingSafeEqual(expected, Buffer.from(parts.v1, 'hex'));
}

const app = express();
// express.raw keeps the exact bytes: verifying re-serialised JSON fails.
app.post('/hooks/novan', express.raw({ type: 'application/json' }), (req, res) => {
  const body = req.body.toString('utf8');
  if (!verify(body, req.get('X-Novan-Signature'))) return res.status(401).end();
  const event = JSON.parse(body);
  res.status(204).end();
  if (seen.has(event.id)) return;
  seen.add(event.id);
  // … handle event.type and event.data here, after answering.
});
app.listen(3001);
```

### Other languages

Any HMAC-SHA256 library works the same way. Compare signatures with a constant-time function (`hmac.compare_digest`
in Python, `hash_equals` in PHP, `crypto/subtle.ConstantTimeCompare` in Go), never `==`.

```python
import hmac, hashlib, time

def verify(secret: str, raw_body: bytes, header: str) -> bool:
    parts = dict(p.strip().split('=', 1) for p in header.split(',') if '=' in p)
    try:
        t = int(parts['t'])
    except (KeyError, ValueError):
        return False
    if abs(time.time() - t) > 300:
        return False
    expected = hmac.new(secret.encode(), f'{t}.'.encode() + raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, parts.get('v1', ''))
```

## Replacing a secret

**Replace secret** in the admin makes a new one and signs every request with it from then on. To change it without
missing requests, accept either secret while you deploy the new one, then drop the old.

## Addresses Novan will call

In production a webhook must use `https://`, and its host must resolve to public addresses only: private, loopback and
link-local networks are refused. Redirects are not followed; answer from the address you registered.
