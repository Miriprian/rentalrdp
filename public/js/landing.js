/* Public catalog, authentication and checkout. API contracts are unchanged. */
const landing = { pcs: [], plans: [], settings: {}, orderPc: null, filter: "all", query: "", loading: false, loaded: false };

function contactHref() {
  const wa = (landing.settings.wa_admin || "").replace(/\D/g, "");
  return wa ? `https://wa.me/${wa}?text=${encodeURIComponent(t("wa_text"))}` : "#faq";
}

async function loadPublic() {
  if (landing.loading) return;
  landing.loading = true;
  try {
    const [pcs, plans, settings] = await Promise.all([api("/api/public/pcs"), api("/api/public/plans"), api("/api/public/settings")]);
    if (!pcs.ok || !plans.ok || !settings.ok) throw new Error(t("connection_error"));
    landing.pcs = pcs.data || [];
    landing.plans = plans.data || [];
    landing.settings = settings.data || {};
    landing.loaded = true;
    $("#statUnits").textContent = landing.pcs.length;
    $("#noticeBox").textContent = landing.settings.notice || "";
    $("#noticeBox").classList.toggle("hidden", !landing.settings.notice);
    const contact = $("#heroWA");
    contact.href = contactHref();
    if (contact.href.startsWith("https://wa.me/")) { contact.target = "_blank"; contact.rel = "noopener noreferrer"; }
    else { contact.removeAttribute("target"); contact.removeAttribute("rel"); }
    renderPcs();
    renderPlanOptions();
    $("#payInfo").innerHTML = `<b>${t("pay_to")}</b><br/>QRIS: ${esc(landing.settings.qris_text || "—")}<br/>${esc(landing.settings.payment_bca || "")}`;
  } catch (_) {
    if (!landing.loaded) $("#pcGrid").innerHTML = emptyStateHtml(t("connection_error"), "", `<button class="btn btn-ghost btn-sm" data-retry>${t("btn_refresh")}</button>`);
  } finally { landing.loading = false; }
}

function renderPcs() {
  const grid = $("#pcGrid");
  const expanded = new Set([...grid.querySelectorAll("details[open]")].map((el) => el.dataset.details));
  const query = landing.query.trim().toLowerCase();
  const rows = landing.pcs.filter((pc) => (landing.filter !== "available" || pc.status === "available") &&
    (!query || [pc.name, pc.code, pc.cpu, pc.gpu, pc.location, pc.ram_gb, pc.os].join(" ").toLowerCase().includes(query)));
  if (!rows.length) {
    grid.innerHTML = landing.pcs.length ? emptyStateHtml(t("empty_search_title"), esc(t("empty_search_desc")), `<button class="text-link" data-reset>${t("clear_filters")}</button>`) :
      emptyStateHtml(t("empty_catalog_title"), esc(t("empty_catalog_desc")), `<a class="text-link" href="${esc(contactHref())}">${t("cta_wa")}</a>`);
    return;
  }
  const period = $("#catalogPeriod").value;
  const suffix = { HOURLY: "lbl_hour", DAILY: "lbl_day", WEEKLY: "lbl_week", MONTHLY: "lbl_month" };
  grid.innerHTML = rows.map((pc) => `
    <article class="machine-card">
      <div class="machine-topline"><span class="machine-code mono">${esc(pc.code)}</span>${statusBadge(pc.status)}</div>
      <h3>${esc(pc.name)}</h3><p class="machine-location">${esc(pc.location || pc.city || "Bare metal")} / ${esc(pc.os || "PC")}</p>
      <dl class="machine-specs"><div><dt>CPU</dt><dd>${esc(pc.cpu || "—")}</dd></div><div><dt>GPU</dt><dd>${esc(pc.gpu || "—")}</dd></div></dl>
      <div class="machine-capacity"><div><b>${Number(pc.ram_gb || 0)} <span class="text-xs">GB</span></b><small>${t("spec_ram")}</small></div><div><b>${Number(pc.storage_gb || 0)} <span class="text-xs">GB</span></b><small>${esc(pc.storage_type || t("spec_storage"))}</small></div></div>
      <details class="machine-details" data-details="${esc(pc.id)}" ${expanded.has(pc.id) ? "open" : ""}><summary>${t("full_specs")}</summary>
        ${specHtml(pc)}${pc.description ? `<p class="machine-description">${esc(pc.description)}</p>` : ""}
        <dl class="machine-rates">${["HOURLY", "DAILY", "WEEKLY", "MONTHLY"].map((code) => `<div><dt>${t(suffix[code])}</dt><dd>${rupiah(priceFor(pc, code))}</dd></div>`).join("")}</dl>
      </details>
      <div class="machine-footer"><div class="machine-price"><b>${rupiah(priceFor(pc, period))}</b><span>${t(suffix[period])}</span></div>
        <button class="btn btn-block ${pc.status === "available" ? "btn-primary" : "btn-ghost"}" data-rent-pc="${esc(pc.id)}" ${pc.status === "available" ? "" : "disabled"}>${pc.status === "available" ? t("btn_rent_now") : t("btn_unavailable")}</button>
        ${["offline", "maintenance"].includes(pc.status) ? `<p class="machine-note">${t("pc_unavailable_note")}</p>` : ""}
      </div>
    </article>`).join("");
}

function renderPlanOptions() {
  const select = $("#orderPlan");
  const current = select.value;
  select.innerHTML = landing.plans.map((plan) => `<option value="${esc(plan.code)}">${esc(plan.name)} (${plan.duration_hours} ${t("hours")})</option>`).join("");
  if (landing.plans.some((plan) => plan.code === current)) select.value = current;
  updateTotal();
}
function priceFor(pc, code) {
  return pc[{ HOURLY: "price_hourly", DAILY: "price_daily", WEEKLY: "price_weekly", MONTHLY: "price_monthly" }[code] || "price_daily"];
}
function updateTotal() {
  if (!landing.orderPc) return;
  $("#orderTotal").innerHTML = `${esc(t("est_total"))}${rupiah(priceFor(landing.orderPc, $("#orderPlan").value))}<small>${esc(t("est_note").trim())}</small>`;
}
function openAuth() { $("#authMsg").textContent = ""; $("#authModal").showModal(); }
window.openOrder = function (id) {
  if (!state.me) { openAuth(); toast(t("msg_login_first")); return; }
  const pc = landing.pcs.find((item) => item.id === id);
  if (!pc || pc.status !== "available") { toast(t("btn_unavailable")); return; }
  landing.orderPc = pc;
  $("#orderPC").innerHTML = `<b>${esc(pc.name)}</b> <span class="mono text-xs">${esc(pc.code)}</span><small>${esc(pc.cpu)} · ${Number(pc.ram_gb)} GB · ${esc(pc.gpu)}</small>`;
  const period = $("#catalogPeriod").value;
  if (landing.plans.some((plan) => plan.code === period)) $("#orderPlan").value = period;
  $("#orderMsg").textContent = "";
  updateTotal();
  $("#orderModal").showModal();
};

$("#btnLogin").onclick = openAuth;
$("#btnLogout").onclick = () => runAction($("#btnLogout"), async () => { await api("/api/auth/logout", { method: "POST" }); location.reload(); });
$("#btnRefresh").onclick = () => runAction($("#btnRefresh"), loadPublic);
document.querySelectorAll("[data-filter]").forEach((button) => button.addEventListener("click", () => {
  landing.filter = button.dataset.filter;
  document.querySelectorAll("[data-filter]").forEach((el) => { const on = el === button; el.classList.toggle("is-active", on); el.setAttribute("aria-pressed", String(on)); });
  renderPcs();
}));
$("#catalogSearch").addEventListener("input", (event) => { landing.query = event.target.value; renderPcs(); });
$("#catalogPeriod").addEventListener("change", renderPcs);
$("#pcGrid").addEventListener("click", (event) => {
  const rent = event.target.closest("[data-rent-pc]");
  if (rent) openOrder(rent.dataset.rentPc);
  if (event.target.closest("[data-retry]")) loadPublic();
  if (event.target.closest("[data-reset]")) { landing.query = ""; $("#catalogSearch").value = ""; document.querySelector('[data-filter="all"]').click(); }
});
function setAuthMode(register) {
  $("#loginForm").classList.toggle("hidden", register);
  $("#regForm").classList.toggle("hidden", !register);
  [["#tabLogin", !register], ["#tabReg", register]].forEach(([selector, active]) => { $(selector).classList.toggle("is-active", active); $(selector).setAttribute("aria-pressed", String(active)); });
  $("#authMsg").textContent = "";
}
$("#tabLogin").onclick = () => setAuthMode(false);
$("#tabReg").onclick = () => setAuthMode(true);
$("#loginForm").onsubmit = (event) => {
  event.preventDefault();
  runAction($("#doLogin"), async () => {
    const response = await api("/api/auth/login", { method: "POST", body: JSON.stringify({ username: $("#liUser").value.trim(), password: $("#liPass").value }) });
    $("#authMsg").textContent = response.message || "";
    if (response.ok) { await loadMe(); location.href = isAdminRole(state.me?.role) ? "/admin" : "/app"; }
  }, $("#authMsg"));
};
$("#regForm").onsubmit = (event) => {
  event.preventDefault();
  runAction($("#doReg"), async () => {
    const response = await api("/api/auth/register", { method: "POST", body: JSON.stringify({ username: $("#rgUser").value.trim(), email: $("#rgEmail").value.trim(), fullName: $("#rgName").value, waNumber: $("#rgWA").value, password: $("#rgPass").value }) });
    $("#authMsg").textContent = response.message || "";
    if (response.ok) location.href = "/app";
  }, $("#authMsg"));
};
$("#orderPlan").onchange = updateTotal;
$("#checkoutForm").onsubmit = (event) => {
  event.preventDefault();
  if (!landing.orderPc) return;
  runAction($("#doOrder"), async () => {
    const response = await api("/api/orders", { method: "POST", body: JSON.stringify({ pcId: landing.orderPc.id, planCode: $("#orderPlan").value, voucherCode: $("#orderVoucher").value.trim(), paymentMethod: $("#orderPay").value, note: $("#orderNote").value }) });
    $("#orderMsg").textContent = response.message || "";
    if (response.ok) { $("#orderModal").close(); location.href = "/app"; }
  }, $("#orderMsg"));
};

(async () => {
  await Promise.all([loadPublic(), loadMe()]);
  const logged = !!state.me;
  $("#btnLogin").classList.toggle("hidden", logged);
  $("#btnLogout").classList.toggle("hidden", !logged);
  $("#navUser").textContent = logged ? state.me.username : "";
  $("#btnDash").classList.toggle("hidden", !logged);
  $("#btnAdminNav").classList.toggle("hidden", !(logged && isAdminRole(state.me.role)));
})();
setInterval(loadPublic, 30_000);
