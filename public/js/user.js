/* Rental PC by Miriprian — dashboard penyewa (/app) */
let tab = "orders";

const orderStatusChip = (s) => {
  const m = {
    pending: ["amber", t("order_pending")],
    waiting_verification: ["amber", t("order_waiting")],
    approved: ["emerald", t("order_approved")],
    rejected: ["red", t("order_rejected")],
    completed: ["slate", t("order_completed")],
    cancelled: ["slate", t("order_cancelled")],
  };
  const [v, label] = m[s] || ["slate", s || "—"];
  return chip(label, v);
};
const rentalStatusChip = (s) => {
  const m = { active: ["emerald", t("rental_active")], expired: ["slate", t("rental_expired")], terminated: ["red", t("rental_terminated")] };
  const [v, label] = m[s] || ["slate", s || "—"];
  return chip(label, v);
};

function renderTabs() {
  const tabs = [["orders", t("tab_orders")], ["rentals", t("tab_rentals")], ["akun", t("tab_akun")]];
  if (!tabs.find((t) => t[0] === tab)) tab = "orders";
  $("#dashTabs").innerHTML = tabs.map(([k, l]) => `<button onclick="setTab('${k}')" class="tab ${tab === k ? "tab-on" : ""}">${l}</button>`).join("");
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

function copyBtn(text, label) {
  const safe = JSON.stringify(text).replaceAll('"', "&quot;");
  return `<button class="btn btn-ghost btn-sm" onclick="navigator.clipboard.writeText(${safe}).then(()=>toast('${t("copied")}'))">${label} ⧉</button>`;
}

async function myOrdersHtml() {
  const r = await api("/api/orders/mine");
  const rows = r.data || [];
  if (!rows.length) return `<div class="card rounded-2xl p-8 text-sm text-center">${t("empty_orders")}</div>`;
  return `<div class="grid gap-4">` + rows.map((o) => `
    <div class="card card-hover rounded-2xl p-5 text-sm">
      <div class="flex flex-wrap gap-2 items-center">
        <b class="mono text-emerald-300">${esc(o.code)}</b>
        ${orderStatusChip(o.status)}
        <span class="ml-auto font-extrabold text-lg text-emerald-300">${rupiah(o.total_idr)}</span>
      </div>
      <div class="text-slate-300 mt-2 text-xs grid sm:grid-cols-2 gap-x-4 gap-y-0.5">
        <div>🖥️ ${esc(o.pc_name)} <span class="mono">${esc(o.pc_code)}</span></div>
        <div>📦 ${esc(o.plan_name)} • ${o.duration_hours} ${t("hours")}</div>
        <div>💳 ${t("via")} ${esc(o.payment_method)}</div>
        <div>📅 ${o.created_at ? new Date(o.created_at).toLocaleString("id-ID") : ""}</div>
      </div>
      ${o.payment_proof ? `<div class="text-xs text-slate-400 mt-1.5">${t("proof_label")} <span class="mono text-emerald-300">${esc(o.payment_proof)}</span></div>` : ""}
      ${["pending", "waiting_verification"].includes(o.status) ? `
        <div class="flex gap-2 mt-4">
          <input id="proof-${o.id}" placeholder="${esc(t("ph_proof"))}" class="input !py-2 text-xs flex-1"/>
          <button onclick="sendProof('${o.id}')" class="btn btn-amber btn-sm">${t("btn_send_proof")}</button>
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
  if (!rows.length) return `<div class="card rounded-2xl p-8 text-sm text-center">${t("empty_rentals")}</div>`;
  return `<div class="grid gap-4">` + rows.map((x) => `
    <div class="card card-hover rounded-2xl p-5 border-l-4 border-l-emerald-500/70">
      <div class="flex flex-wrap gap-2 items-center">
        <b class="text-lg">${esc(x.pc_name)} <span class="mono text-xs text-slate-400">${esc(x.pc_code)}</span></b>
        ${rentalStatusChip(x.status)}
        <span class="ml-auto text-xs text-amber-300 font-semibold">⏳ ${dl(x.end_at)}</span>
      </div>
      <div class="grid sm:grid-cols-3 gap-2 mt-4 mono text-xs">
        <div class="bg-slate-800 rounded-xl p-3">${t("host")}<br/><b class="text-emerald-300 break-all">${esc(x.rdp_host)}:${x.rdp_port}</b><div class="mt-1">${copyBtn(x.rdp_host, t("copy"))}</div></div>
        <div class="bg-slate-800 rounded-xl p-3">${t("user")}<br/><b class="text-emerald-300 break-all">${esc(x.rdp_user)}</b><div class="mt-1">${copyBtn(x.rdp_user, t("copy"))}</div></div>
        <div class="bg-slate-800 rounded-xl p-3">${t("pass")}<br/><b class="text-emerald-300 break-all">${esc(x.rdpPass)}</b><div class="mt-1">${copyBtn(x.rdpPass, t("copy"))}</div></div>
      </div>
      <div class="text-xs text-slate-400 mt-3 flex flex-wrap gap-x-4 gap-y-1">
        <span>${t("active")} <b>${new Date(x.start_at).toLocaleString("id-ID")}</b></span>
        <span>${t("end")} <b class="text-amber-300">${new Date(x.end_at).toLocaleString("id-ID")}</b></span>
        <span>${t("order")} <span class="mono">${esc(x.order_code)}</span></span>
      </div>
      <div class="text-xs mt-3 bg-slate-800 rounded-xl p-3 flex gap-2">📲 <b>${t("guide_label")}</b><span>${t("guide_text")}</span></div>
      ${x.status === "active" ? `<div class="flex flex-wrap gap-2 mt-4">
        <button onclick="extendRental('${x.id}',24)" class="btn btn-ghost btn-sm">+${t("ext_day")}</button>
        <button onclick="extendRental('${x.id}',168)" class="btn btn-ghost btn-sm">+${t("ext_week")}</button>
        <button onclick="extendRental('${x.id}',720)" class="btn btn-ghost btn-sm">+${t("ext_month")}</button>
      </div>` : ""}
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