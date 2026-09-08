/* rentalrdp.com — dashboard penyewa (/app) */
let tab = "orders";

function renderTabs() {
  const tabs = [["orders", "📦 Pesanan Saya"], ["rentals", "🔑 RDP Saya"], ["akun", "🔒 Akun Saya"]];
  if (!tabs.find((t) => t[0] === tab)) tab = "orders";
  $("#dashTabs").innerHTML = tabs.map(([k, l]) => `<button onclick="setTab('${k}')" class="px-4 py-2 rounded-lg ${tab === k ? "bg-emerald-600 font-bold" : "bg-slate-800"}">${l}</button>`).join("");
}
window.setTab = function (k) { tab = k; renderTabs(); renderBody(); };

async function renderBody() {
  const b = $("#dashBody");
  b.innerHTML = `<div class="text-sm text-slate-400">Memuat…</div>`;
  try {
    if (tab === "orders") b.innerHTML = await myOrdersHtml();
    else if (tab === "rentals") b.innerHTML = await myRentalsHtml();
    else b.innerHTML = akunHtml();
  } catch (e) { b.innerHTML = `<div class="text-red-300 text-sm">Gagal memuat: ${esc(e.message)}</div>`; }
}

async function myOrdersHtml() {
  const r = await api("/api/orders/mine");
  const rows = r.data || [];
  if (!rows.length) return `<div class="card rounded-xl p-6 text-sm">Belum ada pesanan. <a href="/" class="text-emerald-300 underline">Lihat katalog & sewa →</a></div>`;
  return `<div class="grid gap-3">` + rows.map((o) => `
    <div class="card rounded-xl p-4 text-sm">
      <div class="flex flex-wrap gap-2 items-center"><b class="mono">${esc(o.code)}</b><span class="text-xs px-2 py-1 rounded bg-slate-800">${esc(o.status)}</span><span class="ml-auto font-bold text-emerald-300">${rupiah(o.total_idr)}</span></div>
      <div class="text-slate-300 mt-1">${esc(o.pc_name)} (${esc(o.pc_code)}) • ${esc(o.plan_name)} • ${o.duration_hours} jam • via ${esc(o.payment_method)}</div>
      ${o.payment_proof ? `<div class="text-xs text-slate-400 mt-1">Bukti: ${esc(o.payment_proof)}</div>` : ""}
      ${["pending", "waiting_verification"].includes(o.status) ? `
        <div class="flex gap-2 mt-3">
          <input id="proof-${o.id}" placeholder="No. ref / keterangan bayar" class="flex-1 px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-xs"/>
          <button onclick="sendProof('${o.id}')" class="px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-xs font-bold">Kirim Bukti</button>
        </div>` : ""}
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
  if (!rows.length) return `<div class="card rounded-xl p-6 text-sm">Belum ada RDP aktif.</div>`;
  return `<div class="grid gap-3">` + rows.map((x) => `
    <div class="card rounded-xl p-4 text-sm border-emerald-500/30 border">
      <div class="flex gap-2 items-center"><b>${esc(x.pc_name)} (${esc(x.pc_code)})</b><span class="text-xs px-2 py-1 rounded bg-emerald-600">${esc(x.status)}</span><span class="ml-auto text-xs text-amber-300">⏳ ${dl(x.end_at)}</span></div>
      <div class="grid sm:grid-cols-3 gap-2 mt-3 mono text-xs">
        <div class="bg-slate-800 rounded-lg p-3">HOST<br/><b class="text-emerald-300">${esc(x.rdp_host)}:${x.rdp_port}</b> <button class="underline" onclick="navigator.clipboard.writeText('${esc(x.rdp_host)}')">copy</button></div>
        <div class="bg-slate-800 rounded-lg p-3">USER<br/><b class="text-emerald-300">${esc(x.rdp_user)}</b> <button class="underline" onclick="navigator.clipboard.writeText('${esc(x.rdp_user)}')">copy</button></div>
        <div class="bg-slate-800 rounded-lg p-3">PASS<br/><b class="text-emerald-300">${esc(x.rdpPass)}</b> <button class="underline" onclick="navigator.clipboard.writeText('${esc(x.rdpPass)}')">copy</button></div>
      </div>
      <div class="text-xs text-slate-400 mt-2">Aktif: ${new Date(x.start_at).toLocaleString("id-ID")} → Berakhir: <b class="text-amber-300">${new Date(x.end_at).toLocaleString("id-ID")}</b> • Order <span class="mono">${esc(x.order_code)}</span></div>
      <div class="text-xs mt-2 bg-slate-800 rounded-lg p-3">📲 <b>Panduan:</b> Windows → buka <span class="mono">mstsc</span> → isi host → user+pass. Android → install <b>RD Client (Microsoft)</b> → Add PC → isi sama.</div>
      ${x.status === "active" ? `<div class="flex gap-2 mt-3"><button onclick="extendRental('${x.id}',24)" class="px-4 py-2 rounded-lg bg-slate-700 text-xs">+1 hari</button><button onclick="extendRental('${x.id}',168)" class="px-4 py-2 rounded-lg bg-slate-700 text-xs">+1 minggu</button><button onclick="extendRental('${x.id}',720)" class="px-4 py-2 rounded-lg bg-slate-700 text-xs">+1 bulan</button></div>` : ""}
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
