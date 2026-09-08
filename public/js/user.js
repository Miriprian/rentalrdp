/* rentalrdp.com — dashboard penyewa (/app) */
let tab = "orders";

function renderTabs() {
  const tabs = [["orders", t("tab_orders")], ["rentals", t("tab_rentals")], ["akun", t("tab_akun")]];
  if (!tabs.find((t) => t[0] === tab)) tab = "orders";
  $("#dashTabs").innerHTML = tabs.map(([k, l]) => `<button onclick="setTab('${k}')" class="px-4 py-2 rounded-lg ${tab === k ? "bg-emerald-600 font-bold" : "bg-slate-800"}">${l}</button>`).join("");
}
window.setTab = function (k) { tab = k; renderTabs(); renderBody(); };

async function renderBody() {
  const b = $("#dashBody");
  b.innerHTML = `<div class="text-sm text-slate-400">${t("loading")}</div>`;
  try {
    if (tab === "orders") b.innerHTML = await myOrdersHtml();
    else if (tab === "rentals") b.innerHTML = await myRentalsHtml();
    else b.innerHTML = akunHtml();
  } catch (e) { b.innerHTML = `<div class="text-red-300 text-sm">${t("load_fail")}${esc(e.message)}</div>`; }
}

async function myOrdersHtml() {
  const r = await api("/api/orders/mine");
  const rows = r.data || [];
  if (!rows.length) return `<div class="card rounded-xl p-6 text-sm">${t("empty_orders")}</div>`;
  return `<div class="grid gap-3">` + rows.map((o) => `
    <div class="card rounded-xl p-4 text-sm">
      <div class="flex flex-wrap gap-2 items-center"><b class="mono">${esc(o.code)}</b><span class="text-xs px-2 py-1 rounded bg-slate-800">${esc(o.status)}</span><span class="ml-auto font-bold text-emerald-300">${rupiah(o.total_idr)}</span></div>
      <div class="text-slate-300 mt-1">${esc(o.pc_name)} (${esc(o.pc_code)}) • ${esc(o.plan_name)} • ${o.duration_hours} jam •${t("via")}${esc(o.payment_method)}</div>
      ${o.payment_proof ? `<div class="text-xs text-slate-400 mt-1">${t("proof_label")}${esc(o.payment_proof)}</div>` : ""}
      ${["pending", "waiting_verification"].includes(o.status) ? `
        <div class="flex gap-2 mt-3">
          <input id="proof-${o.id}" placeholder="${esc(t("ph_proof"))}" class="flex-1 px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-xs"/>
          <button onclick="sendProof('${o.id}')" class="px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-xs font-bold">${t("btn_send_proof")}</button>
        </div>` : ""}
    </div>`).join("") + `</div>`;
}
window.sendProof = async function (id) {
  const v = document.getElementById("proof-" + id).value.trim();
  if (!v) return toast(t("need_proof"));
  const r = await api(`/api/orders/${id}/proof`, { method: "POST", body: JSON.stringify({ paymentProof: v }) });
  toast(r.message || (r.ok ? t("sent_ok") : t("fail")));
  renderBody();
};

async function myRentalsHtml() {
  const r = await api("/api/rentals/mine");
  const rows = r.data || [];
  if (!rows.length) return `<div class="card rounded-xl p-6 text-sm">${t("empty_rentals")}</div>`;
  return `<div class="grid gap-3">` + rows.map((x) => `
    <div class="card rounded-xl p-4 text-sm border-emerald-500/30 border">
      <div class="flex gap-2 items-center"><b>${esc(x.pc_name)} (${esc(x.pc_code)})</b><span class="text-xs px-2 py-1 rounded bg-emerald-600">${esc(x.status)}</span><span class="ml-auto text-xs text-amber-300">⏳ ${dl(x.end_at)}</span></div>
      <div class="grid sm:grid-cols-3 gap-2 mt-3 mono text-xs">
        <div class="bg-slate-800 rounded-lg p-3">${t("host")}<br/><b class="text-emerald-300">${esc(x.rdp_host)}:${x.rdp_port}</b> <button class="underline" onclick="navigator.clipboard.writeText('${esc(x.rdp_host)}')">${t("copy")}</button></div>
        <div class="bg-slate-800 rounded-lg p-3">${t("user")}<br/><b class="text-emerald-300">${esc(x.rdp_user)}</b> <button class="underline" onclick="navigator.clipboard.writeText('${esc(x.rdp_user)}')">${t("copy")}</button></div>
        <div class="bg-slate-800 rounded-lg p-3">${t("pass")}<br/><b class="text-emerald-300">${esc(x.rdpPass)}</b> <button class="underline" onclick="navigator.clipboard.writeText('${esc(x.rdpPass)}')">${t("copy")}</button></div>
      </div>
      <div class="text-xs text-slate-400 mt-2">${t("active")}${new Date(x.start_at).toLocaleString("id-ID")} → ${t("end")}<b class="text-amber-300">${new Date(x.end_at).toLocaleString("id-ID")}</b> • ${t("order")}<span class="mono">${esc(x.order_code)}</span></div>
      <div class="text-xs mt-2 bg-slate-800 rounded-lg p-3">📲 <b>${t("guide_label")}</b> ${t("guide_text")}</div>
      ${x.status === "active" ? `<div class="flex gap-2 mt-3"><button onclick="extendRental('${x.id}',24)" class="px-4 py-2 rounded-lg bg-slate-700 text-xs">${t("ext_day")}</button><button onclick="extendRental('${x.id}',168)" class="px-4 py-2 rounded-lg bg-slate-700 text-xs">${t("ext_week")}</button><button onclick="extendRental('${x.id}',720)" class="px-4 py-2 rounded-lg bg-slate-700 text-xs">${t("ext_month")}</button></div>` : ""}
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
  $("#dashRole").textContent = t("login_as") + `${state.me.username}` + t("role") + state.me.role;
  if (isAdminRole(state.me.role)) {
    $("#adminHint").classList.remove("hidden");
  }
  renderTabs();
  renderBody();
})();
