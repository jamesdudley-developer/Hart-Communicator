# HART Communicator

A browser-based HART communicator for field instruments. It runs in Chrome or Edge, talks to a USB HART modem (tested with a CP210x-based SM100-C), and installs as an app on Android and Windows.

## Features

- Identify devices, scan poll addresses 0–15
- Live PV, loop current and % of range, with a 4–20 mA gauge showing NAMUR NE 43 zones
- Device status in plain English, including extended status
- Device variables: type, value, status, limits, and PV/SV/TV/QV mapping
- Configure tag, descriptor, date, long tag, message, range, units and damping
- Loop test, loop current (D/A) trim, sensor trim, zero, push-button ranging
- Poll address, clear configuration-changed flag, device restart
- Confirmation before every write, with a safety check for anything that moves the output
- Change history you can share for calibration records
- Works offline once installed

## Supported browsers

| Platform | Browser | Connection |
|---|---|---|
| Android | Chrome | WebUSB (built-in CP210x driver) |
| Windows | Edge or Chrome | Web Serial |

iPhone and iPad are not supported because Safari has no USB or serial access.


