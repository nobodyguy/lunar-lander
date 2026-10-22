# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm start`: dev server at http://localhost:8000. esbuild bundles `index.js` on each request and serves it from memory, so the source `index.js` is never overwritten. The service worker is not registered here, so nothing is served from cache.
- `npm run build`: production build into `dist/` (`build.mjs`). It bundles and minifies JS and CSS, minifies the HTML, injects the service worker registration, and builds `sw.js` with a content-hash `VERSION` and a `PRECACHE` list.
- `npm run preview`: builds, then serves `dist/`. Use this to test PWA and offline behaviour.
- `npm test`: runs every `tests/*.test.mjs` with `node:test`.
  - One file: `node --test tests/mapping.test.mjs`
  - One test: `node --test --test-name-pattern="threshold" tests/mapping.test.mjs`
- `npm run sim`: headless autopilot statistics for each difficulty. For more runs, use `npm run sim -- 200`.

There is no linter or formatter config. Pushing to `main` deploys `dist/` to GitHub Pages (`.github/workflows/pages.yml`, Node 22).

## Architecture

Plain ES modules, canvas rendering, no framework. The only runtime dependency is `@hangtime/grip-connect`, which handles the Bluetooth force sensors.

**Module pattern:** almost every module is a factory, `makeX(appState, ...)`, that returns an object of closures. `appState` (`helpers/state.js`) is a plain `Map` that `index.js` fills with shared things: canvas context, sizes, `settings`, `rules`, `theme`, `audioManager`, `seededRandom`, `forceInput`, and so on. Modules read what they need with `state.get(...)`.

**`index.js` is the orchestrator.** It owns:
- the animation loop (`animate`)
- the round lifecycle: `onGameEnd` and `resetRoundState`
- the pause logic: Settings open, or force controls waiting for a live sensor
- swapping the control scheme

The tutorial always uses `toyLander` with key/touch controls. The real game uses `gameControls()`, which returns `makeControls` (`lander/controls.js`) or `makeForceControls` (`lander/forcecontrols.js`) depending on settings. Both expose the same `attachEventListeners`/`detachEventListeners` shape.

**Daily challenge determinism:** `helpers/seededrandom.js` seeds from the UTC day index. It gives each consumer its own named stream (`terrain`, `lander`, `asteroids`), so adding or removing draws in one consumer doesn't change another's world. Draw anything world-affecting from the right stream, never from `Math.random`. A new consumer needs a new stream name.

**Settings and rules:**
- `settings.js` validates every value against `OPTIONS` (lists or numeric ranges) and persists to `localStorage`. Invalid stored values fall back to `DEFAULTS`.
- `helpers/rules.js` maps the force-mode difficulty to gravity, fuel, pad size, touchdown tolerances, autopilot gains, and disturbances or engine cutouts.

### Force sensor pipeline

`forcesensor/device.js` → `forcesensor/input.js` → `forcesensor/mapping.js` → `lander/forcecontrols.js` (+ `lander/autopilot.js`)

- **`device.js`** wraps the grip-connect devices listed in `DEVICES`. It tracks connection status, the latest force and the battery level, and reports a force of 0 whenever the stream has been quiet longer than `STALE_AFTER_MS`. A watchdog restarts a stalled stream.
- **The Progressor stops streaming after any command** (tare, battery read) until `START_WEIGHT_MEAS` is sent again. This was confirmed with logs on a real device. Devices with this behaviour are marked `commandsStopStream: true`, and the code restarts their stream after each command.
- **Battery reads never happen mid-flight.** They run only through `refreshBattery()`, which is called at round end and when Settings opens, and is skipped while the player is pulling.
- **`input.js`** applies the threshold hysteresis gate and announces fresh pulls, which also start a new round.
- **`mapping.js`** holds pure functions: force → throttle (curve, threshold, hover point). It is kept free of the DOM and device code, so the Settings panel previews exactly what the game will do.
- **`forcecontrols.js`** sets the main engine from the pull. `autopilot.js` is a cascaded P-controller that flies the steering thrusters to the nearest pad.
- **`panel.js`** is the Settings UI for the sensor and the in-game status pill.
- **Simulator:** open the game with `?sensor-sim` to list the Simulator device (`forcesensor/simulator.js`). Hold ↑ or W to pull, or set `window.simulatedForce` from a script.

### Headless simulation

`tests/landersim.mjs` copies the lander physics so the autopilot can be tested and tuned without a browser. Its integration step mirrors `_updateProps` in `lander/lander.js`, and its pad sizing mirrors `terrain.js`. Keep them in sync when changing lander physics or pad sizing. `tests/autopilot.test.mjs` and `npm run sim` both rely on it.

### PWA

`sw.js` precaches the files listed by `build.mjs`, with the cache name versioned by a content hash. `helpers/rangeresponse.js` answers `Range` requests from the cache, because Safari won't play cached audio from a plain 200. New releases download in the background and take over on the next launch.

## Conventions

- **Number display:** use `formatNumber` / `formatSpeed` / `formatHeight` from `helpers/helpers.js`, not `toFixed`. They are locale-aware (`Intl.NumberFormat`), and `signDisplay: "negative"` keeps values that round to zero from showing as `-0.0`. Look in `helpers/` before writing new utility code.
- **Comments** explain why, not what. Match the existing comment density.
- **Debugging a real sensor:** Web Bluetooth needs a user gesture, so pairing can't be automated. Start Chrome with `--remote-debugging-port=9222 --user-data-dir=<temp dir>`, pair manually, then read the page console over CDP (`http://127.0.0.1:9222/json/list` gives the tab's WebSocket URL).
