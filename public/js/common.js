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
  const m = { available: [t("status_available"), "bg-emerald-600"], rented: [t("status_rented"), "bg-red-600"], maintenance: [t("status_maintenance"), "bg-amber-600"], offline: [t("status_offline"), "bg-slate-600"] };
  const [label, c] = m[s] || [s, "bg-slate-600"];
  return `<span class="text-[11px] px-2 py-1 rounded-full ${c} font-bold">${label}</span>`;
}
const isAdminRole = (r) => r === "admin" || r === "superadmin";

// Spek lengkap ala AIDA64: label kiri, nilai kanan, tanpa emoji. Semua tampil langsung.
function specHtml(p) {
  let hw = {};
  try { hw = JSON.parse(p.hw_json || "{}"); } catch {}
  const rows = [];
  if (p.motherboard) rows.push([t("spec_mb"), esc(p.motherboard)]);
  if (p.cpu) {
    let s = esc(p.cpu);
    if (hw.cpuCores) s += ` — ${hw.cpuCores}c/${hw.cpuThreads || hw.cpuCores}t${hw.cpuMaxGhz ? " @ " + hw.cpuMaxGhz + "GHz" : ""}`;
    rows.push([t("spec_cpu"), s]);
  }
  if (p.gpu) {
    let s = esc(p.gpu);
    if (hw.gpuVramGb) s += ` — ${t("spec_vram", { vram: hw.gpuVramGb })}`;
    rows.push([t("spec_gpu"), s]);
  }
  rows.push([t("spec_ram"), `${p.ram_gb || 0}GB${hw.ramType ? " " + esc(hw.ramType) : ""}`]);
  if (hw.ramModules && hw.ramModules.length) {
    rows.push([t("spec_ram_modules"), hw.ramModules.map((m) => `${m.capacityGb}GB ${hw.ramType || m.type || ""} ${m.speed || "?"}MHz ${esc(m.partNumber || m.manufacturer || "")}`.trim()).join(" + ")]);
  }
  rows.push([t("spec_storage"), `${p.storage_gb || 0}GB${p.storage_type ? " " + esc(p.storage_type) : ""}`]);
  if (hw.disks && hw.disks.length) {
    rows.push([t("spec_disks"), hw.disks.map((d) => `${d.capacityGb}GB ${esc(d.model || "")}${d.busType ? ` (${esc(d.busType)})` : ""}`.trim()).join(" + ")]);
  }
  if (p.os) rows.push([t("spec_os"), esc(p.os)]);
  if (p.location) rows.push([t("spec_loc"), esc(p.location)]);

  const dl = Number(p.net_download_mbps || 0), ul = Number(p.net_upload_mbps || 0), ping = Number(p.net_ping_ms || 0);
  if (dl || ul) {
    let val = t("net_speed", { down: dl || "-", up: ul || "-", ping: ping ? ping : "-" });
    if (p.net_tested_at) val += " · " + new Date(p.net_tested_at).toLocaleString(langState.lang === "en" ? "en-US" : "id-ID", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
    rows.push([t("spec_net"), val]);
  }
  if (!rows.length) return "";
  return `<div class="mt-2 text-xs"><div class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">${rows.map(([k, v]) => `<div class="text-slate-400 whitespace-nowrap">${k}</div><div class="text-slate-200">${v}</div>`).join("")}</div></div>`;
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
    <input id="liUser" class="w-full px-4 py-3 rounded-xl bg-slate-800 border border-slate-700" placeholder="${esc(t("ph_username"))}" autocomplete="username"/>
    <input id="liPass" type="password" class="w-full px-4 py-3 rounded-xl bg-slate-800 border border-slate-700" placeholder="${esc(t("ph_password"))}" autocomplete="current-password"/>
    <button onclick="inlineLogin('${target}')" class="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 font-bold">${t("tab_login")}</button>
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
  return `<div class="card rounded-xl p-5 max-w-md text-sm space-y-3">
    <div>${t("akun_username")}<b>${esc(state.me.username)}</b> • ${t("akun_email")}${esc(state.me.email || "")}</div>
    <input id="oldP" type="password" placeholder="${esc(t("ph_old_pass"))}" class="w-full px-4 py-3 rounded-xl bg-slate-800 border border-slate-700"/>
    <input id="newP" type="password" placeholder="${esc(t("ph_new_pass"))}" class="w-full px-4 py-3 rounded-xl bg-slate-800 border border-slate-700"/>
    <button onclick="changePass()" class="px-5 py-3 rounded-xl bg-emerald-600 font-bold">${t("btn_change_pass")}</button>
    ${state.me.username === "obake" ? `<div class="text-xs text-amber-300">${t("warn_obake")}</div>` : ""}
  </div>`;
}
window.changePass = async function () {
  const r = await api("/api/auth/change-password", { method: "POST", body: JSON.stringify({ oldPassword: $("#oldP").value, newPassword: $("#newP").value }) });
  toast(r.message || (r.ok ? "Berhasil" : "Gagal"));
};
langInit();
themeInit();
