/* Renter workspace. Existing order, proof and extension endpoints are preserved. */
let tab = location.hash.slice(1) || "orders";

const orderStatusChip = (status) => {
  const map = { pending: ["amber", "order_pending"], waiting_verification: ["amber", "order_waiting"], approved: ["emerald", "order_approved"], active: ["emerald", "order_active"], paid: ["emerald", "order_paid"], rejected: ["red", "order_rejected"], completed: ["slate", "order_completed"], cancelled: ["slate", "order_cancelled"] };
  const [variant, key] = map[status] || ["slate", status || "—"];
  return chip(esc(t(key)), variant);
};
const rentalStatusChip = (status) => {
  const map = { active: ["emerald", "rental_active"], expired: ["slate", "rental_expired"], terminated: ["red", "rental_terminated"] };
  const [variant, key] = map[status] || ["slate", status || "—"];
  return chip(esc(t(key)), variant);
};

function renderTabs() {
  const tabs = [["orders", t("tab_orders")], ["rentals", t("tab_rentals")], ["akun", t("tab_akun")]];
  if (!tabs.some(([key]) => key === tab)) tab = "orders";
  $("#dashTabs").innerHTML = tabs.map(([key, label], index) => `<button onclick="setTab('${key}')" class="tab ${tab === key ? "tab-on" : ""}" ${tab === key ? 'aria-current="page"' : ""}><span class="tab-index" aria-hidden="true">0${index + 1}</span>${esc(label.trim())}</button>`).join("");
  $("#viewTitle").textContent = tabs.find(([key]) => key === tab)[1].trim();
}
window.setTab = function (key) { tab = key; history.replaceState(null, "", `#${key}`); renderTabs(); renderBody(); };
async function renderBody() {
  const body = $("#dashBody");
  const selected = tab;
  body.innerHTML = `<div class="loading-state">${t("loading")}</div>`;
  try {
    const html = selected === "orders" ? await myOrdersHtml() : selected === "rentals" ? await myRentalsHtml() : akunHtml();
    if (tab === selected) body.innerHTML = html;
  } catch (error) { if (tab === selected) body.innerHTML = emptyStateHtml(t("load_fail"), esc(error.message)); }
}

function copyBtn(text, label) {
  const safe = esc(JSON.stringify(String(text || "")));
  return `<button class="btn btn-ghost btn-sm" onclick="copyText(${safe})">${esc(label)}</button>`;
}
window.copyText = async function (text) {
  try { await navigator.clipboard.writeText(text); toast(t("copied")); }
  catch (_) { toast(t("token_manual") + " " + text); }
};

async function myOrdersHtml() {
  const response = await api("/api/orders/mine");
  if (!response.ok) throw new Error(response.message || t("connection_error"));
  const rows = response.data || [];
  if (!rows.length) return emptyStateHtml(t("no_orders_title"), t("empty_orders"));
  return `<div class="grid gap-4">${rows.map((order) => `
    <article class="card order-card">
      <div class="order-line"><b class="mono text-xs">${esc(order.code)}</b>${orderStatusChip(order.status)}<span class="order-amount">${rupiah(order.total_idr)}</span></div>
      <div class="order-facts"><div><small>${t("order_device")}</small>${esc(order.pc_name)} <span class="mono text-xs">${esc(order.pc_code)}</span></div><div><small>${t("order_package")}</small>${esc(order.plan_name)} · ${order.duration_hours} ${t("hours")}</div><div><small>${t("order_payment")}</small>${esc(order.payment_method).toUpperCase()}</div><div><small>${t("order_date")}</small>${order.created_at ? new Date(order.created_at).toLocaleString(langState.lang === "en" ? "en-GB" : "id-ID") : "—"}</div></div>
      ${order.payment_proof ? `<p class="text-xs text-slate-400 mb-4">${t("proof_label")} <span class="mono">${esc(order.payment_proof)}</span></p>` : ""}
      ${["pending", "waiting_verification"].includes(order.status) ? `<form class="proof-form" onsubmit="event.preventDefault(); sendProof('${order.id}')"><label class="sr-only" for="proof-${order.id}">${t("ph_proof")}</label><input id="proof-${order.id}" placeholder="${esc(t("ph_proof"))}" class="input" required/><button id="proofBtn-${order.id}" type="submit" class="btn btn-primary btn-sm">${t("btn_send_proof")}</button></form>` : ""}
    </article>`).join("")}</div>`;
}
window.sendProof = async function (id) {
  const value = document.getElementById("proof-" + id).value.trim();
  if (!value) return toast(t("need_proof"));
  await runAction(document.getElementById("proofBtn-" + id), async () => {
    const response = await api(`/api/orders/${id}/proof`, { method: "POST", body: JSON.stringify({ paymentProof: value }) });
    toast(response.message || (response.ok ? t("sent_ok") : t("fail")));
    if (response.ok) renderBody();
  });
};

async function myRentalsHtml() {
  const response = await api("/api/rentals/mine");
  if (!response.ok) throw new Error(response.message || t("connection_error"));
  const rows = response.data || [];
  if (!rows.length) return emptyStateHtml(t("no_rentals_title"), esc(t("no_rentals_desc")), `<a href="/#katalog" class="text-link">${t("cta_katalog")}</a>`);
  return `<div class="grid gap-4">${rows.map((rental) => `
    <article class="card order-card">
      <div class="order-line"><h2 class="text-lg font-medium">${esc(rental.pc_name)}</h2><span class="mono text-xs text-slate-400">${esc(rental.pc_code)}</span>${rentalStatusChip(rental.status)}<span class="ml-auto text-xs text-slate-400">${dl(rental.end_at)}</span></div>
      <div class="rental-credentials">${[[t("host"), `${rental.rdp_host}:${rental.rdp_port}`], [t("user"), rental.rdp_user], [t("pass"), rental.rdpPass]].map(([label, value]) => `<div class="credential"><label>${label}</label><strong>${esc(value)}</strong>${copyBtn(value, t("copy"))}</div>`).join("")}</div>
      <div class="order-facts"><div><small>${t("active")}</small>${new Date(rental.start_at).toLocaleString("id-ID")}</div><div><small>${t("end")}</small>${new Date(rental.end_at).toLocaleString("id-ID")}</div></div>
      <p class="text-xs text-slate-400">${t("guide_text")}</p>
      ${rental.status === "active" ? `<div class="flex flex-wrap gap-2 mt-5"><button onclick="extendRental('${rental.id}',24)" class="btn btn-ghost btn-sm">${t("ext_day")}</button><button onclick="extendRental('${rental.id}',168)" class="btn btn-ghost btn-sm">${t("ext_week")}</button><button onclick="extendRental('${rental.id}',720)" class="btn btn-ghost btn-sm">${t("ext_month")}</button></div>` : ""}
    </article>`).join("")}</div>`;
}
window.extendRental = async function (id, hours) {
  const response = await api(`/api/rentals/${id}/extend`, { method: "POST", body: JSON.stringify({ hours }) });
  toast(response.message || "OK"); renderBody();
};

window.addEventListener("hashchange", () => {
  if (!state.me || !$("#dashTabs")) return;
  tab = location.hash.slice(1) || "orders";
  renderTabs(); renderBody();
});

(async () => {
  await loadMe();
  navInit("app");
  if (!state.me) { $("#dashWrap").innerHTML = loginCardHtml("/app"); return; }
  $("#dashRole").textContent = t("msg_welcome") + state.me.username + ".";
  $("#adminHint").classList.toggle("hidden", !isAdminRole(state.me.role));
  renderTabs(); renderBody();
})();
