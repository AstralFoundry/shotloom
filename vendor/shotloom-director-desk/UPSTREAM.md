# Shotloom Director Desk source

- Source: https://github.com/AstralFoundry/shotloom-director-desk.git
- Imported revision: `f951e5ead76142b3649216d68783efc209354868`
- License: MIT (see `LICENSE`)

Shotloom builds this application independently with `npm run prepare:director-desk` and copies its output to `renderer/public/director-desk-app/`. The host loads it in an iframe.

Local integration changes are confined to `src/app/host-bridge.ts` (the postMessage protocol),
`src/app/main.tsx` (which must call `initializeHostBridge()`), `index.html`, and `vite.config.mjs`. Everything else in `src/` is a straight copy of the upstream
source at `/Users/xiaomao26_1_12/projecets/director-desk`; the host-facing capabilities that used to
live only here (`setHostPanorama`, `renderPreview`, `replaceSceneDocument`, `BUILDS`/`GENDERS`,
`FRAMING_NAMES`) have been upstreamed so the two trees stay identical.

Sync with:

    rsync -a --delete <upstream>/src/ vendor/shotloom-director-desk/src/ \
      --exclude="app/host-bridge.ts" --exclude="app/main.tsx"

Both exclusions matter: `main.tsx` is where the bridge is started, and a plain `--delete` sync
silently removes that call — the desk still renders, but every Agent command times out.
`tests/director-agent-command-coverage.test.mjs` asserts the call is present.
