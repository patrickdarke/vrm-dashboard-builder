// VRM Dashboard Builder — runs entirely in the browser. The token and password are only
// ever written into the zip the visitor downloads; nothing is uploaded anywhere.
(function () {
  "use strict";

  const VERSION = "1.0.0";
  const REPO_URL = "https://github.com/patrickdarke/vrm-dashboard-builder";
  const TEMPLATE_FILES = ["index.php", "page.html", "app.js", "map.js", "style.css"];
  const PANELS = ["tiles", "history", "location", "lpg", "climate", "devices"];

  const $ = (id) => document.getElementById(id);
  const val = (id) => $(id).value.trim();

  if (REPO_URL) $("repo-link").href = REPO_URL; else $("repo-link").hidden = true;

  // ---------- segmented controls ----------
  const segValue = {};
  document.querySelectorAll(".seg[data-name]").forEach((seg) => {
    const name = seg.dataset.name;
    const on = seg.querySelector("button.on");
    segValue[name] = on ? on.dataset.v : seg.querySelector("button").dataset.v;
    seg.querySelectorAll("button").forEach((b) => {
      b.addEventListener("click", () => {
        seg.querySelectorAll("button").forEach((x) => {
          x.classList.toggle("on", x === b);
          x.setAttribute("aria-checked", x === b ? "true" : "false");
        });
        segValue[name] = b.dataset.v;
        update();
      });
    });
  });

  // ---------- show/hide secret fields ----------
  document.querySelectorAll("[data-toggle]").forEach((b) => {
    b.addEventListener("click", () => {
      const input = $(b.dataset.toggle);
      const show = input.type === "password";
      input.type = show ? "text" : "password";
      b.textContent = show ? "Hide" : "Show";
    });
  });

  // ---------- validation ----------
  function panels() {
    const out = {};
    document.querySelectorAll("#panels input").forEach((c) => { out[c.value] = c.checked; });
    return out;
  }
  function pwScore(pw) {
    if (!pw) return 0;
    let classes = 0;
    [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].forEach((re) => { if (re.test(pw)) classes++; });
    return Math.min(4, Math.floor(pw.length / 5) + (classes >= 3 ? 1 : 0));
  }
  function errors(forBuild) {
    const e = {};
    const site = val("site"), token = val("token"), pwOn = $("pw-on").checked;
    if (!/^\d{3,10}$/.test(site)) e.site = "Enter the numeric installation ID from your VRM address.";
    if (!/^[A-Za-z0-9._-]{20,200}$/.test(token)) e.token = "Paste the access token VRM showed you when you created it.";
    if (!val("title")) e.title = "Give the dashboard a title.";
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,40}$/.test(val("folder"))) e.folder = "Letters, numbers, - and _ only (no spaces).";
    if (pwOn) {
      const user = val("user"), pw = $("pw").value;
      if (!user || user.includes(":") || user.length > 40) e.user = "Choose a username (no colons).";
      if (pw.length < 8) e.pw = "Use at least 8 characters — this protects your live location.";
    }
    if (!forBuild) return e;
    return e;
  }
  const touched = new Set();
  function showErrors(e, all) {
    document.querySelectorAll(".err[data-for]").forEach((el) => {
      const k = el.dataset.for;
      const msg = (all || touched.has(k)) ? (e[k] || "") : "";
      el.textContent = msg;
      const input = $(k);
      if (input) input.classList.toggle("bad", !!msg);
    });
  }

  // ---------- live preview ----------
  function update() {
    const p = panels(), pwOn = $("pw-on").checked;
    const dark = segValue.theme === "dark" ||
      (segValue.theme === "auto" && matchMedia("(prefers-color-scheme: dark)").matches);
    $("pv").classList.toggle("dark", dark);
    $("pv-title").textContent = val("title") || "VRM Dashboard";
    $("pv-lock").hidden = !pwOn;
    $("pv-units").textContent = segValue.units === "metric" ? "Metric units" : "US units";
    document.querySelectorAll("#pv [data-p]").forEach((el) => el.classList.toggle("off", !p[el.dataset.p]));
    $("loc-note").hidden = p.location;
    $("pw-fields").hidden = !pwOn;
    $("pw-off-note").hidden = pwOn;
    $("pw-off-loc").hidden = !p.location;
    $("st-login").hidden = !pwOn;
    const folder = val("folder") || "dashboard";
    ["folder-echo", "st-folder", "st-folder2"].forEach((id) => { $(id).textContent = folder; });
    const score = pwScore($("pw").value);
    const bar = $("pw-bar");
    bar.style.width = (score / 4 * 100) + "%";
    bar.style.background = score >= 3 ? "var(--good)" : score >= 2 ? "var(--warning)" : "var(--critical)";
    $("pw-help").textContent = !$("pw").value ? "At least 8 characters; a short phrase is best."
      : score >= 3 ? "Strong." : score >= 2 ? "OK — longer is better." : "Weak — make it longer.";
    showErrors(errors(false), false);
  }
  document.querySelectorAll("#form input").forEach((i) => {
    i.addEventListener("input", update);
    i.addEventListener("change", update);
    i.addEventListener("blur", () => { if (i.id) touched.add(i.id); update(); });
  });
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", update);
  update();

  // ---------- build ----------
  const phpStr = (s) => "'" + String(s).replace(/\\/g, "\\\\").replace(/'/g, "\\'") + "'";

  function configPhp(o) {
    const panelLines = PANELS.map((k) => `        ${phpStr(k)} => ${o.panels[k] ? "true" : "false"},`).join("\n");
    const auth = o.auth
      ? `[\n        'user' => ${phpStr(o.auth.user)},\n        'hash' => ${phpStr(o.auth.hash)},  // bcrypt; the password itself is not stored\n    ]`
      : "null,  // no password: anyone with the link can view";
    return `<?php
// VRM Dashboard settings — generated ${new Date().toISOString().slice(0, 10)} by VRM Dashboard Builder ${VERSION}.
// PRIVATE: this file holds your VRM access token. Don't share it, email it, or commit it anywhere.
// PHP runs this file instead of displaying it, so it is safe inside the web folder.
return [
    'site'   => ${phpStr(o.site)},
    'token'  => ${phpStr(o.token)},
    'title'  => ${phpStr(o.title)},
    'units'  => ${phpStr(o.units)},   // 'us' or 'metric'
    'theme'  => ${phpStr(o.theme)},   // 'auto', 'light' or 'dark'
    'panels' => [
${panelLines}
    ],
    'auth'   => ${auth}${o.auth ? "," : ""}
];
`;
  }

  function readme(o) {
    return `${o.title} — VRM Dashboard
Generated ${new Date().toISOString().slice(0, 10)} by VRM Dashboard Builder ${VERSION}.

INSTALL
1. Upload this whole "${o.folder}" folder to your website with SFTP, next to your
   other site files (where your index.php or WordPress files live).
2. Open https://your-site.com/${o.folder}/${o.auth ? `\n3. Sign in as "${o.auth.user}" with the password you chose.` : ""}

REQUIREMENTS
PHP 7.4 or newer with the cURL extension (standard on almost every web host).${o.auth ? "\nHTTPS: password-protected dashboards refuse plain http." : ""}

FILES
index.php    the dashboard page and its data API
config.php   your settings and VRM token — keep private
page.html, app.js, map.js, style.css   the page itself
cache/       created automatically; short-lived copies of VRM data
.htaccess    extra hardening on Apache hosts (harmless elsewhere)

CHANGING SETTINGS
Build a new zip with the builder and upload config.php again, or edit config.php
directly (title, units, theme, panels).

TROUBLESHOOTING
"Dashboard not configured"      config.php didn't upload — upload it into this folder.
"VRM HTTP 401/403"              the token was revoked or mistyped — make a new one.
Blank map / no tracks           your GX has no GPS, or VRM hasn't logged a trip yet.
Password prompt keeps returning your host strips the Authorization header; ask
                                support to pass it through to PHP.
`;
  }

  async function fetchTemplate(name) {
    const r = await fetch("template/" + name, { cache: "no-cache" });
    if (!r.ok) throw new Error(`Couldn't load template/${name} (HTTP ${r.status}).`);
    return r.text();
  }

  async function build() {
    Object.keys(errors(true)).forEach((k) => touched.add(k));
    const e = errors(true);
    showErrors(e, true);
    $("build-err").textContent = "";
    if (Object.keys(e).length) {
      const first = document.querySelector("input.bad");
      if (first) first.focus();
      $("build-err").textContent = "Fix the highlighted fields first.";
      return null;
    }
    const btn = $("build");
    btn.disabled = true;
    btn.textContent = "Building…";
    try {
      const o = {
        site: val("site"), token: val("token"), title: val("title"), folder: val("folder"),
        units: segValue.units, theme: segValue.theme, panels: panels(), auth: null,
      };
      if ($("pw-on").checked) {
        // bcrypt cost 10 in the browser; PHP's password_verify() checks it.
        const hash = await new Promise((res, rej) =>
          dcodeIO.bcrypt.hash($("pw").value, 10, (err, h) => (err ? rej(err) : res(h))));
        o.auth = { user: val("user"), hash };
      }
      const zip = new JSZip();
      const dir = zip.folder(o.folder);
      const files = await Promise.all(TEMPLATE_FILES.map(fetchTemplate));
      TEMPLATE_FILES.forEach((name, i) => dir.file(name, files[i]));
      dir.file(".htaccess", await fetchTemplate("htaccess.txt"));
      dir.file("config.php", configPhp(o));
      dir.file("README.txt", readme(o));
      dir.folder("cache").file("index.html", "");
      const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE", platform: "UNIX" });
      return { blob, name: o.folder + ".zip" };
    } finally {
      btn.disabled = false;
      btn.textContent = "Download dashboard (.zip)";
    }
  }

  function save({ blob, name }) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  $("build").addEventListener("click", async () => {
    try {
      const out = await build();
      if (out) save(out);
    } catch (err) {
      $("build-err").textContent = "Build failed: " + err.message;
    }
  });

  // Exposed for automated testing of the generated bundle.
  window.vrmBuilder = { build, version: VERSION };
})();
