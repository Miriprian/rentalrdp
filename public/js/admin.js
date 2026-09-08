/* rentalrdp.com — panel admin (/admin) : order, PC, rental, user, voucher, settings, audit */
let tab = "orders";

function renderTabs() {
  const tabs = [["orders", "📦 Order Masuk"], ["pcs", "🖥️ Kelola PC"], ["rentals", "🔑 Rental Aktif"], ["users", "👥 Users"], ["vouchers", "🎟️ Voucher"], ["settings", "⚙️ Settings"], ["audit", "📜 Audit"], ["akun", "🔒 Akun Saya"]];
  if (!tabs.find((t) => t[0] === tab)) tab = "orders";
  $("#dashTabs").innerHTML = tabs.map(([k, l]) => `<button onclick="setTab('${k}')" class="btn btn-sm ${tab === k ? "btn-primary fw-bold" : "btn-dark"}">${l}</button>`).join("");
}
window.setTab = function (k) { tab = k; renderTabs(); renderBody(); };

async function renderBody() {
  const b = $("#dashBody");
  b.innerHTML = `<div class="text-secondary small">Memuat…</div>`;
  try {
    if (tab === "orders") b.innerHTML = await adminOrdersHtml();
    else if (tab === "pcs") b.innerHTML = await adminPcsHtml();
    else if (tab === "rentals") b.innerHTML = await adminRentalsHtml();
    else if (tab === "users") b.innerHTML = await adminUsersHtml();
    else if (tab === "vouchers") b.innerHTML = await adminVouchersHtml();
    else if (tab === "settings") b.innerHTML = await adminSettingsHtml();
    else if (tab === "audit") b.innerHTML = await adminAuditHtml();
    else b.innerHTML = akunHtml();
  } catch (e) { b.innerHTML = `<div class="text-danger small">Gagal memuat: ${esc(e.message)}</div>`; }
}

async function adminOrdersHtml() {
  const s = await api("/api/admin/stats");
  const r = await api("/api/admin/orders");
  const rows = r.data || [];
  const st = s.data || {};
  return `
    <div class="row g-3 mb-4 text-center small">
      <div class="col-6 col-md"><div class="card"><div class="card-body py-3"><div class="h3 fw-extrabold mb-0">${st.users ?? 0}</div><div class="text-secondary">Users</div></div></div></div>
      <div class="col-6 col-md"><div class="card"><div class="card-body py-3"><div class="h3 fw-extrabold mb-0">${st.pcs ?? 0}</div><div class="text-secondary">PC</div></div></div></div>
      <div class="col-6 col-md"><div class="card"><div class="card-body py-3"><div class="h3 fw-extrabold text-warning mb-0">${st.pendingOrders ?? 0}</div><div class="text-secondary">Pending</div></div></div></div>
      <div class="col-6 col-md"><div class="card"><div class="card-body py-3"><div class="h3 fw-extrabold text-success mb-0">${st.activeRentals ?? 0}</div><div class="text-secondary">Aktif</div></div></div></div>
      <div class="col-6 col-md"><div class="card"><div class="card-body py-3"><div class="h3 fw-extrabold text-success mb-0">${rupiah(st.revenue ?? 0)}</div><div class="text-secondary">Revenue</div></div></div></div>
    </div>
    <div class="d-flex flex-column gap-3">` + (rows.length ? rows.map((o) => `
      <div class="card">
        <div class="card-body">
          <div class="d-flex flex-wrap gap-2 align-items-center"><b class="mono">${esc(o.code)}</b><span class="badge bg-secondary">${esc(o.status)}</span><span class="ms-auto fw-bold text-success">${rupiah(o.total_idr)}</span></div>
          <div class="text-secondary small mt-2">👤 ${esc(o.username)} (${esc(o.wa_number || "-")}) • ${esc(o.pc_code)} • ${esc(o.plan_code)} • ${o.duration_hours}j • via ${esc(o.payment_method)}</div>
          ${o.payment_proof ? `<div class="small mt-1">🧾 Bukti: <b>${esc(o.payment_proof)}</b></div>` : `<div class="small text-secondary mt-1">belum ada bukti</div>`}
          ${o.note ? `<div class="small text-secondary mt-1">📝 ${esc(o.note)}</div>` : ""}
          <div class="d-flex gap-2 mt-3">
            <button onclick="approveOrder('${o.id}')" class="btn btn-success btn-sm fw-bold">✅ Approve & Buatkan RDP</button>
            <button onclick="rejectOrder('${o.id}')" class="btn btn-danger btn-sm">Reject</button>
          </div>
        </div>
      </div>`).join("") : `<div class="card"><div class="card-body text-secondary">Tidak ada order.</div></div>`) + `</div>`;
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
    <div class="card mb-4">
      <div class="card-body">
        <div class="d-flex flex-wrap align-items-center gap-3">
          <b>➕ Tambah PC Fisik</b>
          <button onclick="createPc()" class="btn btn-success fw-bold">➕ Tambah PC Baru</button>
        </div>
        <div class="text-secondary small mt-2">Kode & token dibuat otomatis. Spek PC terisi sendiri dari agent setelah connect → tinggal isi harga lalu klik <b class="text-body">🚀 Pasarkan</b> untuk tampil di katalog.</div>
      </div>
    </div>
    <div id="agentSetup">${agentSetupHtml}</div>
    <div class="d-flex flex-column gap-3">` + rows.map((p) => `
      <div class="card">
        <div class="card-body">
          <div class="d-flex flex-wrap gap-2 align-items-center"><b class="mono">${esc(p.code)}</b> ${statusBadge(p.status)}
            ${!p.last_seen_at ? `<span class="badge bg-secondary">⏳ Menunggu agent</span>` : (p.is_active ? `<span class="badge bg-success">✓ Dipasarkan</span>` : `<span class="badge bg-warning">Belum dipasarkan</span>`)}
            <span class="ms-auto small text-secondary">${esc(p.ip_public || "-")} • last seen: ${p.last_seen_at ? new Date(p.last_seen_at).toLocaleString("id-ID") : "-"}</span>
          </div>
          <div class="text-secondary small mt-2">${p.cpu ? esc(p.cpu) + " / " + esc(p.gpu) + " / " + p.ram_gb + "GB / " + p.storage_gb + "GB " + esc(p.storage_type) + " / " + esc(p.os) : esc(p.name) + " — ⏳ spek nunggu agent konek"}</div>
          ${p.motherboard ? `<div class="small text-secondary mt-1">🖥️ ${esc(p.motherboard)}</div>` : ""}${hwDetailHtml(p)}
          <div class="d-flex flex-wrap gap-2 mt-3">
            <select id="st-${p.id}" class="form-select form-select-sm w-auto">
              <option ${p.status === "available" ? "selected" : ""}>available</option><option ${p.status === "rented" ? "selected" : ""}>rented</option><option ${p.status === "maintenance" ? "selected" : ""}>maintenance</option><option ${p.status === "offline" ? "selected" : ""}>offline</option>
            </select>
            <input id="ip-${p.id}" value="${esc(p.ip_public || "")}" placeholder="IP publik" class="form-control form-control-sm w-auto mono"/>
            <input id="pd-${p.id}" type="number" value="${p.price_daily}" placeholder="harga/hari" title="Harga per hari (Rp)" class="form-control form-control-sm w-auto"/>
            <input id="pm-${p.id}" type="number" value="${p.price_monthly}" placeholder="harga/bulan" title="Harga per bulan (Rp)" class="form-control form-control-sm w-auto"/>
            <button onclick="savePc('${p.id}')" class="btn btn-dark btn-sm">💾 Simpan</button>
            ${p.last_seen_at && !p.is_active ? `<button onclick="publishPc('${p.id}')" class="btn btn-success btn-sm fw-bold">🚀 Pasarkan</button>` : ""}
            ${p.is_active ? `<button onclick="unpublishPc('${p.id}')" class="btn btn-dark btn-sm">⏸ Tarik dari katalog</button>` : ""}
            <button onclick="regenToken('${p.id}')" class="btn btn-warning btn-sm">🔑 Token Agent</button>
            <button onclick="delPc('${p.id}')" class="btn btn-danger btn-sm">Hapus</button>
          </div>
          <div class="small text-secondary mt-2">Harga: <b class="text-success">${rupiah(p.price_hourly)}/jam</b> • ${rupiah(p.price_daily)}/hari • ${rupiah(p.price_weekly)}/minggu • ${rupiah(p.price_monthly)}/bulan</div>
        </div>
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
    <div class="card border-success mb-4">
      <div class="card-body">
        <div class="d-flex flex-wrap align-items-center gap-2 mb-3">
          <b class="text-success">📌 PC ${esc(code)} — pasang agent di PC fisik</b>
          <button onclick="closeAgentSetup()" class="btn btn-dark btn-sm ms-auto">✕ Tutup</button>
        </div>
        <div class="row g-4">
          <div class="col-md-6 small text-secondary">
            <div class="fw-bold text-body">1. Download agent:</div>
            <a href="https://github.com/Miriprian/rentalrdp/releases/latest/download/rentalrdp-agent.exe" download="rentalrdp-agent.exe" target="_blank" class="btn btn-success my-2 fw-bold">⬇ Download rentalrdp-agent.exe</a>
            <div>Di-build otomatis oleh GitHub. Copy ke PC yang mau disewakan (USB / network share).</div>
            <a href="/api/download/agent" class="link-secondary">atau download dari server ini jika pernah build di sini</a>
            <div class="fw-bold text-body mt-3">2. Di PC fisik, double-click file .exe</div>
            <div>Wizard akan menanyakan Server URL → <b class="text-success">${esc(server)}</b></div>
          </div>
          <div class="col-md-6 small text-secondary">
            <div class="fw-bold text-body">3. Masukkan Agent Token:</div>
            <div class="mono bg-soft border rounded-3 px-3 py-2 text-break text-success my-2">${esc(token)}</div>
            <button onclick="copyAgentToken('${esc(token)}')" class="btn btn-dark btn-sm">📋 Salin Token</button>
            <div class="mt-2">Setelah connect, agent langsung terdaftar <b class="text-body">auto-start</b>. Kalaupun PC <b class="text-body">reboot / matilistrik lalu hidup</b>, agent jalan sendiri.</div>
            <div class="mt-1">Supaya juga jalan <b class="text-body">saat BOOT</b> (belum ada yang login): sekali jalankan .exe-nya <b class="text-body">klik kanan → Run as administrator</b>.</div>
            <div class="fw-bold text-body mt-3">4. Selesai</div>
            <div>Agent connect → spek real terisi & PC muncul di panel (status Belum dipasarkan). Isi harga lalu klik <b class="text-success">🚀 Pasarkan</b> → PC siap disewa.</div>
          </div>
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
  return `<div class="d-flex flex-column gap-3">` + (rows.length ? rows.map((x) => `
    <div class="card">
      <div class="card-body">
        <div class="d-flex flex-wrap gap-2 align-items-center"><b class="mono">${esc(x.pc_code)}</b><span class="badge bg-secondary">${esc(x.status)}</span><span class="ms-auto small text-secondary">👤 ${esc(x.username)} • s/d ${new Date(x.end_at).toLocaleString("id-ID")}</span></div>
        ${x.status === "active" ? `<button onclick="terminateRental('${x.id}')" class="btn btn-danger btn-sm mt-3">Terminate + Hapus User</button>` : ""}
      </div>
    </div>`).join("") : `<div class="card"><div class="card-body text-secondary">Kosong</div></div>`) + `</div>`;
}
window.terminateRental = async function (id) {
  if (!confirm("Terminate rental + hapus user OS?")) return;
  const r = await api(`/api/admin/rentals/${id}/terminate`, { method: "POST" });
  toast(r.message || "OK"); renderBody();
};

async function adminUsersHtml() {
  const r = await api("/api/admin/users");
  const rows = r.data || [];
  return `<div class="d-flex flex-column gap-2">` + rows.map((u) => `
    <div class="card">
      <div class="card-body d-flex flex-wrap gap-2 align-items-center">
        <b>${esc(u.username)}</b><span class="badge bg-secondary">${esc(u.role)}</span>
        <span class="small text-secondary">${esc(u.email)} • ${esc(u.wa_number || "")}</span>
        <span class="ms-auto d-flex flex-wrap gap-2">
          <select id="role-${u.id}" class="form-select form-select-sm w-auto"><option ${u.role === "user" ? "selected" : ""}>user</option><option ${u.role === "admin" ? "selected" : ""}>admin</option><option ${u.role === "superadmin" ? "selected" : ""}>superadmin</option></select>
          <button onclick="saveUser('${u.id}')" class="btn btn-dark btn-sm">Simpan</button>
          <button onclick="resetPass('${u.id}')" class="btn btn-warning btn-sm">Reset PW</button>
        </span>
      </div>
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
  return `<div class="card mb-3">
      <div class="card-body d-flex flex-wrap gap-2">
        <input id="vc" placeholder="KODE" class="form-control form-control-sm w-auto mono"/>
        <input id="vd" type="number" placeholder="% diskon" class="form-control form-control-sm w-auto"/>
        <button onclick="saveVoucher()" class="btn btn-success btn-sm fw-bold">Simpan Voucher</button>
      </div>
    </div>
    <div class="d-flex flex-column gap-2">` + rows.map((v) => `<div class="card"><div class="card-body small mono py-2">${esc(v.code)} — ${v.discount_percent}% (max ${rupiah(v.max_discount_idr)}) • ${v.used_count}/${v.quota}</div></div>`).join("") + `</div>`;
}
window.saveVoucher = async function () {
  const r = await api("/api/admin/vouchers", { method: "POST", body: JSON.stringify({ code: $("#vc").value, discountPercent: Number($("#vd").value || 10) }) });
  toast(r.message || "OK"); renderBody();
};

async function adminSettingsHtml() {
  const r = await api("/api/admin/settings");
  const s = r.data || {};
  const fields = ["site_name", "tagline", "wa_admin", "qris_text", "payment_bca", "notice"];
  return `<div class="card" style="max-width:48rem"><div class="card-body d-flex flex-column gap-3">` + fields.map((k) => `
    <div>
      <label class="form-label small text-secondary">${k}</label>
      <textarea id="set-${k}" rows="2" class="form-control">${esc(s[k] || "")}</textarea>
    </div>`).join("") + `
    <button onclick="saveSettings()" class="btn btn-success fw-bold align-self-start">Simpan Settings</button></div></div>`;
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
  return `<div class="d-flex flex-column gap-1 small mono">` + rows.slice(0, 100).map((a) => `<div class="card"><div class="card-body py-2">${new Date(a.created_at).toLocaleString("id-ID")} • <b>${esc(a.actor_name)}</b> • ${esc(a.action)} • ${esc(a.entity)}/${esc(a.entity_id)}</div></div>`).join("") + `</div>`;
}

(async () => {
  await loadMe();
  navInit("admin");
  if (!state.me) {
    $("#dashWrap").innerHTML = loginCardHtml("/admin");
    return;
  }
  if (!isAdminRole(state.me.role)) {
    $("#dashWrap").innerHTML = `<div class="card mx-auto" style="max-width:26rem">
      <div class="card-body text-center">
        <div class="fs-2">⛔</div><b>Akses ditolak</b>
        <p class="text-secondary small">Halaman ini khusus admin. Akunmu role <b>${esc(state.me.role)}</b>.</p>
        <a href="/app" class="btn btn-success fw-bold">Ke Dashboard Saya →</a>
      </div>
    </div>`;
    return;
  }
  $("#dashRole").textContent = `Login sebagai ${state.me.username} • role: ${state.me.role}`;
  renderTabs();
  renderBody();
})();