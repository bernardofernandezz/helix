# Built-in browser commands

Use a snapshot-interact-re-snapshot loop:

```text
HELIX goto --url https://example.com --json
HELIX snapshot --json
HELIX click --element @e3 --json
HELIX snapshot --json
```

Common commands:

```text
HELIX goto --url <url> --json
HELIX back --json
HELIX reload --json
HELIX snapshot --json
HELIX screenshot --json
HELIX full-screenshot --json
HELIX pdf --json
HELIX click --element <ref> --json
HELIX fill --element <ref> --value <text> --json
HELIX type --input <text> --json
HELIX select --element <ref> --value <value> --json
HELIX check --element <ref> --json
HELIX scroll --direction down --amount 1000 --json
HELIX hover --element <ref> --json
HELIX focus --element <ref> --json
HELIX keypress --key Enter --json
HELIX upload --element <ref> --files <paths> --json
HELIX wait --text <text> --json
HELIX wait --url <substring> --json
HELIX wait --selector <css> --json
HELIX wait --load networkidle --json
HELIX eval --expression <js> --json
HELIX tab list --json
HELIX tab create --url <url> --json
HELIX tab switch --index <n> --json
HELIX tab close --index <n> --json
HELIX cookie get --json
HELIX capture start --json
HELIX console --limit 50 --json
HELIX network --limit 50 --json
HELIX exec --command "help" --json
```

Browser rules:

- Re-snapshot after navigation, tab switches, clicks that change the page, and any `browser_stale_ref`.
- Refs like `@e1` are assigned by `snapshot`, scoped to one tab, and invalidated by navigation or tab switch.
- Browser commands default to the current worktree and its active tab. Use `--worktree all` only intentionally.
- For concurrent browser work, run `HELIX tab list --json`, read `tabs[].browserPageId`, and pass `--page <browserPageId>` on later commands.
- Use typed tab commands (`HELIX tab list/create/close/switch`), not `HELIX exec --command "tab ..."`, so Helix keeps UI state synchronized.
- Prefer `wait --text`, `--url`, `--selector`, or `--load` after async page changes instead of bare timeouts.
- Anything not listed above goes through `HELIX exec --command "<agent-browser command>"`.
- If `fill` or `type` fails on a custom input, try `HELIX focus --element @e1 --json` then `HELIX inserttext --text "text" --json`.
- A client-hosted page renders in the paired desktop's browser engine, so every command against it needs that desktop online and returns `browser_host_unavailable` while it is closed, asleep, or disconnected. Server-hosted pages run with no desktop attached; prefer them for long or unattended automation.

Common recoveries:

- `browser_no_tab`: open a tab with `HELIX tab create --url <url> --json`.
- `browser_stale_ref`: run `HELIX snapshot --json` and retry with fresh refs.
- `browser_tab_not_found`: run `HELIX tab list --json` before switching or closing.
- `browser_host_unavailable`: the desktop hosting the page is offline. Bring it back, or recreate the page with server placement if the work must outlive the desktop session.
