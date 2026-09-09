/* Rental PC by Miriprian — landing (/) : katalog + auth modal + order modal */
const landing = { pcs: [], plans: [], settings: {}, orderPc: null };

async function loadPublic() {
  const [pcs, plans, settings] = await Promise.all([api("/api/public/pcs"), api("/api/public/plans"), api("/api/public/settings")]);
  landing.pcs = pcs.data || [];
  landing.plans = plans.data || [];
  landing.settings = settings.data || {};
  $("#statUnits").textContent = landing.pcs.length || "—";
  const noticeEl = $("#noticeBox");
  if (noticeEl) noticeEl.textContent = landing.settings.notice || "";
  const wa = (landing.settings.wa_admin || "").replace(/\D/g, "");
  if (wa) $("#heroWA").href = `https://wa.me/${wa}?text=${encodeURIComponent(t("wa_text"))}`;
  renderPcs();
  renderPlanOptions();
  $("#payInfo").innerHTML = `<b>${t("pay_to")}</b><br/>QRIS: ${esc(landing.settings.qris_text || "-")}<br/>${esc(landing.settings.payment_bca || "")}`;
}

function renderPcs() {
  const g = $("#pcGrid");
  if (!landing.pcs.length) { g.innerHTML = `<div class="card rounded-xl p-6 text-sm text-slate-400">${t("empty_units")}</div>`; return; }
  g.innerHTML = landing.pcs.map((p) => `
    <div class="card rounded-2xl p-5 flex flex-col">
      <div class="flex items-center gap-2 mb-1">
        <span class="mono text-xs text-slate-400">${esc(p.code)}</span>
        <span class="ml-auto">${statusBadge(p.status)}</span>
      </div>
      <div class="font-extrabold">${esc(p.name)}</div>
      <div class="text-[11px] mt-0.5 text-emerald-300 font-bold tracking-wide">BARE METAL</div>
      ${specHtml(p)}
      <p class="text-xs text-slate-400 mt-2">${esc(p.description || "")}</p>
      <div class="grid grid-cols-2 gap-2 mt-3 text-xs">
        <div class="bg-slate-800 rounded-lg p-2">${t("lbl_hour")}<br/><b class="text-emerald-300">${rupiah(p.price_hourly)}</b></div>
        <div class="bg-slate-800 rounded-lg p-2">${t("lbl_day")}<br/><b class="text-emerald-300">${rupiah(p.price_daily)}</b></div>
        <div class="bg-slate-800 rounded-lg p-2">${t("lbl_week")}<br/><b class="text-emerald-300">${rupiah(p.price_weekly)}</b></div>
        <div class="bg-slate-800 rounded-lg p-2">${t("lbl_month")}<br/><b class="text-emerald-300">${rupiah(p.price_monthly)}</b></div>
      </div>
      <button ${p.status !== "available" ? "disabled" : ""} onclick="openOrder('${p.id}')"
        class="mt-4 py-3 rounded-xl font-bold ${p.status === "available" ? "bg-emerald-600 hover:bg-emerald-500" : "bg-slate-800 text-slate-500"}">
        ${p.status === "available" ? t("btn_rent_now") : t("btn_unavailable")}
      </button>
    </div>`).join("");
}

function renderPlanOptions() {
  const sel = $("#orderPlan");
  sel.innerHTML = landing.plans.map((p) => `<option value="${p.code}">${esc(p.name)} (${p.duration_hours} jam)</option>`).join("");
  updateTotal();
}
function priceFor(p, code) {
  if (code === "HOURLY") return p.price_hourly;
  if (code === "WEEKLY") return p.price_weekly;
  if (code === "MONTHLY") return p.price_monthly;
  return p.price_daily;
}
function updateTotal() {
  if (!landing.orderPc) return;
  $("#orderTotal").textContent = t("est_total") + rupiah(priceFor(landing.orderPc, $("#orderPlan").value)) + t("est_note");
}

function openAuth() { $("#authMsg").textContent = ""; $("#authModal").showModal(); }
window.openOrder = function (id) {
  if (!state.me) { openAuth(); toast(t("msg_login_first")); return; }
  landing.orderPc = landing.pcs.find((x) => x.id === id);
  if (!landing.orderPc) return;
  $("#orderPC").innerHTML = `<b>${esc(landing.orderPc.name)}</b> <span class="mono text-xs">${esc(landing.orderPc.code)}</span><br/><span class="text-xs">${esc(landing.orderPc.cpu)} • ${landing.orderPc.ram_gb}GB • ${esc(landing.orderPc.gpu)}</span>`;
  $("#orderMsg").textContent = "";
  updateTotal();
  $("#orderModal").showModal();
};

function afterAuthGo() {
  // admin -> /admin, user -> /app
  location.href = isAdminRole(state.me.role) ? "/admin" : "/app";
}

$("#btnLogin").onclick = openAuth;
$("#btnLogout").onclick = async () => { await api("/api/auth/logout", { method: "POST" }); state.me = null; location.reload(); };
$("#btnRefresh").onclick = loadPublic;
$("#tabLogin").onclick = () => { $("#loginForm").classList.remove("hidden"); $("#regForm").classList.add("hidden"); $("#tabLogin").className = "py-2 rounded-lg bg-emerald-600 font-bold"; $("#tabReg").className = "py-2 rounded-lg bg-slate-800"; };
$("#tabReg").onclick = () => { $("#regForm").classList.remove("hidden"); $("#loginForm").classList.add("hidden"); $("#tabReg").className = "py-2 rounded-lg bg-emerald-600 font-bold"; $("#tabLogin").className = "py-2 rounded-lg bg-slate-800"; };
$("#doLogin").onclick = async () => {
  const r = await api("/api/auth/login", { method: "POST", body: JSON.stringify({ username: $("#liUser").value.trim(), password: $("#liPass").value }) });
  $("#authMsg").textContent = r.message || "";
  if (r.ok) { await loadMe(); $("#authModal").close(); toast(t("btn_welcome") + state.me.username); afterAuthGo(); }
};
$("#doReg").onclick = async () => {
  const r = await api("/api/auth/register", { method: "POST", body: JSON.stringify({ username: $("#rgUser").value.trim(), email: $("#rgEmail").value.trim(), fullName: $("#rgName").value, waNumber: $("#rgWA").value, password: $("#rgPass").value }) });
  $("#authMsg").textContent = r.message || "";
  if (r.ok) { await loadMe(); $("#authModal").close(); toast(t("acc_created")); location.href = "/app"; }
};
$("#orderPlan").onchange = updateTotal;
$("#doOrder").onclick = async () => {
  const r = await api("/api/orders", { method: "POST", body: JSON.stringify({ pcId: landing.orderPc.id, planCode: $("#orderPlan").value, voucherCode: $("#orderVoucher").value.trim(), paymentMethod: $("#orderPay").value, note: $("#orderNote").value }) });
  $("#orderMsg").textContent = r.message || "";
  if (r.ok) { $("#orderModal").close(); toast(t("order_done") + r.code); location.href = "/app"; }
};

(async () => {
  await loadPublic();
  await loadMe();
  const logged = !!state.me;
  $("#btnLogin").classList.toggle("hidden", logged);
  $("#btnLogout").classList.toggle("hidden", !logged);
  $("#navUser").textContent = logged ? `${state.me.username} (${state.me.role})` : "";
  const bd = $("#btnDash");
  if (bd) { bd.classList.toggle("hidden", !logged); bd.href = isAdminRole(state.me?.role) ? "/admin" : "/app"; }
  const ba = $("#btnAdminNav");
  if (ba) ba.classList.toggle("hidden", !(logged && isAdminRole(state.me.role)));
})();
