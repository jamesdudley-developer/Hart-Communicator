# Changelog

## 4.6.0

- **Model code breakdown in the device report.** Each model number the device holds is now broken down code by code under "Model code and options", using Emerson's ordering tables. Covered so far: the Rosemount 2088 (product data sheet 00813-0100-4690 Rev QC) and the general part of a Rosemount 1199 seal system code (data sheet 00813-0100-4016 Rev HA: seal location, fill fluid, capillary, capillary length and seal type). Positions not in the data sheets on hand show "Not decoded" rather than a guess. Model numbers from other products are listed as before, without a breakdown.
- **Device ID in decimal** on the Device tab and in the report, matching how AMS shows it (for example 11714156 instead of B2 BE 6C).

## 4.5.0

- **Rosemount 2088 device revision 9 decoded.** Model numbers 1 to 3 (Commands 148, 160, 162), materials and remote seals (Command 128) and alarm and saturation levels (Command 142) now read on a 2088 at device revision 9, so the device report fills its model code and materials section. Decoded from captures of AMS reading PI-5102 and checked field by field against the AMS screens. The 2088 FDS on hand is still treated as not genuine, so only these capture-checked reads are sent; nothing else device-specific is.
- **Command 128 map improved** for the 3051 revision 7 too: remote seal type (EFW, RTW) and sensor range are now confirmed, 1/2 in NPTF process connection is recognised, and the earlier "possibly sensor module serial" guess was dropped (it didn't hold on the 2088).
- **Serial numbers.** On the 2088, AMS shows Command 16 (final assembly number) as the transmitter serial number, so the Device tab and report label it "Serial number (final assembly)". The sensor serial number continues to come from Command 14.
- **Command console:** alarm direction, transfer function and write protection now show their meaning, for example "0 (High)".
- **Capture report:** Copy report now always lists the last reply of Commands 0, 13, 14, 15, 16 and 20, so one pasted report has the identity, serial numbers and range.
- Device tab no longer shows "null" for fields a HART 5 device doesn't report.

## 4.4.0

- **Device report.** New "Device report" panel on the Device tab. It reads the device again and opens a printable A4 report: site and location, device identification, range and output, sensor limits and serial number, process values at the time of the report, device status, changes written this session and notes. "Save as PDF" uses the phone's or PC's own print dialog, so nothing leaves the device.
- Site and purpose are remembered on the phone between reports. Each report gets a number that starts with the instrument tag (for example PT-205_20261019-1839); it also becomes the PDF file name and appears in every page footer.
- The report reads universal and common-practice commands (0, 2, 3, 7, 12, 13, 14, 15, 16, 20, 48, 50) on every device.
- **Model code, materials and remote seals** for the Rosemount 3051 at device revision 7, using the reads decoded from the LT-405AA capture: model numbers 1 to 3 (Commands 148, 160, 162), materials of construction and remote seal details (Command 128, with not-yet-verified fields marked "unconfirmed") and alarm and saturation levels (Command 142, shown under Range and output). Only plain reads marked confirmed or partly decoded are sent, and only when the device type and revision match. Other devices and revisions show "Not yet decoded" in that section until a capture is decoded for them.
- Reports from the simulator carry a clear "Simulated device" banner.

## 4.3.1

- **Fix: installed apps not seeing updates.** The app now asks for its update file by version number, so a cached older copy (on the phone or at Cloudflare) can't hide a new release. It also checks for updates whenever the app is brought back on screen, not only when it's first opened.

## 4.3.0

- **Capture tab: Clear captures button.** Discards the loaded capture, the comparison and any listen recording so you can start fresh. It needs a second tap within 3 seconds, and is unavailable while listening.
- **Rosemount 3051 device revision 7 decoded.** Captures from this revision now name and decode its device-specific reads: Command 142 alarm and saturation levels (mA), Commands 148, 160 and 162 model numbers 1 to 3, and Command 128 materials of construction (partly mapped). Command 139 is labelled but not yet confirmed. Decoded from a capture of AMS reading LT-405AA and checked against the AMS screens; it isn't in the FDS on hand, so the Device tab still flags revision 7 as undocumented.
- Decoded rows are tagged **Decoded**, **Partly decoded** or **Unconfirmed**, and **Copy report** now includes the decoded values under each device-specific command.

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
