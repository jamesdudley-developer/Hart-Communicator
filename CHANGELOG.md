# Changelog

## 4.2.1

- **Fix: two "CP2102 USB to UART Bridge Controller" entries in the Android USB picker, and the top one wouldn't connect.** If the chosen entry fails to open, the app now tries the other entry for the same modem automatically and logs which one worked. Applies to Connect and to listen mode.
- The modem is released when the page is closed or reloaded, so stale picker entries shouldn't build up.
- Unplugging a different USB device no longer drops the modem connection.

## 4.2.0

- **Wording follows the connected device.** The app works out what the device measures from the device profile, the PV's device variable class (Command 54) or the PV units (Command 15), and shows it on the Device tab as "Measurement".
- Configure tab: the units list only offers units that fit the device (a temperature transmitter gets °C, °F, K, °R plus mV and ohms). Sensor trim, zero and push-button ranging text and confirmations talk about temperature, pressure or level to suit, or stay generic when the type isn't known.
- No brand names unless the device identifies its maker. The "sensor trim not supported" message names the maker's own software only when the manufacturer ID matches (AMS for Rosemount, PACTware with the VEGA DTM for VEGA, FieldCare or DeviceCare for Endress+Hauser); otherwise it says "the manufacturer's configuration software". The Capture tab no longer assumes AMS.
- Tools tab: sensor setup is hidden for devices that aren't temperature inputs, and no longer lists Rosemount models on other makers' devices.

## 4.1.0

- **More USB HART modems on Android.** WebUSB now has drivers for Silicon Labs CP210x, FTDI, Prolific PL2303, WCH CH340/CH341 and standard USB serial (CDC) chips, in a new shared file `usb-serial.js`.
- **Pepperl+Fuchs (MACTek) Viator USB HART Interface, HM-PF-USB-010031** (and the older HM-MT-USB-010031): shows in the modem list (USB vendor ID `0x10E5`, product `0x0031`) and its chip is detected automatically when it opens.
- New **USB chip** choice on the Live tab, for forcing a driver if detection picks the wrong one.
- Every WebUSB connection writes the modem's USB description to the log, so an unknown modem can be identified from a shared log.
- Listen mode (Capture tab) uses the same drivers, so a Viator can be the listening modem. It still never transmits.
- The Wishcolor SMC-100C (CP210x) path is unchanged.

## 4.0.0

Combines the deployed 3.0 app with the decoding, sniffing and device-profile work from October.

- **Tools tab: temperature sensor setup** for the Rosemount 644, 3144P and 648 (read and write sensor type and wiring with the commands from each FDS). Writing stays locked until the byte layout is learned from a capture or entered from the FDS. Includes a dry-run preview of the exact bytes.
- **Tools tab: command console.** Send any HART command and see the decoded reply. Reads go straight out; writes, actions and unknown commands go through the usual confirmation and safety check.
- **Capture tab:** open serial-monitor logs of AMS (HHD, Device Monitoring Studio, Electronic Team, Portmon, hex or binary), listen on the loop with a second modem, compare before/after captures, copy a report or a profile draft, and analyse this app's own traffic.
- **Learn layouts from captures:** when a capture shows AMS writing a sensor setup, the app can save that layout for the device type and revision.
- **Device profiles** from the Rosemount FDS documents (644, 3144P, 648, 3051C, 2051, 2088), shown on the Device tab with revision checks and warnings for undocumented revisions and the suspect 2051/2088 specs.
- **Simulator:** choose "Simulator (no modem)" to practise with a simulated HART 5 temperature transmitter (poll 0) and HART 7 pressure transmitter (poll 1).
- Opening a device from the scan list now stops the scan first.

## 3.0.0

- First public release: installable PWA with live values, device variables, configuration, loop test, D/A trim and sensor trim.
