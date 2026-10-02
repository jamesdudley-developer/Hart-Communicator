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

## Deploy to Cloudflare (no command line needed)

### 1. Put the files on GitHub
1. Sign in to github.com and select **New repository**. Name it `hart-communicator`, keep it Public or Private, and select **Create repository**.
2. On the new repository page, select **uploading an existing file**.
3. Unzip the download on your computer, then drag **everything inside** the `hart-communicator` folder (the `public` folder, `README.md` and `wrangler.jsonc`) into the browser window.
4. Select **Commit changes**.

### 2. Connect Cloudflare Pages
1. In the Cloudflare dashboard, go to **Workers & Pages**, select **Create**, then the **Pages** tab, then **Connect to Git**.
2. Authorize GitHub and choose the `hart-communicator` repository.
3. Use these build settings:
   - Framework preset: **None**
   - Build command: *leave empty*
   - Build output directory: **public**
4. Select **Save and Deploy**. Your app will be live at `https://hart-communicator.pages.dev` (or similar).

Every time you commit a change on GitHub, Cloudflare redeploys automatically.

> If Cloudflare creates a **Worker** instead of a Pages project and asks for a deploy command, the included `wrangler.jsonc` already points it at the `public` folder, so the default deploy command works.

### 3. Install the app
- **Android:** open the site in Chrome, then tap **Install app** in the app bar (or Chrome menu, **Add to home screen**).
- **Windows:** open the site in Edge or Chrome and select the install icon in the address bar or the app bar.

## Publishing an update

When you change any file in `public`, also change the version number in two places so installed copies update:
- `public/sw.js`: `const VERSION = 'hart-3.0.1';`
- `public/app.js`: `const APP_VERSION = '3.0.1';`

Installed apps will show **A new version is ready** with an **Update** button.

## Project files

```
public/
  index.html             App layout
  styles.css             Styling (light and dark themes)
  app.js                 HART protocol, USB/serial drivers and app logic
  sw.js                  Offline support and updates
  manifest.webmanifest   Install settings and icons
  _headers               Security headers and USB/serial permissions for Cloudflare
  icons/                 App icons
wrangler.jsonc           Only used if Cloudflare sets the project up as a Worker
```

## Important

This app uses HART universal and common-practice commands only. It does not use device descriptions (DDs), so manufacturer-specific menus and methods are not available. It is not a registered HART host. For SIL-rated devices, verify configuration with the manufacturer's approved tools, and always put the loop in manual or bypass before changing anything that affects the 4–20 mA output.
