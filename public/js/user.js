/* rentalrdp.com — dashboard penyewa (/app) */
let tab = "orders";

function renderTabs() {
  const tabs = [["orders", "📦 Pesanan Saya"], ["rentals", "🔑 RDP Saya"], ["akun", "🔒 Akun Saya"]];
  if (!tabs.find((t) => t[0] === tab)) tab = "orders";
  $("#dashTabs").innerHTML = tabs.map(([k, l]) => `<button onclick="setTab('${k}')" class="btn btn-sm ${tab === k ? "btn-primary fw-bold" : "btn-dark"}">${l}</button>`).join("");
}
window.setTab = function (k) { tab = k; renderTabs(); renderBody(); };

async function renderBody() {
  const b = $("#dashBody");
  b.innerHTML = `<div class="text-secondary small">Memuat…</div>`;
  try {
    if (tab === "orders") b.innerHTML = await myOrdersHtml();
    else if (tab === "rentals") b.innerHTML = await myRentalsHtml();
    else b.innerHTML = akunHtml();
  } catch (e) { b.innerHTML = `<div class="text-danger small">Gagal memuat: ${esc(e.message)}</div>`; }
}

async function myOrdersHtml() {
  const r = await api("/api/orders/mine");
  const rows = r.data || [];
  if (!rows.length) return `<div class="card"><div class="card-body text-secondary bg-soft rounded-3">Belum ada pesanan. <a href="/" class="text-success fw-bold">Lihat katalog & sewa →</a></div></div>`;
  return `<div class="d-flex flex-column gap-3">` + rows.map((o) => `
    <div class="card">
      <div class="card-body">
        <div class="d-flex flex-wrap gap-2 align-items-center"><b class="mono">${esc(o.code)}</b><span class="badge bg-secondary">${esc(o.status)}</span><span class="ms-auto fw-bold text-success">${rupiah(o.total_idr)}</span></div>
        <div class="text-secondary small mt-2">${esc(o.pc_name)} (${esc(o.pc_code)}) • ${esc(o.plan_name)} • ${o.duration_hours} jam • via ${esc(o.payment_method)}</div>
        ${o.payment_proof ? `<div class="small text-secondary mt-1">Bukti: ${esc(o.payment_proof)}</div>` : ""}
        ${["pending", "waiting_verification"].includes(o.status) ? `
          <div class="d-flex gap-2 mt-3">
            <input id="proof-${o.id}" placeholder="No. ref / keterangan bayar" class="form-control form-control-sm flex-grow-1"/>
            <button onclick="sendProof('${o.id}')" class="btn btn-warning btn-sm fw-bold">Kirim Bukti</button>
          </div>` : ""}
      </div>
    </div>`).join("") + `</div>`;
}
window.sendProof = async function (id) {
  const v = document.getElementById("proof-" + id).value.trim();
  if (!v) return toast("Isi bukti bayar dulu");
  const r = await api(`/api/orders/${id}/proof`, { method: "POST", body: JSON.stringify({ paymentProof: v }) });
  toast(r.message || (r.ok ? "Terkirim" : "Gagal"));
  renderBody();
};

async function myRentalsHtml() {
  const r = await api("/api/rentals/mine");
  const rows = r.data || [];
  if (!rows.length) return `<div class="card"><div class="card-body text-secondary bg-soft rounded-3">Belum ada RDP aktif.</div></div>`;
  return `<div class="d-flex flex-column gap-3">` + rows.map((x) => `
    <div class="card border-success">
      <div class="card-body">
        <div class="d-flex gap-2 align-items-center flex-wrap"><b>${esc(x.pc_name)} (${esc(x.pc_code)})</b><span class="badge bg-success">${esc(x.status)}</span><span class="ms-auto small text-warning">⏳ ${dl(x.end_at)}</span></div>
        <div class="row g-2 mt-3">
          <div class="col-sm-4 mono small"><div class="bg-soft rounded-3 p-3 border">HOST<br/><b class="text-success text-break">${esc(x.rdp_host)}:${x.rdp_port}</b> <button class="btn btn-link btn-sm p-0 ms-1" onclick="navigator.clipboard.writeText('${esc(x.rdp_host)}')">copy</button></div></div>
          <div class="col-sm-4 mono small"><div class="bg-soft rounded-3 p-3 border">USER<br/><b class="text-success text-break">${esc(x.rdp_user)}</b> <button class="btn btn-link btn-sm p-0 ms-1" onclick="navigator.clipboard.writeText('${esc(x.rdp_user)}')">copy</button></div></div>
          <div class="col-sm-4 mono small"><div class="bg-soft rounded-3 p-3 border">PASS<br/><b class="text-success text-break">${esc(x.rdpPass)}</b> <button class="btn btn-link btn-sm p-0 ms-1" onclick="navigator.clipboard.writeText('${esc(x.rdpPass)}')">copy</button></div></div>
        </div>
        <div class="small text-secondary mt-2">Aktif: ${new Date(x.start_at).toLocaleString("id-ID")} → Berakhir: <b class="text-warning">${new Date(x.end_at).toLocaleString("id-ID")}</b> • Order <span class="mono">${esc(x.order_code)}</span></div>
        <div class="small mt-2 mb-0 bg-soft rounded-3 p-3 border">📲 <b class="text-body">Panduan:</b> Windows → buka <span class="mono">mstsc</span> → isi host → user+pass. Android → install <b>RD Client (Microsoft)</b> → Add PC → isi sama.</div>
        ${x.status === "active" ? `<div class="d-flex flex-wrap gap-2 mt-3"><button onclick="extendRental('${x.id}',24)" class="btn btn-dark btn-sm">+1 hari</button><button onclick="extendRental('${x.id}',168)" class="btn btn-dark btn-sm">+1 minggu</button><button onclick="extendRental('${x.id}',720)" class="btn btn-dark btn-sm">+1 bulan</button></div>` : ""}
      </div>
    </div>`).join("") + `</div>`;
}
window.extendRental = async function (id, hours) {
  const r = await api(`/api/rentals/${id}/extend`, { method: "POST", body: JSON.stringify({ hours }) });
  toast(r.message || "OK"); renderBody();
};

(async () => {
  await loadMe();
  navInit("app");
  if (!state.me) {
    $("#dashWrap").innerHTML = loginCardHtml("/app");
    return;
  }
  $("#dashRole").textContent = `Login sebagai ${state.me.username} • role: ${state.me.role}`;
  if (isAdminRole(state.me.role)) {
    $("#adminHint").classList.remove("hidden");
  }
  renderTabs();
  renderBody();
})();