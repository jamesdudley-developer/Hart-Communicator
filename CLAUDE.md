# HART Communicator

Browser-based HART communicator PWA. Talks to field devices through a USB HART modem from Chrome on Android (WebUSB) or Edge/Chrome on Windows (Web Serial). See `README.md` for the feature list.

## About the owner

James is an instrumentation technician, not a software developer. He edits through the GitHub web UI and does not use a terminal.

- Do the work yourself, then explain what changed in plain words. Don't hand him command-line steps.
- His test hardware: a Wishcolor SMC-100C HART modem (CP210x USB chip, vendor ID `0x10C4`), a Pepperl+Fuchs Viator USB HART Interface HM-PF-USB-010031 (vendor ID `0x10E5`, product `0x0031`, chip not yet confirmed) and a Pixel 9a.
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
- Transports: `SerialTransport` (Web Serial) and `UsbSerialTransport` (WebUSB, drives the modem's USB chip through `usb-serial.js`). Both run **1200 baud, 8 data bits, odd parity, 1 stop bit**. Don't change these.
- Framing: `frame()`, `parseFrame()`, `transact()`, `cmd()`. All bus traffic goes through `exclusive()` so only one transaction runs at a time; keep it that way.
- Device: `identify()`, `loadDetails()`, `scan()` (poll addresses 0–15), `liveLoop()`.
- Writes: `runWrite()` handles confirmation and the change history. `raw: true` returns the reply even for error response codes (used by the console).
- `SimTransport` drives the simulator in `sim.js`. `record()` keeps every byte sent and received for the Capture tab.
- Measurement type: `measKind()` (profile kind, then PV device variable class, then PV unit code), `kindText()` for trim and ranging wording, `applyKind()`, `fillUnitSelect()`. Keep wording device-neutral unless the device tells us otherwise; name a maker's software only through `HARTProfiles.hostTool(manufacturerId)`.
- Profiles and tools: `renderProfile()`, sensor setup (`readSensor`, `buildSensorWrite`, `writeSensor`), console (`sendConsole`). `window.HARTApp` is the bridge used by `capture.js`.

## Other files in `public/`

- `usb-serial.js` (`window.USBSerial`): WebUSB drivers for CP210x, FTDI, PL2303, CH34x and CDC-ACM, the known-modem table (`MODEMS`, including the P+F Viator USB, VID `0x10E5` PID `0x0031`, chip auto-detected), and chip detection by read-only probes. Used by the app and listen mode.
- `hart-core.js` (`window.HART`): frame codec, byte scanner, universal/common-practice command dictionary, serial-log importers, capture analysis, reports, passive listen mode.
- `profiles.js` (`window.HARTProfiles`): device profiles from Rosemount FDS documents and the per-device-type layout templates (localStorage). Don't add byte layouts to profiles without the FDS or a capture.
- `sim.js` (`window.HARTSim`): simulated HART 5 temperature and HART 7 pressure devices. Its 140/141 layout is simulator-only; simulator templates are never applied to real devices.
- `capture.js`: the Capture tab, including learning sensor layouts from captures.

## Safety rules (field devices are live)

- Every write to a device goes through `runWrite()` with a confirmation dialog. Never add a write path that skips it.
- Anything that moves the loop output (loop test, D/A trim, fixed current) must set `output: true` so the safety warning shows, and must leave a clear way to exit (`exitLoop()`).
- Don't remove the plain-English device status or the NAMUR NE 43 zones on the gauge.
- The passive listen mode in `hart-core.js` must never transmit.
- Sensor setup writes stay locked until a layout template exists for that device type, revision and transport (real or simulator).

## Before you finish

- Check the page loads with no console errors and the CSP isn't violated.
- Confirm `VERSION` and `CHANGELOG.md` were updated.
- Summarise the change for James in two or three plain sentences, including anything he should test on the real modem.
