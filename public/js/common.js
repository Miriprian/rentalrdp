/* rentalrdp.com — helper bersama (no build) */
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
  const m = { available: ["Tersedia", "bg-emerald-600"], rented: ["Disewa", "bg-red-600"], maintenance: ["Maintenance", "bg-amber-600"], offline: ["Offline", "bg-slate-600"] };
  const [t, c] = m[s] || [s, "bg-slate-600"];
  return `<span class="text-[11px] px-2 py-1 rounded-full ${c} font-bold">${t}</span>`;
}
const isAdminRole = (r) => r === "admin" || r === "superadmin";

// Detail hardware agent (kolom hw_json): disk list + RAM modules + VRAM + core/thread
function hwDetailHtml(p) {
  let hw = {};
  try { hw = JSON.parse(p.hw_json || "{}"); } catch {}
  const lines = [];
  if (hw.ramModules && hw.ramModules.length) {
    const mods = hw.ramModules.map((m) => `${m.capacityGb}GB ${hw.ramType || m.type || ""} ${m.speed || "?"}MHz ${esc(m.partNumber || m.manufacturer || "")}`.trim()).join(" + ");
    lines.push(`💾 Detail RAM: ${mods}`);
  }
  if (hw.disks && hw.disks.length) {
    const ds = hw.disks.map((d) => `${d.capacityGb}GB ${esc(d.model || "")}${d.busType ? ` (${esc(d.busType)})` : ""}`.trim()).join(" + ");
    lines.push(`🗄️ Storage: ${ds}`);
  }
  if (hw.gpuVramGb) lines.push(`🎮 VRAM: ${hw.gpuVramGb}GB`);
  if (hw.cpuCores) lines.push(`🧠 ${hw.cpuCores} core / ${hw.cpuThreads || hw.cpuCores} thread${hw.cpuMaxGhz ? ` @ ${hw.cpuMaxGhz}GHz` : ""}`);
  if (!lines.length) return "";
  return `<details class="mt-2 text-[11px] text-slate-400"><summary class="cursor-pointer text-slate-300 hover:text-emerald-300">📋 Spek detail</summary><div class="mt-1 space-y-0.5">${lines.map((l) => `<div>${l}</div>`).join("")}</div></details>`;
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
    <h2 class="font-extrabold text-lg">Masuk dulu</h2>
    <p class="text-slate-400 text-xs">Halaman ini butuh login. Setelah masuk kamu akan diarahkan ke ${esc(target)}.</p>
    <input id="liUser" class="w-full px-4 py-3 rounded-xl bg-slate-800 border border-slate-700" placeholder="username / email" autocomplete="username"/>
    <input id="liPass" type="password" class="w-full px-4 py-3 rounded-xl bg-slate-800 border border-slate-700" placeholder="password" autocomplete="current-password"/>
    <button onclick="inlineLogin('${target}')" class="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 font-bold">Masuk</button>
    <div class="text-xs text-slate-400">Belum punya akun? <a class="text-emerald-300 underline" href="/">Daftar di beranda</a></div>
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
    <div>Username: <b>${esc(state.me.username)}</b> • Email: ${esc(state.me.email || "")}</div>
    <input id="oldP" type="password" placeholder="password lama" class="w-full px-4 py-3 rounded-xl bg-slate-800 border border-slate-700"/>
    <input id="newP" type="password" placeholder="password baru min 6" class="w-full px-4 py-3 rounded-xl bg-slate-800 border border-slate-700"/>
    <button onclick="changePass()" class="px-5 py-3 rounded-xl bg-emerald-600 font-bold">Ganti Password</button>
    ${state.me.username === "obake" ? `<div class="text-xs text-amber-300">⚠️ Kamu login sebagai superadmin default <b>obake/obake</b>. WAJIB ganti password sekarang.</div>` : ""}
  </div>`;
}
window.changePass = async function () {
  const r = await api("/api/auth/change-password", { method: "POST", body: JSON.stringify({ oldPassword: $("#oldP").value, newPassword: $("#newP").value }) });
  toast(r.message || (r.ok ? "Berhasil" : "Gagal"));
};
themeInit();
