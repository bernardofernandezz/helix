# Mobile connection (removed from the MVP)

The phone companion was taken out of the MVP to keep the first release focused on the desktop
research workflow. Its user-facing surface and its background services are gone; the source stays
in the repo because other parts of the build depend on it. This document records how it worked so it
can be turned back on later.

**Last commit with the feature fully enabled:** `24068e6832b72e82ffa2b2faa1498896aaf7033a`.
Restore any removed path with `git checkout 24068e68 -- <path>`.

## What was removed and what stayed

| Layer                                                                                              | Status             | Paths                                                                                                                                                                                                                                                                                         |
| -------------------------------------------------------------------------------------------------- | ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Desktop UI (Mobile page, Settings → Mobile, sidebar entry)                                         | **removed**        | `src/renderer/src/components/mobile/`, `src/renderer/src/components/settings/Mobile{Pane,SettingsPane,Pairing*,Relay*,PairedDevices*,AutoRestoreFit*}.tsx`, `src/renderer/src/components/settings/mobile-*` helpers, `src/renderer/src/components/sidebar/mobile-sidebar-onboarding-badge.ts` |
| Startup of the cloud relay client and push service                                                 | **removed**        | `src/main/startup/main-process-relay-startup.ts`, `src/main/startup/main-process-push-startup.ts`, push service in `src/main/helixd/helixd-entry.ts`                                                                                                                                          |
| Phone app source (Expo / React Native)                                                             | kept, unused       | `mobile/`                                                                                                                                                                                                                                                                                     |
| Mobile web bundle build                                                                            | kept               | `build:mobile-web`, `config/scripts/*mobile-web*`                                                                                                                                                                                                                                             |
| Cloud relay and push gateway source                                                                | kept, not deployed | `cloud/apps/relay`, `cloud/apps/push`, `cloud/apps/relay-fence-broker`                                                                                                                                                                                                                        |
| Desktop runtime protocol (pairing, E2EE, device registry, mobile RPC methods, session projections) | kept, dormant      | `src/main/runtime/**`, `src/shared/mobile-*`, `src/shared/pairing.ts`                                                                                                                                                                                                                         |

Why the source stays:

- `mobile/web-entry` builds the phone web page (`out/mobile-web`). That page ships inside the desktop
  package (`config/electron-builder.config.cjs` asserts it in `beforePack`) and inside every `helixd`
  server deployed to SSH/WSL hosts (`src/shared/helixd-artifacts.ts`, `config/scripts/helixd-mobile-web-bundle.mjs`).
  Deleting `mobile/` breaks packaging and remote deploys.
- The runtime pairing, E2EE and RPC layers also serve the web client and remote/WSL hosts.
- CI scope scripts and e2e tests reference `cloud/apps/relay` and `cloud/apps/push`.

Without the UI and the startup hooks no phone can pair: nothing mints a `scope: 'mobile'` pairing
offer, and the relay and push clients never start. The cloud origins also point at
`*.helix.invalid` placeholders.

To remove the source for good later, drop the mobile web page from `HELIXD_ARTIFACTS`, the
`beforePack` assertion and the `helixd` staging first, then delete `mobile/`, the `mobile*` config
scripts and workflows, and the cloud apps along with the CI scope rules and e2e tests that name them.

## Architecture

```
 Phone app (mobile/)                      Desktop (Electron main)
 ┌──────────────────────┐   LAN WS :6768   ┌─────────────────────────────┐
 │ transport/            │ ───────────────▶ │ runtime-rpc (ws-transport)  │
 │  direct-rpc-client    │  E2EE v2 frames  │  mobile-socket-wiring       │
 │  relay client         │                  │  mobile-e2ee-v2-desktop-*   │
 └─────────┬────────────┘                  │  runtime-rpc-mobile-*       │
           │ HTTPS/WSS                      └──────────────┬──────────────┘
           ▼                                               │ control socket
   cloud/apps/relay  (director + cells) ◀──────────────────┘ (mobile-cloud-relay/)
   cloud/apps/push   (APNs/FCM gateway) ◀── desktop-push-service (runtime/push/)
```

### 1. Pairing

- The desktop mints a pairing offer: `src/shared/mobile-relay-pairing-offer.ts` (schema, version
  `2`) and `src/shared/pairing.ts`, which encodes it as `helix://pair?code=<base64url JSON>`.
- The offer carries the LAN `endpoint`, a per-device `deviceToken`, the desktop Curve25519
  `publicKeyB64`, an optional `relay` block (director URL, cell URL, `relayHostId`, a 10-minute
  `inviteToken`) and `scope` (`mobile` or `runtime`).
- QR rendering: `src/main/runtime/mobile-pairing-qr.ts`. Advertised address and interface
  selection: `src/main/runtime/pairing-endpoint.ts`, `pairing-network-interfaces.ts`.
- Windows needs an inbound firewall rule for the port: `src/main/runtime/windows-mobile-firewall.ts`.
- Paired devices are stored with revocable per-device tokens in
  `src/main/runtime/device-registry.ts` (file name in `mobile-pairing-files.ts`).
- Renderer IPC lives in `src/main/ipc/mobile.ts` (`mobile:*` channels). It also serves runtime
  access grants for non-mobile clients, which is why it was kept.

### 2. Transport and end-to-end encryption

- Direct mode: the phone opens a WebSocket to the desktop runtime RPC server
  (`src/main/runtime/rpc/ws-transport.ts`, port `6768`, fallback port in `ws-fallback-port-store.ts`).
- Relay mode: both sides connect out to the relay cell. The desktop holds a control socket
  (`src/main/runtime/mobile-cloud-relay/relay-control-client.ts`, `desktop-relay-service.ts`) and
  the relay forwards opaque frames (`src/main/runtime/mobile-desktop-relay/`).
- Both modes run the same E2EE v2 handshake, so the relay never sees plaintext:
  - Contract and transcript: `src/shared/mobile-e2ee-v2-contract.ts` (`helix-mobile-e2ee/v2/transcript`).
  - X25519 + HKDF key schedule into two direction keys and a session id:
    `src/shared/mobile-e2ee-v2-node-key-schedule.ts`, `paired-e2ee-v2-key-schedule.ts`.
  - Framing: `src/shared/mobile-e2ee-v2-framing.ts`.
  - Device key proof (Ed25519 signature over `helix-device-proof/v1\0<purpose>\0<transcriptHash>`):
    `src/shared/device-key-proof.ts`.
  - Desktop side: `src/main/runtime/rpc/mobile-e2ee-v2-desktop-{session,inbound,outbound}.ts`.
  - Test vectors: `src/shared/mobile-e2ee-v2-fixtures.ts`. Regenerate them from code whenever a
    domain string changes.

### 3. RPC surface for the phone

- Phones get a restricted method set: `src/main/runtime/runtime-rpc/runtime-rpc-mobile-method-allowlist.ts`
  and `runtime-rpc-mobile-method-routing.ts`. Caller scope checks are in `src/main/runtime/rpc/rpc-caller-scope.ts`.
- Phone-shaped projections of desktop state: `src/main/runtime/runtime-mobile-session-projection.ts`,
  `runtime-mobile-agent-status-*.ts`, `mobile-session-*.ts`, `src/main/runtime/session-tabs/`.
- Notifications and dictation: `runtime-mobile-notification-controller.ts`,
  `runtime-mobile-dictation-controller.ts`.
- The desktop also served a web build of the phone UI over RPC:
  `src/main/runtime/rpc/methods/mobile-web-bundle.ts`, built by
  `config/scripts/build-mobile-web-app-bundle.mjs`.

### 4. Cloud relay (`cloud/apps/relay`)

- A director assigns each desktop to a cell. Cells hold desktop control sockets and phone
  sessions, backed by Postgres (`cloud/packages/postgres-schema`).
- The desktop authenticates with a host proof over a sealed challenge:
  `src/main/runtime/host-challenge-envelope.ts`, `mobile-cloud-relay/relay-host-proof.ts`.
- Region selection and correction: `mobile-cloud-relay/relay-region-*.ts`.
- Relay sign-in used the cloud profile (`src/main/helix-profiles/profile-cloud-auth-config.ts`).

### 5. Push (`cloud/apps/push`)

- The desktop registers phone push tokens and sends agent-attention events to a push gateway,
  which forwards them to APNs and FCM.
- The desktop proves host identity with an HMAC over a sealed challenge
  (`src/main/runtime/push/push-host-proof.ts`; shared vector in
  `cloud/packages/push-contract/src/push-host-proof-vector.json`).
- Service and outbox: `src/main/runtime/push/desktop-push-service.ts`, `push-dispatcher.ts`,
  `push-unregister-outbox.ts`.
- The phone app needs its own Firebase project (`mobile/google-services.json`) and APNs keys.

### 6. Phone app (`mobile/`)

- Expo SDK 55 / React Native 0.83, with its own `pnpm-workspace.yaml` and lockfile.
- Key folders: `src/transport` (direct/relay clients, E2EE), `src/session` and `src/terminal`
  (live terminals), `src/worktree`, `src/notifications`, `src/dictation`, `modules/` (native
  modules), `fastlane/` (store releases), `web-entry/` (the web build served by the desktop).
- Local development: run `pnpm dev` at the repo root (RPC server on `:6768`), then
  `cd mobile && pnpm install && pnpm start`.

## Bringing it back

1. Restore the removed UI and startup files from `24068e68` (paths in the table above).
2. Re-add the `startDesktopRelayService` and `startDesktopPushService` calls in
   `src/main/startup/main-process-runtime-launch.ts` (headless serve path and window path), and the
   `DesktopPushService` block in `src/main/helixd/helixd-entry.ts`.
3. Re-add the Mobile entries in `AppWorkspaceShell.tsx`, `SidebarNav.tsx` (plus its tests),
   `settings-page-renderer.tsx`, `settings-setup-workflow-section-renderers.tsx` and
   `settings-navigation-capability-sections.ts`, and the badge path in
   `src/shared/wsl-move/wsl-move-storage-dispositions.ts`.
4. Provision your own infrastructure before shipping: relay director and cells with Postgres, a
   push gateway with APNs and FCM credentials, a Firebase project (replace
   `mobile/google-services.json`, which is a placeholder), and real cloud
   origins in place of the `*.helix.invalid` placeholders (`profile-cloud-auth-config.ts`,
   `push-gateway-origin.ts`).
5. Run `pnpm tc`, `pnpm test`, and the mobile suite (`cd mobile && pnpm test`).
