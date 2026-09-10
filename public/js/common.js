/* Rental PC by Miriprian — helper bersama (no build) */
const $ = (s) => document.querySelector(s);
const state = { me: null };

// ---- tema flat: system / dark / light ----
function applyTheme(mode) {
  const resolved = mode === "dark" ? "dark" : mode === "light" ? "light" : (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  document.documentElement.setAttribute("data-theme", resolved);
}
function themeInit() {
  const saved = localStorage.getItem("theme") || "system";
  applyTheme(saved);
  const sel = $("#themeSel");
  if (sel) {
    sel.value = saved;
    sel.addEventListener("change", () => {
      localStorage.setItem("theme", sel.value);
      applyTheme(sel.value);
    });
  }
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if ((localStorage.getItem("theme") || "system") === "system") applyTheme("system");
  });
}

function toast(msg) {
  const t = $("#toast");
  if (!t) return alert(msg);
  t.textContent = msg;
  t.classList.remove("hidden");
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.add("hidden"), 3200);
}
async function api(path, opts = {}) {
  const r = await fetch(path, { credentials: "include", headers: { "Content-Type": "application/json" }, ...opts });
  let j = {};
  try { j = await r.json(); } catch {}
  if (!r.ok && !j.message) j.message = "Error " + r.status;
  return { status: r.status, ...j };
}
const rupiah = (n) => "Rp" + Number(n || 0).toLocaleString("id-ID");
const esc = (s) => String(s ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
function dl(h) { const d = new Date(h); const ms = d.getTime() - Date.now(); if (ms <= 0) return "berakhir"; const H = Math.floor(ms / 3600000), M = Math.floor((ms % 3600000) / 60000); if (H > 48) return Math.floor(H / 24) + " hari lagi"; return `${H}j ${M}m lagi`; }
function statusBadge(s) {
  const m = { available: ["chip-emerald", t("status_available")], rented: ["chip-red", t("status_rented")], maintenance: ["chip-amber", t("status_maintenance")], offline: ["chip-slate", t("status_offline")] };
  const [c, label] = m[s] || ["chip-slate", s];
  return `<span class="chip ${c}">${label}</span>`;
}
// Kecil-kecil chip generik: chip(text, variant) dengan variant: emerald|red|amber|slate|outline
const chip = (text, variant = "slate") => `<span class="chip chip-${variant}">${text}</span>`;
// Waktu relatif (id/en) untuk last_seen dsb.
const ago = (ts) => {
  if (!ts) return "—";
  const d = new Date(ts).getTime();
  const ms = Date.now() - d;
  if (isNaN(d) || ms < 0) return t("just_now");
  const mn = Math.floor(ms / 60000);
  if (mn < 1) {
    const sc = Math.floor(ms / 1000);
    if (sc <= 4) return t("just_now");
    return t("sec_ago", { n: sc });
  }
  if (mn < 60) return t("min_ago", { n: mn });
  const hr = Math.floor(mn / 60);
  if (hr < 24) return t("hour_ago", { n: hr });
  const dy = Math.floor(hr / 24);
  if (dy < 7) return t("day_ago", { n: dy });
  return new Date(ts).toLocaleDateString(langState.lang === "en" ? "en-US" : "id-ID", { day: "2-digit", month: "short", year: "2-digit" });
};
// Agent dianggap online bila last_seen < 5 menit lalu
const agentOnline = (p) => {
  try { return !!p.last_seen_at && Date.now() - new Date(p.last_seen_at).getTime() < 5 * 60000; } catch { return false; }
};
// Titik status agent + label online/offline
const agentDotHtml = (p) => `<span class="dot ${agentOnline(p) ? "dot-on" : "dot-off"}"></span> <span class="text-xs ${agentOnline(p) ? "text-emerald-300" : "text-slate-400"} font-semibold">${agentOnline(p) ? t("lbl_online") : t("lbl_offline")}</span>`;
const isAdminRole = (r) => r === "admin" || r === "superadmin";

// Spek lengkap ala AIDA64: label kiri rata kanan (titik dua sejajar kebawah), nilai kanan. Tanpa emoji.
function specHtml(p) {
  let hw = {};
  try { hw = JSON.parse(p.hw_json || "{}"); } catch {}
  const rows = [];
  // Urutan: Motherboard → CPU → GPU → RAM → Storage → OS → Lokasi → Internet.
  if (p.motherboard) rows.push([t("spec_mb"), esc(p.motherboard) + (hw.ramType ? ` (${esc(hw.ramType)})` : "")]);
  if (p.cpu) {
    rows.push([t("spec_cpu"), esc(p.cpu) + (hw.cpuMaxGhz ? ` @ ${hw.cpuMaxGhz}GHz` : "")]);
    if (hw.cpuCores) rows.push([t("spec_core_threads"), `${hw.cpuCores} / ${hw.cpuThreads || hw.cpuCores}`]);
  }
  if (p.gpu) {
    let s = esc(p.gpu);
    if (hw.gpuVramGb) s += ` (${t("spec_vram", { vram: hw.gpuVramGb })})`;
    rows.push([t("spec_gpu"), s]);
  }
  rows.push([t("spec_ram"), `${p.ram_gb || 0}GB${hw.ramType ? " " + esc(hw.ramType) : ""}`]);
  rows.push([t("spec_storage"), `${p.storage_gb || 0}GB${p.storage_type ? " " + esc(p.storage_type) : ""}`]);
  if (p.os) rows.push([t("spec_os"), esc(p.os)]);
  if (p.location) rows.push([t("spec_loc"), esc(p.location)]);

  const dl = Number(p.net_download_mbps || 0), ul = Number(p.net_upload_mbps || 0), ping = Number(p.net_ping_ms || 0);
  if (dl || ul) {
    let iv = t("net_speed", { down: Math.round(dl), up: Math.round(ul) });
    if (p.net_tested_at) iv += " (" + new Date(p.net_tested_at).toLocaleString(langState.lang === "en" ? "en-US" : "id-ID", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) + ")";
    rows.push([t("spec_net"), iv]);
    if (ping) rows.push([t("spec_ping"), t("net_ping", { ping })]);
  }

  // Detail fisik RAM & disk — tetap tampil, di bawah urutan utama.
  if (hw.ramModules && hw.ramModules.length) {
    rows.push([t("spec_ram_modules"), hw.ramModules.map((m) => `${m.capacityGb}GB ${m.speed || "?"}MHz ${esc(m.partNumber || m.manufacturer || "")}`.trim()).join(" + ")]);
  }
  if (hw.disks && hw.disks.length) {
    rows.push([t("spec_disks"), hw.disks.map((d) => `${d.capacityGb}GB ${esc(d.model || "")}${d.busType ? ` (${esc(d.busType)})` : ""}`.trim()).join(" + ")]);
  }
  if (!rows.length) return "";
  return `<div class="mt-2 text-xs"><div class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">${rows.map(([k, v]) => `<div class="text-slate-400 text-right whitespace-nowrap select-none">${k}:</div><div class="text-slate-200">${v}</div>`).join("")}</div></div>`;
}

async function loadMe() {
  const r = await api("/api/auth/me");
  state.me = r.ok ? r.user : null;
  return state.me;
}

// Nav umum untuk halaman /app & /admin. active: 'app' | 'admin'
function navInit(active) {
  const paint = () => {
    const logged = !!state.me;
    const nu = $("#navUser");
    if (nu) nu.textContent = logged ? `${state.me.username} (${state.me.role})` : "";
    const bl = $("#btnLogout");
    if (bl) bl.classList.toggle("hidden", !logged);
    const ba = $("#btnAdminLink");
    if (ba) ba.classList.toggle("hidden", !(logged && isAdminRole(state.me.role)));
  };
  paint();
  const lo = $("#btnLogout");
  if (lo) lo.onclick = async () => { await api("/api/auth/logout", { method: "POST" }); location.href = "/"; };
  return paint;
}

// Kartu login inline untuk /app & /admin saat belum login
function loginCardHtml(target) {
  return `<div class="card rounded-2xl p-6 max-w-md mx-auto text-sm space-y-3">
    <h2 class="font-extrabold text-lg">${t("login_first_title")}</h2>
    <p class="text-slate-400 text-xs">${esc(t("login_first_desc", { target }))}</p>
    <input id="liUser" class="input" placeholder="${esc(t("ph_username"))}" autocomplete="username"/>
    <input id="liPass" type="password" class="input" placeholder="${esc(t("ph_password"))}" autocomplete="current-password"/>
    <button onclick="inlineLogin('${target}')" class="btn btn-primary btn-block">${t("tab_login")}</button>
    <div class="text-xs text-slate-400">${t("no_account")}</div>
    <div id="loginMsg" class="text-xs text-amber-300"></div>
  </div>`;
}
window.inlineLogin = async function (target) {
  const r = await api("/api/auth/login", { method: "POST", body: JSON.stringify({ username: $("#liUser").value.trim(), password: $("#liPass").value }) });
  if (!r.ok) { $("#loginMsg").textContent = r.message || "Gagal"; return; }
  location.href = target;
};

// Blok ganti password dipakai di /app & /admin
function akunHtml() {
  return `<div class="card rounded-2xl p-6 max-w-md text-sm space-y-3">
    <div class="text-xs">${t("akun_username")}<b>${esc(state.me.username)}</b> • ${t("akun_email")}${esc(state.me.email || "")}</div>
    <input id="oldP" type="password" placeholder="${esc(t("ph_old_pass"))}" class="input"/>
    <input id="newP" type="password" placeholder="${esc(t("ph_new_pass"))}" class="input"/>
    <button onclick="changePass()" class="btn btn-primary">${t("btn_change_pass")}</button>
    ${state.me.username === "obake" ? `<div class="text-xs text-amber-300">${t("warn_obake")}</div>` : ""}
  </div>`;
}
window.changePass = async function () {
  const r = await api("/api/auth/change-password", { method: "POST", body: JSON.stringify({ oldPassword: $("#oldP").value, newPassword: $("#newP").value }) });
  toast(r.message || (r.ok ? "Berhasil" : "Gagal"));
};
langInit();
themeInit();
