// Location panel: live GPS position from the GX device + prefetched VRM track logs.
(function () {
  "use strict";
  if (!document.getElementById("map")) return; // location panel turned off
  const US = !(window.DASH_CONFIG && window.DASH_CONFIG.units === "metric");
  if (!window.L) {
    document.getElementById("map").innerHTML = '<p class="muted" style="padding:16px">Map library failed to load (offline?).</p>';
    return;
  }
  const $ = (id) => document.getElementById(id);
  const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const isDark = () => {
    const t = document.documentElement.dataset.theme;
    return t ? t === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
  };

  // ---------- map + base layers ----------
  const OSM = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
  const ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services/";
  const layers = {
    map: () => isDark()
      ? L.layerGroup([
        L.tileLayer(ESRI + "Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}",
          { maxZoom: 19, maxNativeZoom: 16, attribution: "Tiles &copy; Esri, HERE, Garmin, " + OSM }),
        L.tileLayer(ESRI + "Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}",
          { maxZoom: 19, maxNativeZoom: 16 }),
      ])
      : L.tileLayer(ESRI + "World_Street_Map/MapServer/tile/{z}/{y}/{x}",
        { maxZoom: 19, attribution: "Tiles &copy; Esri, HERE, Garmin, " + OSM }),
    topo: () => L.tileLayer("https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
      { maxZoom: 17, attribution: OSM + ', <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)' }),
    sat: () => L.tileLayer(ESRI + "World_Imagery/MapServer/tile/{z}/{y}/{x}",
      { maxZoom: 19, attribution: "Imagery &copy; Esri, Maxar, Earthstar Geographics" }),
  };
  let baseName = "map";
  try { baseName = localStorage.getItem("vrm-basemap") || "map"; } catch (e) { /* ignore */ }
  if (!layers[baseName]) baseName = "map";

  const map = L.map("map", { zoomControl: true, attributionControl: true, worldCopyJump: true }).setView([39, -98], 4);
  let base = layers[baseName]().addTo(map);
  function setBase(name) {
    baseName = name;
    map.removeLayer(base);
    base = layers[name]().addTo(map);
    document.querySelectorAll("#basemap button").forEach((b) => b.classList.toggle("on", b.dataset.l === name));
    try { localStorage.setItem("vrm-basemap", name); } catch (e) { /* ignore */ }
  }
  document.querySelectorAll("#basemap button").forEach((b) => {
    b.classList.toggle("on", b.dataset.l === baseName);
    b.onclick = () => setBase(b.dataset.l);
  });
  window.addEventListener("dash:theme", () => { if (baseName === "map") setBase("map"); drawTracks(false); });
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { if (baseName === "map") setBase("map"); drawTracks(false); });

  // Recenter-on-vehicle control
  const Recenter = L.Control.extend({
    options: { position: "topleft" },
    onAdd() {
      const div = L.DomUtil.create("div", "leaflet-bar");
      div.innerHTML = '<a href="#" title="Center on vehicle" role="button" aria-label="Center on vehicle" style="font-size:16px">◎</a>';
      L.DomEvent.on(div.firstChild, "click", (e) => { L.DomEvent.preventDefault(e); if (pos) map.setView(pos, Math.max(map.getZoom(), 14)); });
      return div;
    },
  });
  map.addControl(new Recenter());

  // ---------- units ----------
  let imperial = US;
  const dist = (km) => imperial ? `${(km * 0.621371).toFixed(km < 16 ? 1 : 0)} mi` : `${km.toFixed(km < 10 ? 1 : 0)} km`;
  const card = (deg) => ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][Math.round(((deg % 360) + 360) % 360 / 45) % 8];
  function ago(ts) {
    if (!ts) return "—";
    const s = Math.max(0, Date.now() / 1000 - ts);
    if (s < 90) return Math.round(s) + "s ago";
    if (s < 5400) return Math.round(s / 60) + " min ago";
    if (s < 172800) return Math.round(s / 3600) + " h ago";
    return Math.round(s / 86400) + " d ago";
  }

  // ---------- live position ----------
  let pos = null, marker = null, firstFix = true;
  window.addEventListener("dash:state", (ev) => {
    const m = ev.detail.metrics || {};
    const n = (k) => (m[k] && m[k].rawValue !== null && m[k].rawValue !== "" ? Number(m[k].rawValue) : null);
    const lat = n("gps_lat"), lon = n("gps_lon");
    const unit = m.gps_speed_unit ? String(m.gps_speed_unit.formattedValue || "").toLowerCase() : "mph";
    imperial = US; // follows the dashboard's unit setting, not the GX speed-unit setting
    const strip = $("gps-strip");
    if (lat === null || lon === null || isNaN(lat) || isNaN(lon)) {
      strip.innerHTML = '<div><dt>GPS</dt><dd class="muted">No fix reported by the GX</dd></div>';
      return;
    }
    const spd = n("gps_speed"), crs = n("gps_course"), alt = n("gps_alt");
    const spdTxt = spd === null ? "—" : imperial ? `${(spd * 2.23694).toFixed(0)} mph` : `${(spd * 3.6).toFixed(0)} km/h`;
    const moving = spd !== null && spd > 0.8;
    const fixTs = m.gps_lat.timestamp;
    strip.innerHTML = [
      ["Position", `${lat.toFixed(5)}, ${lon.toFixed(5)}`],
      ["Altitude", alt === null ? "—" : imperial ? `${Math.round(alt * 3.28084).toLocaleString()} ft` : `${Math.round(alt)} m`],
      ["Speed", moving ? spdTxt : "Parked"],
      ["Heading", crs === null || !moving ? "—" : `${Math.round(crs)}° ${card(crs)}`],
      ["Fix", ago(fixTs)],
    ].map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join("") +
      `<div><dd><a href="https://www.google.com/maps/search/?api=1&query=${lat},${lon}" target="_blank" rel="noopener">Open in Google Maps ↗</a></dd></div>`;

    pos = [lat, lon];
    const html = `<div class="pos-wrap">${moving && crs !== null ? `<div class="cone" style="transform:rotate(${crs}deg)"></div>` : ""}<div class="pos-dot"></div></div>`;
    const icon = L.divIcon({ className: "", html, iconSize: [16, 16], iconAnchor: [8, 8] });
    if (!marker) {
      marker = L.marker(pos, { icon, zIndexOffset: 1000, keyboard: false, title: (window.DASH_CONFIG && window.DASH_CONFIG.title) || "Vehicle" }).addTo(map);
    } else {
      marker.setLatLng(pos).setIcon(icon);
    }
    marker.bindTooltip(`${moving ? spdTxt : "Parked"} · fix ${ago(fixTs)}`);
    if (firstFix) {
      firstFix = false;
      fitView();
    }
  });

  // ---------- tracks ----------
  let tracks = [];
  let selected = new Set();
  let followRange = true;
  let hl = null;
  const trackLayer = L.layerGroup().addTo(map);
  const lines = {};

  function rangeSelection() {
    const hours = window.dash ? window.dash.hours() : 24;
    const since = Date.now() / 1000 - hours * 3600;
    return new Set(tracks.filter((t) => (t.end || t.start || 0) >= since).map((t) => t.id));
  }
  function fmtWhen(t) {
    if (!t.start) return { d: t.name, s: "" };
    const a = new Date(t.start * 1000), b = t.end ? new Date(t.end * 1000) : null;
    const d = a.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
    const tm = a.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
    const mins = b ? Math.round((b - a) / 60000) : null;
    const dur = mins === null ? "" : mins >= 90 ? `${(mins / 60).toFixed(1)} h` : `${mins} min`;
    return { d, s: `${tm}${dur ? " · " + dur : ""}` };
  }

  function renderList() {
    const ul = $("track-list");
    if (!tracks.length) {
      ul.innerHTML = '<li class="empty-li">No GPS tracks logged to VRM yet.</li>';
    } else {
      ul.innerHTML = tracks.slice().reverse().map((t) => {
        const w = fmtWhen(t);
        return `<li data-id="${esc(t.id)}" class="${hl === t.id ? "hl" : ""}">
          <input type="checkbox" aria-label="Show track ${esc(t.name)}" ${selected.has(t.id) ? "checked" : ""}>
          <div><div class="d">${esc(w.d)}</div><div class="s">${esc(w.s)}</div></div>
          <div class="km">${dist(t.km || 0)}</div></li>`;
      }).join("");
    }
    ul.querySelectorAll("li[data-id]").forEach((li) => {
      const id = li.dataset.id;
      li.querySelector("input").addEventListener("click", (e) => {
        e.stopPropagation();
        followRange = false; $("tracks-range").checked = false;
        if (e.target.checked) selected.add(id); else selected.delete(id);
        drawTracks(true);
      });
      li.addEventListener("click", () => {
        if (!selected.has(id)) {
          followRange = false; $("tracks-range").checked = false;
          selected.add(id);
          drawTracks(false);
        }
        if (lines[id]) map.fitBounds(lines[id].getBounds(), { padding: [30, 30], maxZoom: 16 });
      });
      li.addEventListener("mouseenter", () => highlight(id));
      li.addEventListener("mouseleave", () => highlight(null));
    });
    const shownKm = tracks.filter((t) => selected.has(t.id)).reduce((a, t) => a + (t.km || 0), 0);
    $("tracks-meta").textContent = tracks.length
      ? `${selected.size} of ${tracks.length} shown · ${dist(shownKm)}`
      : "";
    const ids = [...selected].join(",");
    for (const [el, fmt] of [[$("dl-gpx"), "gpx"], [$("dl-kml"), "kml"]]) {
      el.href = window.dashApi(`tracks/export?fmt=${fmt}&ids=${encodeURIComponent(ids)}`);
      el.setAttribute("aria-disabled", selected.size ? "false" : "true");
    }
  }

  function highlight(id) {
    hl = id;
    for (const k in lines) {
      const on = k === id;
      lines[k].eachLayer((l) => {
        if (l.options.className === "trk") l.setStyle({ weight: on ? 5 : 3, opacity: hl && !on ? 0.45 : 1 });
      });
      if (on) lines[k].bringToFront();
    }
    document.querySelectorAll("#track-list li[data-id]").forEach((li) => li.classList.toggle("hl", li.dataset.id === id));
  }

  function drawTracks(refit) {
    trackLayer.clearLayers();
    for (const k in lines) delete lines[k];
    const color = css("--track") || "#4a3aa7";
    tracks.filter((t) => selected.has(t.id)).forEach((t) => {
      const g = L.featureGroup();
      L.polyline(t.points, { color: "#ffffff", weight: 7, opacity: 0.75, interactive: false }).addTo(g);
      const w = fmtWhen(t);
      L.polyline(t.points, { color, weight: 3, opacity: 1, className: "trk", lineJoin: "round" })
        .bindTooltip(`${w.d} · ${w.s} · ${dist(t.km || 0)}`, { sticky: true })
        .on("mouseover", () => highlight(t.id)).on("mouseout", () => highlight(null))
        .addTo(g);
      L.circleMarker(t.points[0], { radius: 4, color, weight: 2, fillColor: "#fff", fillOpacity: 1, interactive: false }).addTo(g);
      L.circleMarker(t.points[t.points.length - 1], { radius: 4, color, weight: 2, fillColor: color, fillOpacity: 1, interactive: false }).addTo(g);
      g.addTo(trackLayer);
      lines[t.id] = g;
    });
    renderList();
    if (refit) fitView();
  }

  function fitView() {
    const b = L.latLngBounds([]);
    for (const k in lines) b.extend(lines[k].getBounds());
    if (pos) b.extend(pos);
    if (!b.isValid()) return;
    if (b.getNorthEast().equals(b.getSouthWest())) map.setView(b.getCenter(), 13);
    else map.fitBounds(b, { padding: [30, 30], maxZoom: 14 });
  }

  $("tracks-range").addEventListener("change", (e) => {
    followRange = e.target.checked;
    if (followRange) { selected = rangeSelection(); drawTracks(true); }
  });
  $("tracks-all").onclick = () => { followRange = false; $("tracks-range").checked = false; selected = new Set(tracks.map((t) => t.id)); drawTracks(true); };
  $("tracks-none").onclick = () => { followRange = false; $("tracks-range").checked = false; selected = new Set(); drawTracks(false); };
  window.addEventListener("dash:range", () => { if (followRange) { selected = rangeSelection(); drawTracks(true); } });

  let firstTracks = true;
  async function loadTracks() {
    try {
      const r = await fetch(window.dashApi("tracks"), { cache: "no-store" });
      const data = await r.json();
      const before = tracks.length;
      tracks = data.tracks || [];
      if (followRange) selected = rangeSelection();
      else selected = new Set([...selected].filter((id) => tracks.some((t) => t.id === id)));
      drawTracks(firstTracks || tracks.length !== before);
      firstTracks = false;
      if (data.error && !tracks.length) $("tracks-meta").textContent = "Track fetch failed — retrying";
    } catch (e) { /* server down; status pill already says so */ }
  }
  loadTracks();
  setInterval(loadTracks, 5 * 60 * 1000);
})();
