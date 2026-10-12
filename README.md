# VRM Dashboard Builder

Build your own live **Victron VRM dashboard** and host it on any PHP web host. You fill in a form and download a
ready-to-upload folder. No server setup, no database, no build tools.

**What the dashboard shows**

- **Live tiles:** battery state of charge, voltage, current, power, time-to-go; solar; AC and DC loads; inverter/charger and DC-DC status
- **History charts:** state of charge, battery power, and solar vs loads, over 6 h, 24 h, 3 days or 7 days
- **Map & GPS tracks:** live position on map, topo or satellite layers, plus a year of trips with GPX/KML download (needs a GPS on the GX)
- **Tanks** (Mopeka and others) and **climate** (RuuviTag and others), using your VRM device names
- **All devices:** a searchable list of every value VRM reports, plus an active-alarm banner
- **Units and theme:** US or metric units, light/dark theme, and it works on phones

## Using the builder

**→ [Open the builder](https://patrickdarke.github.io/vrm-dashboard-builder/)**, then:

1. Enter your **installation ID**. It's the number in your VRM address: `vrm.victronenergy.com/installation/123456/…`
2. Paste a VRM **access token** from VRM → Preferences → Integrations → Access tokens. Make one just for this dashboard.
3. Choose a title, units, theme and panels, and optionally set a username and password.
4. Click **Download**. Then upload the folder to your website and open `https://your-site.com/<folder>/`.

To run the builder yourself, serve this repo from any static web server, for example `python3 -m http.server`, and open it.
Opening the file directly with `file://` won't work, because the builder fetches its template files.

## Privacy and security

- **The builder runs entirely in your browser.** The token and password are written into the zip on your own machine. Nothing is uploaded, and this repo has no backend.
- **The token stays on your server.** The browser never sees it. `config.php` is PHP, so the web server runs it instead of displaying it.
  Cached data is stored as PHP files that print nothing. On Apache, `.htaccess` also blocks both.
- **Passwords are stored only as a bcrypt hash**, made in the browser and checked by PHP's `password_verify`.
  With a password set, the dashboard refuses plain HTTP and slows down wrong guesses.
- **Turning off "Map & tracks" removes GPS data on the server.** Position readings are stripped from the API, and the track routes are disabled. This isn't just hiding the map.
- **Every response tells caches not to store it,** including the `X-Accel-Expires: 0` header that nginx page caches respect, and tells search engines not to index it.

Without a password, anyone with the link can see the dashboard, including your location if the map is on.

## Requirements

- PHP 7.4+ with cURL. This is standard on DreamHost, Bluehost, SiteGround, Hostinger and most shared hosts.
- HTTPS, if you use a password.
- A Victron GX device (Cerbo, Ekrano, Venus GX…) logging to VRM. The VRM log interval sets how fresh the data is, so 1 minute is best.

## How it works

```
browser ──▶ your-site.com/<folder>/index.php ──▶ vrmapi.victronenergy.com (VRM API v2)
              │  page + JSON API (?r=state|history|tracks|…)
              └─ config.php (token, settings) · cache/ (55 s live, 5 min history, 10 min tracks)
```

- **Live values** come from `/installations/{id}/diagnostics`.
- **History** comes from `/stats`, at 15-minute resolution up to 3 days and hourly for 7 days.
- **Device names** come from `/system-overview`.
- **GPS trips** come from `/gps-download`, which returns KML.
- VRM doesn't allow browser cross-origin requests, so the PHP side does all VRM calls.

## Project layout

```
index.html, builder.js, builder.css   the builder (static; JSZip + bcryptjs from cdnjs)
template/
  index.php     dashboard page + API + access control
  page.html     page template (panels marked <!--panel:x--> … <!--/panel:x-->)
  app.js        tiles, charts, tanks, climate, device list
  map.js        Leaflet map + track list
  style.css
  htaccess.txt  shipped as .htaccess (Apache hardening)
```

## License

MIT. See [LICENSE](LICENSE). Not affiliated with or endorsed by Victron Energy.
VRM is a trademark of Victron Energy B.V.
