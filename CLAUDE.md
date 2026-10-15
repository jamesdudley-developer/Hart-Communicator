# HART Communicator

Browser-based HART communicator PWA. Talks to field devices through a USB HART modem from Chrome on Android (WebUSB) or Edge/Chrome on Windows (Web Serial). See `README.md` for the feature list.

## About the owner

James is an instrumentation technician, not a software developer. He edits through the GitHub web UI and does not use a terminal.

- Do the work yourself, then explain what changed in plain words. Don't hand him command-line steps.
- His test hardware: a Wishcolor SMC-100C HART modem (CP210x USB chip, vendor ID `0x10C4`) and a Pixel 9a.
- Ground protocol details in the HART specifications (FieldComm Group) or the device manufacturer's manual, and say which. Don't guess command numbers or byte layouts.

## Stack and rules

Plain HTML, CSS and JavaScript in `public/`. No framework, no build step, no npm, no external libraries.

- **Bump `VERSION` in `public/sw.js` whenever any file in `public/` changes**, and add a matching entry to `CHANGELOG.md`. Installed copies only update when the version changes; users get an "Update" toast.
- **Keep everything same-origin.** `public/_headers` sets a strict Content-Security-Policy (`script-src 'self'`, `connect-src 'self'`). No CDN scripts, no inline `<script>` blocks, no external API calls, or the app breaks.
- Any new file the app needs must be added to `ASSETS` in `public/sw.js` so it works offline.

## Deployment

Cloudflare Pages, build output directory `public`. `wrangler.jsonc` is only used if the project is set up as a Worker instead.

## Code map (`public/app.js`)

- Lookup tables near the top: `UNITS` (HART unit codes), `MFR` (manufacturer IDs), `TRANSFER`, `ALARM`, `RESP`/`RESP_CMD` (response codes), `STATUS_BITS`, `EXT_BITS`.
- Transports: `SerialTransport` (Web Serial) and `UsbCp210xTransport` (WebUSB, drives the CP210x directly). Both run **1200 baud, 8 data bits, odd parity, 1 stop bit**. Don't change these.
- Framing: `frame()`, `parseFrame()`, `transact()`, `cmd()`. All bus traffic goes through `exclusive()` so only one transaction runs at a time; keep it that way.
- Device: `identify()`, `loadDetails()`, `scan()` (poll addresses 0–15), `liveLoop()`.
- Writes: `runWrite()` handles confirmation and the change history.

## Safety rules (field devices are live)

- Every write to a device goes through `runWrite()` with a confirmation dialog. Never add a write path that skips it.
- Anything that moves the loop output (loop test, D/A trim, fixed current) must set `output: true` so the safety warning shows, and must leave a clear way to exit (`exitLoop()`).
- Don't remove the plain-English device status or the NAMUR NE 43 zones on the gauge.

## Before you finish

- Check the page loads with no console errors and the CSP isn't violated.
- Confirm `VERSION` and `CHANGELOG.md` were updated.
- Summarise the change for James in two or three plain sentences, including anything he should test on the real modem.
