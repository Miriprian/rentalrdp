/* rentalrdp.com — landing pages (/, /katalog, /cara, /faq) : auth modal + katalog + order */
const landing = { pcs: [], plans: [], settings: {}, orderPc: null };

async function loadPublic() {
  const [pcs, plans, settings] = await Promise.all([api("/api/public/pcs"), api("/api/public/plans"), api("/api/public/settings")]);
  landing.pcs = pcs.data || [];
  landing.plans = plans.data || [];
  landing.settings = settings.data || {};

  const stat = $("#statUnits");
  if (stat) stat.textContent = landing.pcs.length || "—";

  const nb = $("#noticeBox");
  if (nb) nb.textContent = landing.settings.notice || "";

  const wa = (landing.settings.wa_admin || "").replace(/\D/g, "");
  const hw = $("#heroWA");
  if (hw && wa) hw.href = `https://wa.me/${wa}?text=${encodeURIComponent("Halo rentalrdp.com, saya mau tanya sewa PC bare metal")}`;

  const grid = $("#pcGrid");
  if (grid) {
    // home (/): preview 3 unit terbaru; /katalog: semua unit
    const isCatalog = location.pathname.startsWith("/katalog");
    renderPcs(isCatalog ? landing.pcs : landing.pcs.slice(0, 3));
  }

  const plan = $("#orderPlan");
  if (plan) {
    renderPlanOptions();
    const pi = $("#payInfo");
    if (pi) pi.innerHTML = `<b>Bayar ke:</b><br/>QRIS: ${esc(landing.settings.qris_text || "-")}<br/>${esc(landing.settings.payment_bca || "")}`;
  }
}

function renderPcs(list) {
  const g = $("#pcGrid");
  const isCatalog = location.pathname.startsWith("/katalog");
  if (!list.length) { g.innerHTML = `<div class="col-12"><div class="card"><div class="card-body text-secondary">Belum ada unit.</div></div></div>`; return; }
  g.innerHTML = list.map((p) => `
    <div class="col-md-6 col-lg-4">
      <div class="card h-100">
        <div class="card-body d-flex flex-column">
          <div class="d-flex align-items-center gap-2 mb-1">
            <span class="mono small text-secondary">${esc(p.code)}</span>
            <span class="ms-auto">${statusBadge(p.status)}</span>
          </div>
          <div class="fw-bold fs-5">${esc(p.name)}</div>
          <div class="small text-secondary">📍 ${esc(p.location)} • ${esc(p.os)} • <span class="text-success fw-bold">BARE METAL</span></div>
          ${p.motherboard ? `<div class="small text-secondary mt-1">🖥️ ${esc(p.motherboard)}</div>` : ""}
          <div class="row g-1 mt-3 small text-secondary">
            <div class="col-6">🧠 ${esc(p.cpu)}</div><div class="col-6">🎮 ${esc(p.gpu)}</div>
            <div class="col-6">💾 ${p.ram_gb}GB RAM</div><div class="col-6">🗄️ ${p.storage_gb}GB ${esc(p.storage_type)}</div>
          </div>
          ${hwDetailHtml(p)}
          <p class="small text-secondary mt-2 mb-2">${esc(p.description || "")}</p>
          <div class="row g-2 mt-1 small">
            <div class="col-6"><div class="bg-soft rounded-3 p-2 border">/jam<br/><b class="text-success">${rupiah(p.price_hourly)}</b></div></div>
            <div class="col-6"><div class="bg-soft rounded-3 p-2 border">/hari<br/><b class="text-success">${rupiah(p.price_daily)}</b></div></div>
            <div class="col-6"><div class="bg-soft rounded-3 p-2 border">/minggu<br/><b class="text-success">${rupiah(p.price_weekly)}</b></div></div>
            <div class="col-6"><div class="bg-soft rounded-3 p-2 border">/bulan<br/><b class="text-success">${rupiah(p.price_monthly)}</b></div></div>
          </div>
          ${isCatalog
            ? `<button ${p.status !== "available" ? "disabled" : ""} onclick="openOrder('${p.id}')"
                class="btn mt-4 w-100 fw-bold ${p.status === "available" ? "btn-success" : "btn-secondary disabled"}">
                ${p.status === "available" ? "Sewa Sekarang →" : "Tidak Tersedia"}</button>`
            : `<a href="/katalog" class="btn btn-outline-success mt-4 w-100 fw-bold">Lihat Detail & Sewa →</a>`}
        </div>
      </div>
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
  $("#orderTotal").textContent = "Estimasi: " + rupiah(priceFor(landing.orderPc, $("#orderPlan").value)) + " (diskon voucher dihitung server)";
}

function openAuth() { $("#authMsg").textContent = ""; openModal("authModal"); }
window.openOrder = function (id) {
  if (!state.me) { openAuth(); toast("Login dulu untuk sewa"); return; }
  landing.orderPc = landing.pcs.find((x) => x.id === id);
  if (!landing.orderPc) return;
  $("#orderPC").innerHTML = `<b>${esc(landing.orderPc.name)}</b> <span class="mono small text-secondary">${esc(landing.orderPc.code)}</span><br/><span class="small text-secondary">${esc(landing.orderPc.cpu)} • ${landing.orderPc.ram_gb}GB • ${esc(landing.orderPc.gpu)}</span>`;
  $("#orderMsg").textContent = "";
  updateTotal();
  openModal("orderModal");
};

function afterAuthGo() {
  location.href = isAdminRole(state.me.role) ? "/admin" : "/app";
}

function setAuthTab(which) {
  $("#loginForm").classList.toggle("hidden", which !== "login");
  $("#regForm").classList.toggle("hidden", which !== "reg");
  $("#tabLogin").classList.toggle("active", which === "login");
  $("#tabLogin").classList.toggle("btn-primary", which === "login");
  $("#tabReg").classList.toggle("active", which === "reg");
  $("#tabReg").classList.toggle("btn-primary", which === "reg");
}
function bindAuth(showAuthMsg) {
  const loginBtn = $("#btnLogin");
  if (loginBtn && !loginBtn.hasAttribute("data-bs-toggle")) {
    loginBtn.onclick = () => { if (showAuthMsg) $("#authMsg").textContent = ""; openModal("authModal"); };
  } else {
    // tombol Masuk pakai data-bs-toggle="modal" native (tahan dari gagalnya JS);
    // onclick hanya di-reset supaya tidak buka modal dua kali
    if (loginBtn) loginBtn.onclick = () => { if (showAuthMsg) $("#authMsg").textContent = ""; };
  }
  $("#btnLogout").onclick = async () => { await api("/api/auth/logout", { method: "POST" }); state.me = null; location.reload(); };
  if (showAuthMsg) {
    $("#tabLogin").onclick = () => setAuthTab("login");
    $("#tabReg").onclick = () => setAuthTab("reg");
    $("#doLogin").onclick = async () => {
      const r = await api("/api/auth/login", { method: "POST", body: JSON.stringify({ username: $("#liUser").value.trim(), password: $("#liPass").value }) });
      $("#authMsg").textContent = r.message || "";
      if (r.ok) { await loadMe(); closeModal("authModal"); toast("Selamat datang, " + state.me.username); afterAuthGo(); }
    };
    $("#doReg").onclick = async () => {
      const r = await api("/api/auth/register", { method: "POST", body: JSON.stringify({ username: $("#rgUser").value.trim(), email: $("#rgEmail").value.trim(), fullName: $("#rgName").value, waNumber: $("#rgWA").value, password: $("#rgPass").value }) });
      $("#authMsg").textContent = r.message || "";
      if (r.ok) { await loadMe(); closeModal("authModal"); toast("Akun dibuat. Selamat datang!"); location.href = "/app"; }
    };
  }
}
function bindOrder() {
  $("#orderPlan").onchange = updateTotal;
  $("#doOrder").onclick = async () => {
    const r = await api("/api/orders", { method: "POST", body: JSON.stringify({ pcId: landing.orderPc.id, planCode: $("#orderPlan").value, voucherCode: $("#orderVoucher").value.trim(), paymentMethod: $("#orderPay").value, note: $("#orderNote").value }) });
    $("#orderMsg").textContent = r.message || "";
    if (r.ok) { closeModal("orderModal"); toast("Order dibuat: " + r.code); location.href = "/app"; }
  };
}

(async () => {
  // 1) Bind SEMUA interaksi dulu (sinkron) — tombol wajib hidup meski API error
  bindAuth(!!$("#authMsg"));
  const refresh = $("#btnRefresh");
  if (refresh) refresh.onclick = loadPublic;
  if ($("#orderModal")) bindOrder();

  // 2) Muat data publik (jangan sampai error mematikan tombol)
  try {
    if ($("#pcGrid")) await loadPublic();
  } catch (e) { console.error("loadPublic:", e); }

  // 3) Status login / navbar
  try { await loadMe(); } catch (e) { console.error("loadMe:", e); }
  const logged = !!state.me;
  $("#btnLogin").classList.toggle("hidden", logged);
  $("#btnLogout").classList.toggle("hidden", !logged);
  const nu = $("#navUser");
  if (nu) nu.textContent = logged ? `${state.me.username} (${state.me.role})` : "";
  const bd = $("#btnDash");
  if (bd) { bd.classList.toggle("hidden", !logged); bd.href = isAdminRole(state.me?.role) ? "/admin" : "/app"; }
  const ba = $("#btnAdminNav");
  if (ba) ba.classList.toggle("hidden", !(logged && isAdminRole(state.me?.role)));
})();

// expose untuk inline handler (katalog)
window.renderLandingNav = null;