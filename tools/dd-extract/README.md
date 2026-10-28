# DD extraction from manufacturer DTM installers

These scripts pull the device-specific HART command layouts out of Emerson DTM installers and generate
`public/dd-data.js`. They use only Python's standard library plus `objdump` (binutils). They are not part
of the app and never run in the browser.

Run every script with `python3 -I`, and unpack each installer into its own empty folder.

## Installer formats seen so far

| Installer | How to unpack | Where the DD is |
|---|---|---|
| Older Emerson HART DTMs (2051 V10.02, 3144P): `Setup.msi` with `Disk1.cab` to `Disk4.cab` | `cab.py OUT Disk1.cab Disk2.cab Disk3.cab Disk4.cab` (MSZIP; each CAB is its own folder) | `DDCEPMH<mfr><type><rev><ddrev>.dll`, for example `DDCEPMH26550A02.dll` = Rosemount 0x26, type 0x55 (2051), device revision 10, DD revision 2. This is the DD compiled to a VB6 DLL by the CodeWrights DDConverter. |
| Newer Emerson WirelessHART DTMs (648, 775 THUM): one InstallShield `.exe` | `isx.py SETUP.exe OUT` (ISSetupStream: name-keyed XOR then zlib) gives an `.msi`; `ole.py MSI OUT` pulls its CAB stream; `cab2.py CAB OUT` extracts the files | XML files: a `<commandSection>` file with each command's request and reply params (position, length, type), a configuration file with `<dataItem>` and `<enumeration>` definitions, and a string table for the labels |
| FDI packages (5408 FF) | `isx.py`, `ole.py`, `cab2.py`, then unzip `package.zip` | `fdipackage/edd/*.ff6` (FOUNDATION Fieldbus, not HART). A HART FDI package would hold a tokenized `.fm8`, which these scripts don't read. |

## VB6 DD DLLs (`vbdd.py`)

- Every DD item has a factory function, reached from a name-to-factory dispatch table (`push name; call strcmp; ... call factory`).
- A command factory sets the command number through vtable call `+0x20` on the command object.
- `call +0x2c` starts a transaction's request and `call +0x38` starts its reply. Item names are loaded with `mov edx, <UTF-16 string>` and appear in reverse wire order inside each block.
- An indexed reference such as `sensor_variables[sensor_number].LOWER_TRIM_VALUE` appears as the array name, then the index variable, then an upper-case member key. The member key is resolved through the first element collection (`sensor_1_variables`).
- A variable's type is set through `call +0x40`: 0 float, 1 double, 2 integer, 3 unsigned, 4 enum, 5 bit-enum, 6 index, 7 ASCII, 8 packed ASCII (size in characters), 11 date. Its size is set through `call +0x48`.
- Enum entries: `push <enum class>`, then a push of the value and `call +0x20`, then the label string and `call +0x28`.

## Regenerating `public/dd-data.js`

```
python3 -I vbdd.py DDCEPMH26550A02.dll vb_2051.json
python3 -I vbdd.py DDCEPMH26190502.dll vb_3144P.json
python3 -I xmldtm.py x648 xml_648.json
python3 -I xmldtm.py x775 xml_775.json
python3 -I gen_dd_data.py ../../public/dd-data.js \
  "2051r10=vb:vb_2051.json:Emerson HART DTM 2051 V10.02 (DD DDCEPMH26550A02: device revision 10, DD revision 2)" \
  "3144Pr5=vb:vb_3144P.json:Emerson HART DTM 3144P (DD DDCEPMH26190502: device revision 5, DD revision 2)" \
  "648r2=xml:xml_648.json:Emerson 648 V02 Wireless DTM 265802h 1.1.5 (device revision 2)" \
  "775r1=xml:xml_775.json:Emerson THUM V01 Wireless DTM 264F01h 1.1.3 (device revision 1)"
```

Then bump the app version (see `CLAUDE.md`) and point the matching profile in `public/profiles.js` at the new key with `dd: { <devRev>: '<key>' }`.
