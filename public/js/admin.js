/* rentalrdp.com — panel admin (/admin) : order, PC, rental, user, voucher, settings, audit */
let tab = "orders";

function renderTabs() {
  const tabs = [["orders", "📦 Order Masuk"], ["pcs", "🖥️ Kelola PC"], ["rentals", "🔑 Rental Aktif"], ["users", "👥 Users"], ["vouchers", "🎟️ Voucher"], ["settings", "⚙️ Settings"], ["audit", "📜 Audit"], ["akun", "🔒 Akun Saya"]];
  if (!tabs.find((t) => t[0] === tab)) tab = "orders";
  $("#dashTabs").innerHTML = tabs.map(([k, l]) => `<button onclick="setTab('${k}')" class="px-4 py-2 rounded-lg ${tab === k ? "bg-emerald-600 font-bold" : "bg-slate-800"}">${l}</button>`).join("");
}
window.setTab = function (k) { tab = k; renderTabs(); renderBody(); };

async function renderBody() {
  const b = $("#dashBody");
  b.innerHTML = `<div class="text-sm text-slate-400">Memuat…</div>`;
  try {
    if (tab === "orders") b.innerHTML = await adminOrdersHtml();
    else if (tab === "pcs") b.innerHTML = await adminPcsHtml();
    else if (tab === "rentals") b.innerHTML = await adminRentalsHtml();
    else if (tab === "users") b.innerHTML = await adminUsersHtml();
    else if (tab === "vouchers") b.innerHTML = await adminVouchersHtml();
    else if (tab === "settings") b.innerHTML = await adminSettingsHtml();
    else if (tab === "audit") b.innerHTML = await adminAuditHtml();
    else b.innerHTML = akunHtml();
  } catch (e) { b.innerHTML = `<div class="text-red-300 text-sm">Gagal memuat: ${esc(e.message)}</div>`; }
}

async function adminOrdersHtml() {
  const s = await api("/api/admin/stats");
  const r = await api("/api/admin/orders");
  const rows = r.data || [];
  const st = s.data || {};
  return `
    <div class="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4 text-center text-xs">
      <div class="card rounded-xl p-3"><div class="text-xl font-extrabold">${st.users ?? 0}</div>Users</div>
      <div class="card rounded-xl p-3"><div class="text-xl font-extrabold">${st.pcs ?? 0}</div>PC</div>
      <div class="card rounded-xl p-3"><div class="text-xl font-extrabold text-amber-300">${st.pendingOrders ?? 0}</div>Pending</div>
      <div class="card rounded-xl p-3"><div class="text-xl font-extrabold text-emerald-300">${st.activeRentals ?? 0}</div>Aktif</div>
      <div class="card rounded-xl p-3"><div class="text-xl font-extrabold text-emerald-300">${rupiah(st.revenue ?? 0)}</div>Revenue</div>
    </div>
    <div class="grid gap-3">` + (rows.length ? rows.map((o) => `
      <div class="card rounded-xl p-4 text-sm">
        <div class="flex flex-wrap gap-2 items-center"><b class="mono">${esc(o.code)}</b><span class="text-xs px-2 py-1 rounded bg-slate-800">${esc(o.status)}</span><span class="ml-auto font-bold text-emerald-300">${rupiah(o.total_idr)}</span></div>
        <div class="text-slate-300 mt-1">👤 ${esc(o.username)} (${esc(o.wa_number || "-")}) • ${esc(o.pc_code)} • ${esc(o.plan_code)} • ${o.duration_hours}j • via ${esc(o.payment_method)}</div>
        ${o.payment_proof ? `<div class="text-xs mt-1">🧾 Bukti: <b>${esc(o.payment_proof)}</b></div>` : `<div class="text-xs text-slate-500">belum ada bukti</div>`}
        ${o.note ? `<div class="text-xs text-slate-400">📝 ${esc(o.note)}</div>` : ""}
        <div class="flex gap-2 mt-3">
          <button onclick="approveOrder('${o.id}')" class="px-4 py-2 rounded-lg bg-emerald-600 text-xs font-bold">✅ Approve & Buatkan RDP</button>
          <button onclick="rejectOrder('${o.id}')" class="px-4 py-2 rounded-lg bg-red-700 text-xs">Reject</button>
        </div>
      </div>`).join("") : `<div class="card rounded-xl p-6 text-sm text-slate-400">Tidak ada order.</div>`) + `</div>`;
}
window.approveOrder = async function (id) {
  if (!confirm("Approve? Sistem akan buatkan user RDP + kunci PC jadi rented.")) return;
  const r = await api(`/api/admin/orders/${id}/approve`, { method: "POST" });
  toast(r.message || "OK");
  if (r.ok && r.rdpPass) alert(`RDP dibuat:\nUser: ${r.rdpUser}\nPass: ${r.rdpPass}\n\nSampaikan ke user.`);
  renderBody();
};
window.rejectOrder = async function (id) {
  if (!confirm("Reject order ini?")) return;
  const r = await api(`/api/admin/orders/${id}/reject`, { method: "POST" });
  toast(r.message || "OK"); renderBody();
};

let agentSetupHtml = "";

async function adminPcsHtml() {
  const r = await api("/api/pcs");
  const rows = r.data || [];
  return `
    <div class="card rounded-xl p-4 mb-4 text-sm">
      <div class="flex flex-wrap items-center gap-3">
        <b>➕ Tambah PC Fisik</b>
        <button onclick="createPc()" class="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 font-bold">➕ Tambah PC Baru</button>
      </div>
      <div class="text-xs text-slate-400 mt-2">Kode & token dibuat otomatis. Spek PC terisi sendiri dari agent setelah connect → tinggal isi harga lalu klik <b>🚀 Pasarkan</b> untuk tampil di katalog.</div>
    </div>
    <div id="agentSetup">${agentSetupHtml}</div>
    <div class="grid gap-3">` + rows.map((p) => `
      <div class="card rounded-xl p-4 text-sm">
        <div class="flex gap-2 items-center flex-wrap"><b class="mono">${esc(p.code)}</b> ${statusBadge(p.status)}
          ${!p.last_seen_at ? `<span class="text-[11px] px-2 py-1 rounded-full bg-slate-700 font-bold">⏳ Menunggu agent</span>` : (p.is_active ? `<span class="text-[11px] px-2 py-1 rounded-full bg-emerald-700 font-bold">✓ Dipasarkan</span>` : `<span class="text-[11px] px-2 py-1 rounded-full bg-amber-700 font-bold">Belum dipasarkan</span>`)}
          <span class="ml-auto text-xs">${esc(p.ip_public || "-")} • last seen: ${p.last_seen_at ? new Date(p.last_seen_at).toLocaleString("id-ID") : "-"}</span>
        </div>
        <div class="mt-1 text-slate-300">${p.cpu ? esc(p.cpu) + " / " + esc(p.gpu) + " / " + p.ram_gb + "GB / " + p.storage_gb + "GB " + esc(p.storage_type) + " / " + esc(p.os) : esc(p.name) + " — ⏳ spek nunggu agent konek"}</div>
        <div class="flex flex-wrap gap-2 mt-3 text-xs">
          <select id="st-${p.id}" class="px-3 py-2 rounded-lg bg-slate-800"><option ${p.status === "available" ? "selected" : ""}>available</option><option ${p.status === "rented" ? "selected" : ""}>rented</option><option ${p.status === "maintenance" ? "selected" : ""}>maintenance</option><option ${p.status === "offline" ? "selected" : ""}>offline</option></select>
          <input id="ip-${p.id}" value="${esc(p.ip_public || "")}" placeholder="IP publik" class="px-3 py-2 rounded-lg bg-slate-800 border border-slate-700"/>
          <input id="pd-${p.id}" type="number" value="${p.price_daily}" placeholder="harga/hari" title="Harga per hari (Rp)" class="px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 w-28"/>
          <input id="pm-${p.id}" type="number" value="${p.price_monthly}" placeholder="harga/bulan" title="Harga per bulan (Rp)" class="px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 w-28"/>
          <button onclick="savePc('${p.id}')" class="px-4 py-2 rounded-lg bg-slate-700">💾 Simpan</button>
          ${p.last_seen_at && !p.is_active ? `<button onclick="publishPc('${p.id}')" class="px-4 py-2 rounded-lg bg-emerald-600 font-bold">🚀 Pasarkan</button>` : ""}
          ${p.is_active ? `<button onclick="unpublishPc('${p.id}')" class="px-4 py-2 rounded-lg bg-slate-700">⏸ Tarik dari katalog</button>` : ""}
          <button onclick="regenToken('${p.id}')" class="px-4 py-2 rounded-lg bg-amber-700">🔑 Token Agent</button>
          <button onclick="delPc('${p.id}')" class="px-4 py-2 rounded-lg bg-red-800">Hapus</button>
        </div>
        <div class="text-xs text-slate-500 mt-1"><span class="md:inline-block pr-2">Harga: <b class="text-emerald-300">${rupiah(p.price_hourly)}/jam</b></span><span class="md:inline-block">${rupiah(p.price_daily)}/hari • ${rupiah(p.price_weekly)}/minggu • ${rupiah(p.price_monthly)}/bulan</span></div>
      </div>`).join("") + `</div>`;
}
window.createPc = async function () {
  if (!confirm("Buat PC baru? Kode + token otomatis, spek terisi sendiri dari agent.")) return;
  const r = await api("/api/pcs", { method: "POST", body: JSON.stringify({}) });
  toast(r.message || "OK");
  if (r.ok && r.agentToken) showAgentSetup(r.code, r.agentToken);
  renderBody();
};
window.savePc = async function (id) {
  const r = await api(`/api/pcs/${id}`, { method: "PATCH", body: JSON.stringify({
    status: document.getElementById("st-" + id).value,
    ipPublic: document.getElementById("ip-" + id).value,
    priceDaily: Number(document.getElementById("pd-" + id).value || 0),
    priceMonthly: Number(document.getElementById("pm-" + id).value || 0),
  }) });
  toast(r.message || "OK"); renderBody();
};
window.publishPc = async function (id) {
  const daily = Number(document.getElementById("pd-" + id).value || 0);
  const monthly = Number(document.getElementById("pm-" + id).value || 0);
  if (!daily && !monthly) { toast("Isi harga dulu (per hari / per bulan)."); return; }
  const r = await api(`/api/pcs/${id}`, { method: "PATCH", body: JSON.stringify({
    isActive: true, status: "available",
    ipPublic: document.getElementById("ip-" + id).value,
    priceDaily: daily, priceWeekly: Math.round(daily * 5), priceMonthly: monthly,
  }) });
  toast(r.ok ? "🚀 PC tampil di katalog — siap disewa" : r.message); renderBody();
};
window.unpublishPc = async function (id) {
  if (!confirm("Tarik PC ini dari katalog publik?")) return;
  const r = await api(`/api/pcs/${id}`, { method: "PATCH", body: JSON.stringify({ isActive: false }) });
  toast(r.message || "OK"); renderBody();
};
window.regenToken = async function (id) {
  const r = await api(`/api/pcs/${id}/regen-token`, { method: "POST" });
  if (r.ok) showAgentSetup(r.code || "", r.agentToken);
  else toast(r.message || "Gagal");
};
window.closeAgentSetup = function () { agentSetupHtml = ""; renderBody(); };
window.copyAgentToken = function (t) {
  navigator.clipboard?.writeText(t).then(() => toast("Token disalin")).catch(() => prompt("Salin manual:", t));
};
window.showAgentSetup = function (code, token) {
  const server = location.origin;
  agentSetupHtml = `
    <div class="card rounded-xl p-5 mb-4 border border-emerald-700 text-sm">
      <div class="flex flex-wrap items-center gap-2 mb-3">
        <b class="text-emerald-300">📌 PC ${esc(code)} — pasang agent di PC fisik</b>
        <button onclick="closeAgentSetup()" class="ml-auto px-3 py-1 rounded bg-slate-800 text-xs">✕ Tutup</button>
      </div>
      <div class="grid md:grid-cols-2 gap-4">
        <div class="space-y-2 text-xs text-slate-300">
          <div class="font-bold text-slate-200">1. Download agent:</div>
          <a href="/api/download/agent" download="rentalrdp-agent.exe" class="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 font-bold">⬇ Download rentalrdp-agent.exe</a>
          <div class="text-slate-400">Copy ke PC yang mau disewakan (USB / network share).</div>
          <div class="font-bold text-slate-200 pt-2">2. Di PC fisik, double-click file .exe</div>
          <div>Wizard akan menanyakan Server URL → <b class="text-emerald-300">${esc(server)}</b></div>
        </div>
        <div class="space-y-2 text-xs text-slate-300">
          <div class="font-bold text-slate-200">3. Masukkan Agent Token:</div>
          <div class="mono bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 break-all text-emerald-300">${esc(token)}</div>
          <button onclick="copyAgentToken('${esc(token)}')" class="px-4 py-2 rounded-lg bg-slate-700">📋 Salin Token</button>
          <div class="text-slate-400 pt-1">Setelah connect, agent langsung terdaftar <b class="text-slate-200">auto-start</b>. Kalaupun PC <b class="text-slate-200">reboot / matilistrik lalu hidup</b>, agent jalan sendiri.</div>
          <div class="text-slate-400 pt-1">Supaya juga jalan <b>saat BOOT</b> (belum ada yang login): sekali jalankan .exe-nya <b>klik kanan → Run as administrator</b>.</div>
          <div class="font-bold text-slate-200 pt-2">4. Selesai</div>
          <div>Agent connect → spek real terisi & PC muncul di panel (status Belum dipasarkan). Isi harga lalu klik <b class="text-emerald-300">🚀 Pasarkan</b> → PC siap disewa.</div>
        </div>
      </div>
    </div>`;
  renderBody();
};
window.delPc = async function (id) {
  if (!confirm("Hapus PC ini?")) return;
  const r = await api(`/api/pcs/${id}`, { method: "DELETE" });
  toast(r.message || "OK"); renderBody();
};

async function adminRentalsHtml() {
  const r = await api("/api/admin/rentals");
  const rows = r.data || [];
  return `<div class="grid gap-3">` + (rows.length ? rows.map((x) => `
    <div class="card rounded-xl p-4 text-sm">
      <div class="flex gap-2 items-center"><b class="mono">${esc(x.pc_code)}</b><span class="text-xs px-2 py-1 rounded bg-slate-800">${esc(x.status)}</span><span class="ml-auto text-xs">👤 ${esc(x.username)} • s/d ${new Date(x.end_at).toLocaleString("id-ID")}</span></div>
      ${x.status === "active" ? `<button onclick="terminateRental('${x.id}')" class="mt-3 px-4 py-2 rounded-lg bg-red-700 text-xs">Terminate + Hapus User</button>` : ""}
    </div>`).join("") : "Kosong") + `</div>`;
}
window.terminateRental = async function (id) {
  if (!confirm("Terminate rental + hapus user OS?")) return;
  const r = await api(`/api/admin/rentals/${id}/terminate`, { method: "POST" });
  toast(r.message || "OK"); renderBody();
};

async function adminUsersHtml() {
  const r = await api("/api/admin/users");
  const rows = r.data || [];
  return `<div class="grid gap-2">` + rows.map((u) => `
    <div class="card rounded-xl p-4 text-sm flex flex-wrap gap-2 items-center">
      <b>${esc(u.username)}</b><span class="text-xs px-2 py-1 rounded bg-slate-800">${esc(u.role)}</span>
      <span class="text-xs text-slate-400">${esc(u.email)} • ${esc(u.wa_number || "")}</span>
      <span class="ml-auto flex gap-2">
        <select id="role-${u.id}" class="px-2 py-1 rounded bg-slate-800 text-xs"><option ${u.role === "user" ? "selected" : ""}>user</option><option ${u.role === "admin" ? "selected" : ""}>admin</option><option ${u.role === "superadmin" ? "selected" : ""}>superadmin</option></select>
        <button onclick="saveUser('${u.id}')" class="px-3 py-1 rounded bg-slate-700 text-xs">Simpan</button>
        <button onclick="resetPass('${u.id}')" class="px-3 py-1 rounded bg-amber-700 text-xs">Reset PW</button>
      </span>
    </div>`).join("") + `</div>`;
}
window.saveUser = async function (id) {
  const role = document.getElementById("role-" + id).value;
  const r = await api(`/api/admin/users/${id}`, { method: "PATCH", body: JSON.stringify({ role }) });
  toast(r.message || "OK"); renderBody();
};
window.resetPass = async function (id) {
  const np = prompt("Password baru (min 6):");
  if (!np) return;
  const r = await api(`/api/admin/users/${id}/reset-password`, { method: "POST", body: JSON.stringify({ newPassword: np }) });
  toast(r.message || "OK");
};

async function adminVouchersHtml() {
  const r = await api("/api/admin/vouchers");
  const rows = r.data || [];
  return `<div class="card rounded-xl p-4 mb-3 text-sm flex gap-2 flex-wrap">
      <input id="vc" placeholder="KODE" class="px-3 py-2 rounded bg-slate-800 mono"/>
      <input id="vd" type="number" placeholder="% diskon" class="px-3 py-2 rounded bg-slate-800"/>
      <button onclick="saveVoucher()" class="px-4 py-2 rounded bg-emerald-600 font-bold">Simpan Voucher</button>
    </div>
    <div class="grid gap-2">` + rows.map((v) => `<div class="card rounded-xl p-3 text-sm mono">${esc(v.code)} — ${v.discount_percent}% (max ${rupiah(v.max_discount_idr)}) • ${v.used_count}/${v.quota}</div>`).join("") + `</div>`;
}
window.saveVoucher = async function () {
  const r = await api("/api/admin/vouchers", { method: "POST", body: JSON.stringify({ code: $("#vc").value, discountPercent: Number($("#vd").value || 10) }) });
  toast(r.message || "OK"); renderBody();
};

async function adminSettingsHtml() {
  const r = await api("/api/admin/settings");
  const s = r.data || {};
  const fields = ["site_name", "tagline", "wa_admin", "qris_text", "payment_bca", "notice"];
  return `<div class="card rounded-xl p-5 text-sm space-y-3 max-w-2xl">` + fields.map((k) => `
    <div><label class="text-xs text-slate-400">${k}</label><textarea id="set-${k}" rows="2" class="w-full mt-1 px-3 py-2 rounded-lg bg-slate-800 border border-slate-700">${esc(s[k] || "")}</textarea></div>`).join("") + `
    <button onclick="saveSettings()" class="px-5 py-3 rounded-xl bg-emerald-600 font-bold">Simpan Settings</button></div>`;
}
window.saveSettings = async function () {
  const keys = ["site_name", "tagline", "wa_admin", "qris_text", "payment_bca", "notice"];
  const body = {};
  keys.forEach((k) => (body[k] = document.getElementById("set-" + k).value));
  const r = await api("/api/admin/settings", { method: "POST", body: JSON.stringify(body) });
  toast(r.message || "OK");
};

async function adminAuditHtml() {
  const r = await api("/api/admin/audit");
  const rows = r.data || [];
  return `<div class="grid gap-1 text-xs mono">` + rows.slice(0, 100).map((a) => `<div class="card rounded-lg p-2">${new Date(a.created_at).toLocaleString("id-ID")} • <b>${esc(a.actor_name)}</b> • ${esc(a.action)} • ${esc(a.entity)}/${esc(a.entity_id)}</div>`).join("") + `</div>`;
}

(async () => {
  await loadMe();
  navInit("admin");
  if (!state.me) {
    $("#dashWrap").innerHTML = loginCardHtml("/admin");
    return;
  }
  if (!isAdminRole(state.me.role)) {
    $("#dashWrap").innerHTML = `<div class="card rounded-2xl p-6 max-w-md mx-auto text-sm text-center space-y-3">
      <div class="text-3xl">⛔</div><b>Akses ditolak</b>
      <p class="text-slate-400">Halaman ini khusus admin. Akunmu role <b>${esc(state.me.role)}</b>.</p>
      <a href="/app" class="inline-block px-5 py-3 rounded-xl bg-emerald-600 font-bold">Ke Dashboard Saya →</a>
    </div>`;
    return;
  }
  $("#dashRole").textContent = `Login sebagai ${state.me.username} • role: ${state.me.role}`;
  renderTabs();
  renderBody();
})();
