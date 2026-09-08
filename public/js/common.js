/* rentalrdp.com — helper bersama (Tabler / Bootstrap 5, no build) */
const $ = (s) => document.querySelector(s);
const state = { me: null };
function openModal(id) {
  const el = document.getElementById(id);
  if (!el) return;
  if (window.bootstrap?.Modal) { new bootstrap.Modal(el).show(); return; }
  el.classList.add("show");
  el.style.display = "block";
  document.body.classList.add("modal-open");
  if (!document.querySelector(".modal-backdrop")) {
    const bd = document.createElement("div");
    bd.className = "modal-backdrop fade show";
    document.body.appendChild(bd);
  }
}
function closeModal(id) {
  const el = document.getElementById(id);
  if (!el) return;
  if (window.bootstrap?.Modal) {
    const m = bootstrap.Modal.getInstance(el);
    if (m) { m.hide(); return; }
    el.classList.remove("show");
  }
  el.classList.remove("show");
  el.style.display = "";
  const bd = document.querySelector(".modal-backdrop");
  if (bd) bd.remove();
  document.body.classList.remove("modal-open");
}

function toast(msg) {
  const t = $("#toast");
  if (!t) return alert(msg);
  t.innerHTML = msg;
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
  const m = { available: ["Tersedia", "bg-success"], rented: ["Disewa", "bg-danger"], maintenance: ["Maintenance", "bg-warning text-dark"], offline: ["Offline", "bg-secondary"] };
  const [t, c] = m[s] || [s, "bg-secondary"];
  return `<span class="badge rounded-pill ${c}">${t}</span>`;
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
  return `<details class="mt-2 small text-secondary"><summary class="text-primary cursor-pointer">📋 Spek detail</summary><div class="mt-1 d-flex flex-column gap-1">${lines.map((l) => `<div>${l}</div>`).join("")}</div></details>`;
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
  return `<div class="card mx-auto" style="max-width:26rem">
    <div class="card-body">
      <h2 class="card-title mb-1">Masuk dulu</h2>
      <p class="text-secondary small">Halaman ini butuh login. Setelah masuk kamu akan diarahkan ke ${esc(target)}.</p>
      <input id="liUser" class="form-control mb-2" placeholder="username / email" autocomplete="username"/>
      <input id="liPass" type="password" class="form-control mb-2" placeholder="password" autocomplete="current-password"/>
      <button onclick="inlineLogin('${target}')" class="btn btn-primary w-100">Masuk</button>
      <div class="text-secondary small mt-2">Belum punya akun? <a class="text-decoration-underline" href="/">Daftar di beranda</a></div>
      <div id="loginMsg" class="small text-warning mt-2"></div>
    </div>
  </div>`;
}
window.inlineLogin = async function (target) {
  const r = await api("/api/auth/login", { method: "POST", body: JSON.stringify({ username: $("#liUser").value.trim(), password: $("#liPass").value }) });
  if (!r.ok) { $("#loginMsg").textContent = r.message || "Gagal"; return; }
  location.href = target;
};

// Blok ganti password dipakai di /app & /admin
function akunHtml() {
  return `<div class="card mx-auto" style="max-width:26rem">
    <div class="card-body">
      <div class="mb-3">Username: <b>${esc(state.me.username)}</b> • Email: ${esc(state.me.email || "")}</div>
      <input id="oldP" type="password" placeholder="password lama" class="form-control mb-2"/>
      <input id="newP" type="password" placeholder="password baru min 6" class="form-control mb-2"/>
      <button onclick="changePass()" class="btn btn-primary">Ganti Password</button>
      ${state.me.username === "obake" ? `<div class="alert alert-warning small mt-2 mb-0">⚠️ Kamu login sebagai superadmin default <b>obake/obake</b>. WAJIB ganti password sekarang.</div>` : ""}
    </div>
  </div>`;
}
window.changePass = async function () {
  const r = await api("/api/auth/change-password", { method: "POST", body: JSON.stringify({ oldPassword: $("#oldP").value, newPassword: $("#newP").value }) });
  toast(r.message || (r.ok ? "Berhasil" : "Gagal"));
};