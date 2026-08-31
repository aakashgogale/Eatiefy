# Realtime (Socket.IO) — production deployment

Order alerts and their notification sounds are driven entirely by Socket.IO.
The restaurant panel plays its sound from inside the `new_order` socket handler,
and the delivery app plays its sound from the `play_notification_sound` socket
event. **If the socket does not connect, there is no popup and no sound.** They
are one failure, not three.

## 1. Build the frontend with production env

The bundle is static — whatever is in the env file at build time is baked into
`dist/` and shipped to every browser.

```bash
cd Frontend
cp .env.production.example .env.production   # then edit the real values
npm ci && npm run build
```

Verify the build has no localhost left in it:

```bash
grep -o "localhost:5010" dist/assets/*.js | head
```

Any output means the build used the wrong env file — rebuild before deploying.

`VITE_SOCKET_URL` is optional. Leave it unset when the API and Socket.IO share a
host: the client derives the socket origin from `VITE_API_BASE_URL`
(`Frontend/src/services/api/socketClient.js`). Set it only when sockets live on a
different host or port.

## 2. Proxy the WebSocket upgrade in nginx

The REST API works over a plain reverse proxy; WebSockets do not. Without the
`Upgrade` headers the handshake fails and the client falls back to polling,
which many proxies also break.

```nginx
location /socket.io/ {
    proxy_pass http://127.0.0.1:5010;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 86400;
    proxy_send_timeout 86400;
    proxy_buffering off;
}
```

`proxy_pass` must point at the API port (`PORT` in `Backend/.env`, currently
5010), because `server.js` attaches Socket.IO to the API's HTTP server.

Behind Cloudflare, make sure WebSockets are enabled for the zone.

Verify from the server:

```bash
curl -i "https://eatiefy.com/socket.io/?EIO=4&transport=polling"
```

A healthy response body starts with `0{"sid":`. HTML, 404 or 502 means the
location block is missing or pointing at the wrong port.

## 3. CORS

`Backend/src/config/cors.js` allows `eatiefy.com`, `*.eatiefy.com`,
`*.vercel.app` and localhost by default. Any other frontend domain must be added
to `CLIENT_URL` (comma-separated) in `Backend/.env`.

## 4. Do not run socket_server.js

Sockets are served by `eatiefy-api` (`server.js` calls `initSocket`).
`socket_server.js` is a standalone alternative whose `SOCKET_PORT` defaults to
5010 — the same port as the API — so starting it causes `EADDRINUSE`. It is
deliberately absent from `ecosystem.config.cjs`.

## 5. Workers need Redis to emit

BullMQ workers are separate PM2 processes with no Socket.IO server. Dispatch
retries and acceptance timeouts run there, so without a cross-process transport
their `new_order` emits are dropped and delivery partners get nothing after the
first offer.

`src/config/socketEmitter.js` gives workers a Redis-backed emitter, wired into
`getIO()` as a fallback so every existing call site works unchanged. It requires:

```env
REDIS_ENABLED=true
REDIS_URL=redis://127.0.0.1:6379
BULLMQ_ENABLED=true
```

The API must also be running the Redis adapter — it attaches automatically when
`REDIS_ENABLED=true`. Start Redis **before** enabling these flags.

Confirm after deploy:

```bash
pm2 logs eatiefy-api --lines 50 | grep "Redis adapter attached"
pm2 logs eatiefy-worker-order --lines 50 | grep "Redis emitter ready"
```

If you see `No Socket.IO transport in this process`, the worker has neither a
server nor an emitter and realtime events are being dropped.

## 6. Post-deploy smoke test

1. Open the restaurant panel. DevTools → Network → filter `socket.io`.
   Expect a `101 Switching Protocols` websocket request that stays open.
2. `pm2 logs eatiefy-api | grep "Socket client connected"` — expect a line with
   `RESTAURANT:<id>`.
3. Place a test order (COD, so the payment webhook is out of the picture).
4. `pm2 logs eatiefy-api | grep "Emitting new_order"` — the restaurant popup and
   sound should fire at the same moment.
5. Accept the order, then `pm2 logs eatiefy-api | grep "Broadcasting order"`.
   The rider count must be greater than zero.

## Known gotchas

- **Online payments.** For Razorpay orders the restaurant is only notified after
  payment activation (`order-payment-activation.service.js`), because
  `canExposeOrderToRestaurant` blocks `pending_payment`. A wrong webhook URL or
  `RAZORPAY_WEBHOOK_SECRET` leaves orders stuck and invisible to the restaurant.
  Test with COD first to isolate transport problems from payment problems.
- **Rider eligibility.** `listNearbyOnlineDeliveryPartners` only considers
  partners with `availabilityStatus: "online"` within 15 km of the restaurant,
  and skips restaurants that have no `location.coordinates`. A zero-rider
  broadcast is a data problem, not a socket problem.
- **Autoplay.** Browsers block audio until the page has had a user interaction.
  The restaurant panel falls back to a synthesized chime, but the tab should be
  clicked once after loading for the mp3 alert to play.
