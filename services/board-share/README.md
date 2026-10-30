# Fcboard live-share service

This service makes the existing `SceneSync` / `LanSession` board protocol available over HTTPS and WebSocket. The Android local server remains available without a cloud connection. The chooser and password-switch behavior follow `ChooseServerPopu` / `QRHttpPopu`; this cloud transport is an extension for the requested live editing, not an implementation of the manufacturer's file-upload endpoint.

The `Fcboard-Live-Share` CI artifact contains `services/board-share` and the matching `app/build` viewer. Extract both directories together. With Node 22 or later, install this directory's pinned `ws` dependency and run:

```sh
cd services/board-share
npm install --omit=dev
export SHARE_DATA_DIR='/path/to/private-bzd-storage'
export SHARE_CREATE_TOKEN='replace-with-a-private-service-key-of-at-least-16-characters'
node server.mjs
```

The process listens on port 8080 (`PORT` overrides it). `SHARE_PUBLIC_DIR` can override the viewer directory; by default it resolves the artifact's `app/build` beside this service. A missing viewer prevents startup. Place the service behind HTTPS at its own origin root and forward WebSocket upgrades for `/host/` and `/board/`. The packaged viewer uses root paths for fonts, OCR and Vite assets, so a subdirectory URL is rejected by the app. The app permits local-network HTTP for development/testing; public connections require HTTPS.

In **More → Live collaboration → Cloud**, enter that service address and the same service key. Changes save automatically: the address is local, the service key is session-only. A successful HTTP create and authenticated initial WebSocket scene are required before the app shows a QR. Scanning opens the packaged interactive whiteboard. Both participants can write, erase and change scene objects, images and background through the same version/nonce merge rules as local sharing. The same QR now follows host whiteboard navigation. Each page visit carries a host-controlled id/epoch; changing it replaces the scene, files, background and scanner history. Stale packets cannot enter a new page. Courseware still has a separate annotation model and remains unfinished.

Password protection defaults off. Enabling or changing its four digits updates the existing room; disabling clears protection and admits waiting scanners. Authenticated participants stay connected when the code changes, matching the local server. The QR never contains the service or room-owner key. Room creation requires the service key; changing protection and ending a room require its separate owner key. Allowed cross-origin clients are configured with comma-separated `SHARE_ORIGINS`; Android defaults are `https://localhost,capacitor://localhost`, and the viewer's own origin is also accepted. Browser clients keep these credentials out of public AI inspection.

The service keeps rooms in memory: restarting ends them. Defaults are 32 rooms, 32 guests per room, 50,000 objects, 20 MB per request/message/scene and a 64 MB aggregate serialized scene budget. Slow sockets are bounded; idle rooms expire after eight hours. Host reconnection resynchronizes the same room. Connection and server errors are reported, rather than turning a failed operation into a successful share. Network latency depends on the connection; packets reuse the current scene adapter's 16 ms batching.

HTTP room creation, password updates and deletion, real host/guest WebSockets, merge conflicts, deletion, images, background, authentication, cancellation, reconnect and the actual app chooser are covered by `cloudShareServer.test.ts`, `cloudShare.test.ts` and `LanSession.test.tsx`. These are loopback tests inside `npm test`; they do not start a development environment or prove a public deployment. The CI artifact is packaging, not automatic deployment.

The project server is `https://101.96.199.53/` (`ssh hus`). Its runtime, private configuration and trusted IP TLS have been prepared; it currently returns a deliberate 503 while waiting for the matching verified viewer. See [deployment status](../../docs/cloud-sharing.md). The supplied systemd unit starts only when `/srv/fcboard/current/public/index.html` exists, and Caddy handles non-SNI IP clients with `default_sni`. This is not yet a publicly usable share deployment. The two transfer routes below are implemented in source and still await the matching CI deployment.

Static sharing follows **QR share → select pages → Cloud/Local → QR**. The cloud service exposes a read-only gallery and PNG downloads at `/share/<id>/`; protection covers image requests, password changes revoke old cookies, and the share ends after ten minutes or when closed. It shares the 64 MB aggregate budget with rooms and BZD transfers.

BZD saving follows **Save → pages → BZD → Cloud/Local**. The cloud branch stores the existing BZD XML, then displays the original four-character extraction code. **Open → Cloud → code** downloads through the same parser/import path as local files. A private `SHARE_DATA_DIR` persists these files across restarts for 24 hours; the supplied unit permits `/var/lib/fcboard/transfers`. The expiry is an explicit service choice, not a claim about the manufacturer's retention. At most 32 transfers and 20 MB per request are accepted. Include both `server.mjs` and `transfers.mjs` when deploying; no upload goes to the old manufacturer endpoint.

`cloudTransfers.test.ts`, `BoardShare.test.tsx`, `BoardOpen.test.tsx`, `sceneSync.test.ts` and the existing service/session tests cover real HTTP gallery/password/PNG data, cancellation cleanup, persistent editable BZD roundtrips, host page transitions and delayed source-page edits. Native socket tests and responsive browser scenarios await CI; no local build or development server was used.
