# Changelog

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
