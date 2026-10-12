// VRM Dashboard — front end. Talks only to its own index.php (never to VRM directly).
(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  // Settings injected by index.php from config.php (units, theme, which panels exist).
  const CFG = Object.assign({ units: "us", theme: "auto" }, window.DASH_CONFIG || {});
  const US = CFG.units !== "metric";
  // Local server routes are api/<route>; the DreamHost index.php takes ?r=<route>.
  const API_BASE = window.DASH_API || "api/";
  // Every call carries a unique _= so a server-side page cache can never answer with stale data.
  const api = (route) => {
    const url = API_BASE.includes("?") ? API_BASE + route.replace("?", "&") : API_BASE + route;
    return url + (url.includes("?") ? "&" : "?") + "_=" + Date.now();
  };
  window.dashApi = api;
  let state = null;
  let hours = 24;
  let historyData = {};
  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

  // ---------- formatting ----------
  const num = (v) => (v === null || v === undefined || v === "" || isNaN(Number(v)) ? null : Number(v));
  function fmt(v, digits = 0) {
    const n = num(v);
    return n === null ? "—" : n.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
  }
  function rec(key) { return state && state.metrics ? state.metrics[key] : null; }
  function raw(key) { const r = rec(key); return r ? num(r.rawValue) : null; }
  // Everything is displayed in US units. VRM reports metric; convert by the unit on its formatted value.
  function imperial(fv, rv) {
    if (fv === null || fv === undefined || !US) return fv;
    const m = String(fv).trim().match(/^(-?[\d.,]+)\s*(°C|hPa|M3|m3|L|m\/s|km\/h|km|m|kg)$/);
    if (!m) return fv;
    let v = num(rv);
    if (v === null) v = Number(m[1].replace(/,/g, ""));
    if (isNaN(v)) return fv;
    switch (m[2]) {
      case "°C": return fmt(v * 9 / 5 + 32, 1) + " °F";
      case "hPa": return fmt(v * 0.02953, 2) + " inHg";
      case "M3": case "m3": return fmt(v * 264.172, 1) + " gal";
      case "L": return fmt(v * 0.264172, 1) + " gal";
      case "m/s": return fmt(v * 2.23694) + " mph";
      case "km/h": return fmt(v * 0.621371) + " mph";
      case "km": return fmt(v * 0.621371, 1) + " mi";
      case "m": return fmt(v * 3.28084) + " ft";
      case "kg": return fmt(v * 2.20462, 1) + " lb";
    }
    return fv;
  }
  const disp = (r) => (r ? imperial(r.formattedValue, r.rawValue) : null);
  function shown(key) { const r = rec(key); return r ? (disp(r) || "—") : null; }
  function ago(ts) {
    if (!ts) return "—";
    const s = Math.max(0, Date.now() / 1000 - ts);
    if (s < 90) return Math.round(s) + "s ago";
    if (s < 5400) return Math.round(s / 60) + " min ago";
    if (s < 172800) return Math.round(s / 3600) + " h ago";
    return Math.round(s / 86400) + " d ago";
  }
  function esc(s) {
    return String(s === null || s === undefined ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  }
  function kv(el, rows) {
    el.innerHTML = rows.filter((r) => r[1] !== null && r[1] !== undefined && r[1] !== "—")
      .map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("") || `<dt class="muted">No data</dt><dd></dd>`;
  }

  // ---------- theme ----------
  try {
    const t = localStorage.getItem("vrm-theme");
    if (t) document.documentElement.dataset.theme = t;
  } catch (e) { /* storage unavailable */ }
  if (!document.documentElement.dataset.theme && (CFG.theme === "light" || CFG.theme === "dark")) {
    document.documentElement.dataset.theme = CFG.theme; // builder's default; the ◐ button still overrides
  }
  $("theme-btn").onclick = () => {
    const dark = document.documentElement.dataset.theme
      ? document.documentElement.dataset.theme === "dark"
      : matchMedia("(prefers-color-scheme: dark)").matches;
    const next = dark ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("vrm-theme", next); } catch (e) { /* ignore */ }
    drawCharts();
    window.dispatchEvent(new CustomEvent("dash:theme"));
  };

  // ---------- tiles ----------
  function renderTiles() {
    const soc = raw("soc");
    $("soc").textContent = soc === null ? "—" : fmt(soc, soc < 100 ? 1 : 0);
    $("soc-fill").style.width = (soc === null ? 0 : Math.max(0, Math.min(100, soc))) + "%";

    const v = raw("batt_v"), a = raw("batt_a");
    let w = raw("batt_w");
    if (w === null && v !== null && a !== null) w = v * a;
    const ttg = raw("ttg");
    let ttgText = ttg !== null && ttg <= 0 ? null : shown("ttg"); // 0 while charging means "n/a"
    if (ttg !== null && ttg > 0) {
      // VRM reports TTG in hours ("200.08 h"); older monitors report seconds.
      const hrs = /h\s*$/.test(ttgText || "") ? ttg : ttg / 3600;
      const h = Math.floor(hrs), m = Math.round((hrs - h) * 60);
      ttgText = h >= 48 ? `${fmt(hrs / 24, 1)} days` : `${h}h ${String(m).padStart(2, "0")}m`;
    }
    kv($("batt-kv"), [
      ["Voltage", v === null ? null : fmt(v, 2) + " V"],
      ["Current", a === null ? null : fmt(a, 1) + " A"],
      ["Power", w === null ? null : (w > 0 ? "+" : "") + fmt(w) + " W"],
      ["State", shown("batt_state") || (w === null ? null : w > 5 ? "Charging" : w < -5 ? "Discharging" : "Idle")],
      ["Time to go", ttgText],
      ["Consumed", shown("consumed_ah")],
      ["Temperature", shown("batt_temp")],
    ]);

    const sw = raw("solar_w");
    $("solar-w").textContent = fmt(sw);
    kv($("solar-kv"), [
      ["Today", shown("solar_today")],
      ["Peak today", shown("solar_max_w_today")],
      ["PV voltage", shown("pv_v")],
      ["State", shown("solar_state")],
    ]);

    const ac = raw("ac_load_w"), dc = raw("dc_load_w");
    const total = (ac || 0) + (dc || 0);
    $("load-w").textContent = ac === null && dc === null ? "—" : fmt(total);
    kv($("load-kv"), [
      ["AC loads", ac === null ? null : fmt(ac) + " W"],
      ["DC loads", dc === null ? null : fmt(dc) + " W"],
      ["Shore power", shown("shore")],
    ]);

    kv($("chg-kv"), [
      ["MultiPlus", shown("vebus_state")],
      ["Switch", shown("vebus_switch")],
      ["AC in", shown("ac_in_v") ? `${shown("ac_in_v")} · ${shown("ac_in_w") || "—"}` : shown("ac_in_w")],
      ["AC out", shown("ac_out_w")],
      ["Orion XS", shown("dcdc_state")],
      ["Orion out", shown("dcdc_out_a")],
      ["Orion in", shown("dcdc_in_v")],
      ["Orion charged", shown("dcdc_ah")],
    ]);
  }

  // ---------- status, alarms ----------
  function renderStatus() {
    const pill = $("status-pill");
    pill.classList.remove("live", "stale", "err");
    $("site-sub").textContent = `VRM site ${state.site} · polling every ${state.poll_seconds}s`;
    const err = $("error");
    if (state.error) {
      pill.classList.add("err");
      $("status-text").textContent = state.fetched_at ? "Error · last ok " + ago(state.fetched_at) : "Error";
      err.hidden = false;
      err.innerHTML = `<span class="ico">✕</span><div><b>Can't reach VRM.</b> ${esc(state.error)}</div>`;
    } else {
      err.hidden = true;
      const age = Date.now() / 1000 - (state.data_ts || 0);
      pill.classList.add(age < 20 * 60 ? "live" : "stale");
      $("status-text").textContent = (age < 20 * 60 ? "Live" : "Stale") + " · GX data " + ago(state.data_ts);
    }
    const alarms = state.alarms || [];
    const box = $("alarms");
    box.hidden = alarms.length === 0;
    box.innerHTML = alarms.map((al) =>
      `<div class="alarm ${al.level}" role="alert"><span class="ico">${al.level === "critical" ? "✕" : "!"}</span>
       <div><b>${al.level === "critical" ? "Alarm" : "Warning"}:</b> ${esc(al.device)} — ${esc(al.description)}: ${esc(imperial(al.value))}
       <span class="muted"> · ${ago(al.timestamp)}</span></div></div>`).join("");
    $("foot").textContent = state.fetched_at
      ? `${state.record_count || 0} attributes · fetched ${new Date(state.fetched_at * 1000).toLocaleTimeString()} · data via VRM API`
      : "";
  }

  // ---------- device helpers (tanks, climate, raw) ----------
  function field(dev, ...names) {
    for (const n of names) {
      const r = dev.records.find((r) => (r.description || "").toLowerCase() === n);
      if (r) return r;
    }
    for (const n of names) {
      const r = dev.records.find((r) => (r.description || "").toLowerCase().includes(n));
      if (r) return r;
    }
    return null;
  }
  function deviceLabel(dev, fallback) {
    const names = state.names || {};
    for (const k in names) {
      const n = names[k];
      if (String(n.name) === String(dev.device) && String(k.split("|")[1]) === String(dev.instance) && n.label) return n.label;
    }
    for (const k in names) {
      const n = names[k];
      if (String(k.split("|")[1]) === String(dev.instance) && n.label &&
          (n.name || "").toLowerCase().split(" ")[0] === dev.device.toLowerCase().split(" ")[0]) return n.label;
    }
    const r = field(dev, "tank custom name", "temperature custom name", "custom name");
    if (r && r.formattedValue) return r.formattedValue;
    return fallback;
  }

  function renderTanks() {
    const tanks = (state.devices || []).filter((d) => /tank/i.test(d.device));
    const el = $("tanks");
    if (!el) return;
    if (!tanks.length) { el.innerHTML = `<p class="muted">No tank sensors reporting.</p>`; return; }
    el.innerHTML = tanks.map((t) => {
      const lvl = field(t, "level", "tank level");
      const rem = field(t, "remaining", "tank remaining");
      const fluid = field(t, "fluid type");
      const pct = lvl ? num(lvl.rawValue) : null;
      const cls = pct === null ? "" : pct < 10 ? "crit" : pct < 25 ? "low" : "";
      const cap = field(t, "tank capacity", "capacity");
      const remText = rem ? (cap ? `${disp(rem)} of ${disp(cap)}` : disp(rem)) : null;
      const sub = [fluid && fluid.formattedValue, remText].filter(Boolean).join(" · ");
      return `<div class="tank-row">
        <div class="tank-name" title="${esc(deviceLabel(t, "Tank " + t.instance))}">${esc(deviceLabel(t, "Tank " + t.instance))}<small>${esc(sub)}</small></div>
        <div class="tank-track" role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct === null ? "" : pct}">
          <div class="tank-fill ${cls}" style="width:${pct === null ? 0 : Math.max(0, Math.min(100, pct))}%"></div></div>
        <div class="tank-pct">${pct === null ? "—" : fmt(pct) + "%"}</div></div>`;
    }).join("");
  }

  function renderClimate() {
    const temps = (state.devices || []).filter((d) => /temperature|ruuvi/i.test(d.device));
    const el = $("climate");
    if (!el) return;
    if (!temps.length) { el.innerHTML = `<p class="muted">No temperature sensors reporting.</p>`; return; }
    el.innerHTML = temps.map((t) => {
      const temp = field(t, "temperature");
      const hum = field(t, "humidity");
      const pres = field(t, "pressure", "atmospheric pressure");
      const batt = field(t, "battery voltage", "sensor battery");
      const tv = temp ? num(temp.rawValue) : null;
      const meta = [hum && hum.formattedValue + " RH", pres && disp(pres)].filter(Boolean).join(" · ");
      return `<div class="clim"><div class="n" title="${esc(deviceLabel(t, "Sensor " + t.instance))}">${esc(deviceLabel(t, "Sensor " + t.instance))}</div>
        <div class="v">${tv === null ? esc(temp ? disp(temp) : "—") : (US ? fmt(tv * 9 / 5 + 32, 1) + "<small>°F</small>" : fmt(tv, 1) + "<small>°C</small>")}</div>
        <div class="m">${esc(meta) || "&nbsp;"}</div>
        ${batt ? `<div class="m">Tag battery ${esc(disp(batt))}</div>` : ""}</div>`;
    }).join("");
  }

  const openDevices = new Set();
  function renderDevices() {
    if (!$("devices")) return;
    const q = $("filter").value.trim().toLowerCase();
    const el = $("devices");
    el.innerHTML = (state.devices || []).map((d) => {
      const key = d.device + "|" + d.instance;
      const rows = d.records.filter((r) => !q || (d.device + " " + (r.description || "") + " " + (disp(r) || "")).toLowerCase().includes(q));
      if (!rows.length) return "";
      const label = deviceLabel(d, "");
      return `<details class="dev" data-key="${esc(key)}" ${openDevices.has(key) || q ? "open" : ""}>
        <summary>${esc(d.device)}${label && label !== d.device ? ` · ${esc(label)}` : ""}
          <span class="muted">instance ${esc(d.instance)} · ${rows.length} attributes</span></summary>
        <table class="attrs"><tbody>${rows.map((r) =>
          `<tr><td>${esc(r.description)} <span class="muted">${esc(r.code || "")}</span></td><td>${esc(disp(r))}</td><td>${ago(r.timestamp)}</td></tr>`).join("")}
        </tbody></table></details>`;
    }).join("") || `<p class="muted">No matching attributes.</p>`;
    el.querySelectorAll("details.dev").forEach((det) => {
      det.addEventListener("toggle", () => {
        if (det.open) openDevices.add(det.dataset.key); else openDevices.delete(det.dataset.key);
      });
    });
  }
  if ($("filter")) $("filter").addEventListener("input", () => state && renderDevices());

  // ---------- charts ----------
  // Break lines across gaps longer than this (s). Hosted 7d history comes from
  // VRM at hourly resolution, so the threshold widens with the range.
  let GAP = 35 * 60;

  function niceTicks(min, max, count) {
    const span = max - min || 1;
    const step0 = span / count;
    const mag = Math.pow(10, Math.floor(Math.log10(step0)));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= count) || 10 * mag;
    const out = [];
    for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) out.push(+v.toFixed(6));
    return out;
  }

  function lineChart(el, series, opts) {
    const has = series.some((s) => s.points.length > 1);
    if (!has) {
      el.innerHTML = `<div class="empty">Collecting history — check back in a few minutes.</div>`;
      return;
    }
    const W = el.clientWidth, H = el.clientHeight;
    const m = { l: 44, r: opts.endLabels ? 60 : 12, t: 10, b: 24 };
    if (W < m.l + m.r + 40 || H < 60) return; // not laid out yet; resize handler redraws
    const now = Date.now() / 1000;
    const x0 = now - hours * 3600, x1 = now;
    let lo = opts.yMin !== undefined ? opts.yMin : Infinity;
    let hi = opts.yMax !== undefined ? opts.yMax : -Infinity;
    if (opts.yMin === undefined || opts.yMax === undefined) {
      series.forEach((s) => s.points.forEach(([, v]) => {
        if (opts.yMin === undefined) lo = Math.min(lo, v);
        if (opts.yMax === undefined) hi = Math.max(hi, v);
      }));
      if (opts.zero) { lo = Math.min(lo, 0); hi = Math.max(hi, 0); }
      if (lo === hi) { lo -= 1; hi += 1; }
      const pad = (hi - lo) * 0.08;
      if (opts.yMin === undefined) lo -= pad;
      if (opts.yMax === undefined) hi += pad;
    }
    const ticks = niceTicks(lo, hi, 4);
    lo = Math.min(lo, ticks[0]); hi = Math.max(hi, ticks[ticks.length - 1]);
    const X = (t) => m.l + ((t - x0) / (x1 - x0)) * (W - m.l - m.r);
    const Y = (v) => m.t + (1 - (v - lo) / (hi - lo)) * (H - m.t - m.b);

    let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(opts.label)}">`;
    ticks.forEach((t) => {
      svg += `<line class="${t === 0 && opts.zero ? "zero-line" : "grid-line"}" x1="${m.l}" x2="${W - m.r}" y1="${Y(t)}" y2="${Y(t)}"/>`;
      svg += `<text class="axis-text" x="${m.l - 8}" y="${Y(t) + 4}" text-anchor="end">${fmt(t, Math.abs(t) < 10 && t % 1 ? 1 : 0)}</text>`;
    });
    // time ticks
    const stepH = hours <= 6 ? 1 : hours <= 24 ? 4 : hours <= 72 ? 12 : 24;
    const d = new Date(x0 * 1000); d.setMinutes(0, 0, 0);
    while (d.getHours() % stepH) d.setHours(d.getHours() + 1);
    for (let t = d.getTime() / 1000; t <= x1; t += stepH * 3600) {
      if (t < x0) continue;
      const dt = new Date(t * 1000);
      const label = stepH >= 24 || (dt.getHours() === 0 && hours > 24)
        ? dt.toLocaleDateString(undefined, { weekday: "short" })
        : dt.toLocaleTimeString(undefined, { hour: "numeric" });
      svg += `<text class="axis-text" x="${X(t)}" y="${H - 6}" text-anchor="middle">${label}</text>`;
    }
    const labelYs = [];
    series.forEach((s) => {
      let dPath = "", prev = null;
      s.points.forEach(([t, v]) => {
        if (t < x0) return;
        dPath += (prev === null || t - prev > GAP ? "M" : "L") + X(t).toFixed(1) + "," + Y(v).toFixed(1);
        prev = t;
      });
      if (opts.area && dPath) {
        const pts = s.points.filter(([t]) => t >= x0);
        if (pts.length > 1) {
          // area only over the latest contiguous run keeps gaps honest
          let area = "", start = null, last = null;
          pts.forEach(([t, v], i) => {
            if (start === null || t - last > GAP) {
              if (start !== null) area += `L${X(last).toFixed(1)},${Y(0)}Z`;
              area += `M${X(t).toFixed(1)},${Y(0)}L${X(t).toFixed(1)},${Y(v).toFixed(1)}`;
              start = t;
            } else area += `L${X(t).toFixed(1)},${Y(v).toFixed(1)}`;
            last = t;
            if (i === pts.length - 1) area += `L${X(t).toFixed(1)},${Y(0)}Z`;
          });
          svg += `<path d="${area}" fill="${s.color}" fill-opacity="0.12" stroke="none"/>`;
        }
      }
      svg += `<path d="${dPath}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
      const last = s.points[s.points.length - 1];
      if (last && last[0] >= x0) {
        svg += `<circle cx="${X(last[0])}" cy="${Y(last[1])}" r="4" fill="${s.color}" stroke="${css("--surface")}" stroke-width="2"/>`;
        if (opts.endLabels) {
          // Nudge apart labels whose lines end at nearly the same value.
          let ly = Y(last[1]) + 4;
          for (const used of labelYs) if (Math.abs(ly - used) < 12) ly = used + (ly <= used ? -12 : 12);
          labelYs.push(ly);
          svg += `<text class="end-label" x="${X(last[0]) + 8}" y="${ly}">${esc(s.label)}</text>`;
        }
      }
    });
    svg += `<line class="crosshair" id="${el.id}-x" x1="0" x2="0" y1="${m.t}" y2="${H - m.b}" visibility="hidden"/>`;
    series.forEach((s, i) => { svg += `<circle id="${el.id}-p${i}" r="4" fill="${s.color}" stroke="${css("--surface")}" stroke-width="2" visibility="hidden"/>`; });
    svg += `<rect x="${m.l}" y="0" width="${W - m.l - m.r}" height="${H}" fill="transparent" class="hit"/></svg>`;
    el.innerHTML = svg;

    const tip = $("tooltip");
    const hit = el.querySelector(".hit");
    const cross = el.querySelector(`#${el.id}-x`);
    hit.addEventListener("mousemove", (ev) => {
      const box = el.getBoundingClientRect();
      const t = x0 + ((ev.clientX - box.left - m.l) / (W - m.l - m.r)) * (x1 - x0);
      let rows = "", any = false, cx = null;
      series.forEach((s, i) => {
        const dot = el.querySelector(`#${el.id}-p${i}`);
        let best = null;
        for (const p of s.points) if (!best || Math.abs(p[0] - t) < Math.abs(best[0] - t)) best = p;
        if (best && Math.abs(best[0] - t) < GAP) {
          any = true; cx = X(best[0]);
          dot.setAttribute("cx", X(best[0])); dot.setAttribute("cy", Y(best[1])); dot.setAttribute("visibility", "visible");
          rows += `<div class="row"><span><i class="swatch" style="background:${s.color}"></i>${esc(s.label)}</span><b>${fmt(best[1], opts.digits || 0)} ${esc(opts.unit)}</b></div>`;
        } else dot.setAttribute("visibility", "hidden");
      });
      if (!any) { tip.hidden = true; cross.setAttribute("visibility", "hidden"); return; }
      cross.setAttribute("x1", cx); cross.setAttribute("x2", cx); cross.setAttribute("visibility", "visible");
      tip.innerHTML = `<div class="t">${new Date(t * 1000).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" })}</div>${rows}`;
      tip.hidden = false;
      const tw = tip.offsetWidth;
      tip.style.left = Math.min(window.innerWidth - tw - 8, ev.clientX + 14) + "px";
      tip.style.top = ev.clientY + 14 + "px";
    });
    hit.addEventListener("mouseleave", () => {
      tip.hidden = true; cross.setAttribute("visibility", "hidden");
      series.forEach((s, i) => el.querySelector(`#${el.id}-p${i}`).setAttribute("visibility", "hidden"));
    });
  }

  function combineLoads() {
    const ac = historyData.ac_load_w || [], dc = historyData.dc_load_w || [];
    if (!dc.length) return ac;
    if (!ac.length) return dc;
    const dcMap = new Map(dc.map(([t, v]) => [t, v]));
    return ac.map(([t, v]) => [t, v + (dcMap.has(t) ? dcMap.get(t) : 0)]);
  }

  function drawCharts() {
    if (!$("chart-soc")) return; // history panel turned off
    GAP = hours > 72 ? 150 * 60 : 35 * 60;
    lineChart($("chart-soc"), [{ label: "SOC", color: css("--batt"), points: historyData.soc || [] }],
      { yMin: 0, yMax: 100, unit: "%", digits: 1, area: true, label: "Battery state of charge" });
    let bw = historyData.batt_w || [];
    lineChart($("chart-battw"), [{ label: "Battery", color: css("--batt"), points: bw }],
      { zero: true, unit: "W", label: "Battery power" });
    lineChart($("chart-power"), [
      { label: "Solar", color: css("--solar"), points: historyData.solar_w || [] },
      { label: "Loads", color: css("--load"), points: combineLoads() },
    ], { yMin: 0, unit: "W", endLabels: true, label: "Solar vs loads" });
  }

  document.querySelectorAll("#range button").forEach((b) => {
    b.onclick = () => {
      document.querySelectorAll("#range button").forEach((x) => x.classList.toggle("on", x === b));
      hours = Number(b.dataset.h);
      loadHistory();
      window.dispatchEvent(new CustomEvent("dash:range", { detail: hours }));
    };
  });
  let rz;
  window.addEventListener("resize", () => { clearTimeout(rz); rz = setTimeout(drawCharts, 120); });
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", drawCharts);

  // ---------- data loading ----------
  async function loadState() {
    try {
      const r = await fetch(api("state"), { cache: "no-store" });
      state = await r.json();
    } catch (e) {
      state = Object.assign(state || {}, { error: "Local dashboard server is not running." });
    }
    renderStatus();
    if (state.metrics) {
      if ($("tiles")) renderTiles();
      renderTanks(); renderClimate(); renderDevices();
      window.dispatchEvent(new CustomEvent("dash:state", { detail: state }));
    }
  }
  async function loadHistory() {
    if (!$("chart-soc")) return; // history panel turned off: don't fetch it
    try {
      const r = await fetch(api("history?hours=" + hours), { cache: "no-store" });
      historyData = await r.json();
    } catch (e) { /* keep last */ }
    drawCharts();
  }
  $("refresh-btn").onclick = async () => {
    $("refresh-btn").disabled = true;
    try { await fetch(api("refresh"), { cache: "no-store" }); } catch (e) { /* surfaced via state */ }
    await loadState(); await loadHistory();
    $("refresh-btn").disabled = false;
  };

  window.dash = { hours: () => hours };
  loadState(); loadHistory();
  setInterval(loadState, 15000);
  setInterval(loadHistory, 60000);
  setInterval(() => state && renderStatus(), 5000);
})();
