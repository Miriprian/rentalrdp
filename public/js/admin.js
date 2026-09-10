/* Rental PC by Miriprian — panel admin (/admin): order, PC, rental, user, voucher, settings, audit */
let tab = "orders";

/* ── status chip (tanpa emoji, palet minimal) ─────────────────────────── */
const adminOrderStatusChip = (s) => {
  const m = {
    pending: ["amber", t("order_pending")],
    waiting_verification: ["amber", t("order_waiting")],
    paid: ["emerald", t("order_paid")],
    active: ["emerald", t("order_active")],
    rejected: ["red", t("order_rejected")],
    expired: ["slate", t("order_expired")],
    completed: ["slate", t("order_completed")],
    cancelled: ["slate", t("order_cancelled")],
  };
  const [v, label] = m[s] || ["slate", s || "—"];
  return chip(label, v);
};
const adminRentalStatusChip = (s) => {
  const m = { active: ["emerald", t("rental_active")], expired: ["slate", t("rental_expired")], terminated: ["red", t("rental_terminated")] };
  const [v, label] = m[s] || ["slate", s || "—"];
  return chip(label, v);
};
const lab = (s) => `<span class="lab">${esc(s)}</span>`;
const pulseChip = (text, variant) => chip(text, variant).replace('class="chip', 'class="chip pulse');

/* ── mesin live (auto-refresh per tab, tanpa refresh manual) ───────────── */
const LIVE = { orders: 5000, pcs: 10000, rentals: 5000, rentacc: 2000 };
const live = { running: true, timer: null, keys: {} };
const sig = (v) => JSON.stringify(v);
let accByPc = new Map();

function refreshAccMap(arr) {
  accByPc = new Map();
  for (const a of arr || []) {
    const k = a.pc_id || a.pc_code || "";
    if (!k) continue;
    const cur = accByPc.get(k);
    if (!cur || new Date(a.created_at) > new Date(cur.created_at)) accByPc.set(k, a);
  }
}

function paintLive() {
  const el = $("#liveInd");
  if (!el) return;
  const on = live.running;
  el.innerHTML = `<span class="dot ${on ? "dot-on" : "dot-off"}"></span><span class="font-mono text-[11px] font-bold tracking-widest">${on ? t("lbl_live") : t("lbl_paused")}</span>`;
  el.title = on ? t("tt_live_on") : t("tt_live_off");
}
window.toggleLive = function () {
  live.running = !live.running;
  if (live.running) schedule();
  else clearTimeout(live.timer);
  paintLive();
};
function schedule() {
  clearTimeout(live.timer);
  if (!live.running) return;
  const iv = LIVE[tab];
  if (!iv) return;
  live.timer = setTimeout(liveTick, iv);
}
async function liveTick() {
  try {
    if (tab === "orders") await liveOrders();
    else if (tab === "pcs") await livePcs();
    else if (tab === "rentals") await liveRentals();
    else if (tab === "rentacc") await liveRentAcc();
  } catch (_) {}
  schedule();
}

/* ── navigasi ─────────────────────────────────────────────────────────── */
function renderTabs() {
  const tabs = [["orders", t("tab_incoming")], ["pcs", t("tab_pcs")], ["rentals", t("tab_active_rentals")], ["rentacc", t("tab_rent_acc")], ["users", t("tab_users")], ["vouchers", t("tab_vouchers")], ["settings", t("tab_settings")], ["audit", t("tab_audit")], ["akun", t("tab_akun")]];
  if (!tabs.find((t) => t[0] === tab)) tab = "orders";
  $("#dashTabs").innerHTML = tabs.map(([k, l]) => `<button onclick="setTab('${k}')" class="tab ${tab === k ? "tab-on" : ""}">${l}</button>`).join("");
}
window.setTab = function (k) {
  tab = k;
  renderTabs();
  renderBody();
  schedule();
};

async function renderBody() {
  const b = $("#dashBody");
  b.innerHTML = `<div class="text-sm text-slate-400">${t("loading")}</div>`;
  try {
    if (tab === "orders") b.innerHTML = await adminOrdersHtml();
    else if (tab === "pcs") b.innerHTML = await adminPcsHtml();
    else if (tab === "rentals") b.innerHTML = await adminRentalsHtml();
    else if (tab === "rentacc") b.innerHTML = await adminRentAccHtml();
    else if (tab === "users") b.innerHTML = await adminUsersHtml();
    else if (tab === "vouchers") b.innerHTML = await adminVouchersHtml();
    else if (tab === "settings") b.innerHTML = await adminSettingsHtml();
    else if (tab === "audit") b.innerHTML = await adminAuditHtml();
    else b.innerHTML = akunHtml();
  } catch (e) { b.innerHTML = `<div class="text-red-300 text-sm">${t("load_fail")}${esc(e.message)}</div>`; }
}

/* ── tab ORDERS ───────────────────────────────────────────────────────── */
function statCardsHtml(st) {
  const stats = [
    ["Users", st.users ?? 0],
    ["PC", st.pcs ?? 0],
    ["Pending", st.pendingOrders ?? 0],
    ["Aktif", st.activeRentals ?? 0],
    ["Revenue", rupiah(st.revenue ?? 0)],
  ].map(([k, v]) => `<div class="stat"><div class="k">${k}</div><div class="v">${v}</div></div>`).join("");
  return `<div class="grid grid-cols-2 md:grid-cols-5 gap-3 mb-5" id="statGrid">${stats}</div>`;
}
function ordersListHtml(rows) {
  const inner = rows.length ? rows.map((o) => `
    <div class="card card-hover rounded-2xl p-5 text-sm">
      <div class="flex flex-wrap gap-2 items-center">
        <b class="mono text-slate-200">${esc(o.code)}</b>
        ${adminOrderStatusChip(o.status)}
        <span class="ml-auto font-extrabold text-lg text-slate-200">${rupiah(o.total_idr)}</span>
      </div>
      <div class="text-slate-300 mt-2.5 text-xs grid sm:grid-cols-2 gap-x-4 gap-y-1">
        <div>${lab(t("lbl_tenant"))} ${esc(o.username)} <span class="text-slate-500">(${esc(o.wa_number || "-")})</span></div>
        <div>${lab("PC")} <span class="mono">${esc(o.pc_code)}</span> • ${esc(o.plan_code)} • ${o.duration_hours}${t("hours")} • ${t("via")}${esc(o.payment_method)}</div>
        ${o.created_at ? `<div class="sm:col-span-2">${lab(t("lbl_created"))} ${new Date(o.created_at).toLocaleString("id-ID")}</div>` : ""}
      </div>
      <div class="text-xs mt-2">${lab(t("proof_label"))} ${o.payment_proof ? `<b class="mono text-slate-200">${esc(o.payment_proof)}</b>` : `<span class="text-slate-500">${t("no_proof")}</span>`}</div>
      ${o.note ? `<div class="text-xs text-slate-400 mt-1">${lab(t("lbl_note"))} ${esc(o.note)}</div>` : ""}
      ${["pending", "waiting_verification", "paid"].includes(o.status) ? `
        <div class="flex flex-wrap gap-2 mt-4">
          <button onclick="approveOrder('${o.id}')" class="btn btn-primary btn-sm">${t("btn_approve")}</button>
          <button onclick="rejectOrder('${o.id}')" class="btn btn-danger btn-sm">${t("btn_reject")}</button>
        </div>` : ""}
    </div>`).join("") : `<div class="card rounded-2xl p-8 text-sm text-slate-400 text-center">${t("empty_orders_admin")}</div>`;
  return `<div class="grid gap-4" id="ordersList">${inner}</div>`;
}
function orderKey(o) { return o.id + ":" + o.status + ":" + (o.updated_at || o.created_at); }
function ordersKeyOf(rows) { return sig(rows.map(orderKey)); }
async function adminOrdersHtml() {
  const [s, r] = await Promise.all([api("/api/admin/stats"), api("/api/admin/orders")]);
  const rows = r.data || [];
  live.keys.orders = ordersKeyOf(rows);
  return statCardsHtml(s.data || {}) + ordersListHtml(rows);
}
async function liveOrders() {
  const [s, r] = await Promise.all([api("/api/admin/stats"), api("/api/admin/orders")]);
  const rows = r.data || [];
  const g = $("#statGrid");
  if (!g) return;
  g.outerHTML = statCardsHtml(s.data || {});
  const key = ordersKeyOf(rows);
  if (key !== live.keys.orders) {
    live.keys.orders = key;
    const l = $("#ordersList");
    if (l) l.outerHTML = ordersListHtml(rows);
  }
}

/* ── tab PCS (telemetri agent live, input dibiarkan utuh) ─────────────── */
// Strip telemetri agent (live): status online + last seen + kecepatan internet + tamper.
function agentLiveHtml(p) {
  const on = agentOnline(p);
  const parts = [];
  parts.push(`<span class="inline-flex items-center gap-1.5">${agentDotHtml(p)}</span>`);
  parts.push(`<span class="text-xs text-slate-400">${t("last_seen")}${ago(p.last_seen_at)}</span>`);
  const dl = Number(p.net_download_mbps || 0), ul = Number(p.net_upload_mbps || 0), ping = Number(p.net_ping_ms || 0);
  if (dl || ul) {
    parts.push(chip(t("lbl_net") + " " + t("net_speed", { down: Math.round(dl), up: Math.round(ul) }), on ? "emerald" : "slate"));
    if (ping) parts.push(chip(t("net_ping", { ping }), "slate"));
  }
  if (p.last_tamper_msg) parts.push(chip(t("tamper_badge"), "red"));
  return `<div class="flex flex-wrap items-center gap-3 mt-3 pt-3 border-t border-slate-800">${parts.join("")}</div>`;
}
function pcBadgesHtml(p) {
  let h = statusBadge(p.status);
  if (!p.last_seen_at) h += chip(t("waiting_agent"), "slate");
  else h += (p.is_active ? chip(t("published"), "emerald") : chip(t("not_published"), "amber"));
  return h;
}
function pcTaskHtml(p) {
  const a = accByPc.get(p.id);
  if (!a) return "";
  if (a.task_status === "done") return "";
  if (a.task_status === "failed")
    return `<div class="mt-2 flex flex-wrap items-center gap-1.5">${chip(t("task_failed"), "red")}<span class="text-xs text-red-300">${esc(t("task_fail_hint"))}</span></div>`;
  const st = a.task_status === "claimed" ? t("task_claimed") : t("task_pending");
  const hint = agentOnline(p) ? t("task_pending_on") : t("task_pending_off");
  return `<div class="mt-2 flex flex-wrap items-center gap-1.5">${pulseChip(st, a.task_status === "claimed" ? "amber" : "slate")}<span class="text-xs text-slate-400">${hint}</span></div>`;
}
let agentSetupHtml = "";
function pcCardHtml(p) {
  return `<div class="card card-hover rounded-2xl p-5 text-sm" data-pcid="${p.id}">
    <div class="flex flex-wrap gap-2 items-center">
      <b class="mono text-lg text-slate-200">${esc(p.code)}</b>
      <span data-badges>${pcBadgesHtml(p)}</span>
      <span class="ml-auto text-xs text-slate-400">${esc(p.ip_public || "-")}</span>
    </div>
    <div data-live>${agentLiveHtml(p)}</div>
    <div data-task>${pcTaskHtml(p)}</div>
    ${p.last_tamper_msg ? `<div class="mt-2 text-xs text-red-300">${t("tamper_note")} ${esc(String(p.last_tamper_msg).slice(0, 140))}</div>` : ""}
    <div data-spek>${p.cpu ? specHtml(p) : `<div class="mt-3 text-slate-300">${esc(p.name)} ${t("spek_wait")}</div>`}</div>
    <div class="flex flex-wrap gap-2 mt-4">
      <select id="st-${p.id}" class="input !w-auto !py-2 text-xs"><option ${p.status === "available" ? "selected" : ""}>available</option><option ${p.status === "rented" ? "selected" : ""}>rented</option><option ${p.status === "maintenance" ? "selected" : ""}>maintenance</option><option ${p.status === "offline" ? "selected" : ""}>offline</option></select>
      <input id="ip-${p.id}" value="${esc(p.ip_public || "")}" placeholder="IP publik" class="input !w-36 !py-2 text-xs"/>
      <input id="pd-${p.id}" type="number" value="${p.price_daily}" placeholder="${esc(t("ph_price_day"))}" title="${esc(t("tt_price_day"))}" class="input !w-28 !py-2 text-xs"/>
      <input id="pm-${p.id}" type="number" value="${p.price_monthly}" placeholder="${esc(t("ph_price_month"))}" title="${esc(t("tt_price_month"))}" class="input !w-28 !py-2 text-xs"/>
      <button onclick="savePc('${p.id}')" class="btn btn-ghost btn-sm">${t("btn_save")}</button>
      ${p.last_seen_at && !p.is_active ? `<button onclick="publishPc('${p.id}')" class="btn btn-primary btn-sm">${t("btn_publish")}</button>` : ""}
      ${p.is_active ? `<button onclick="unpublishPc('${p.id}')" class="btn btn-ghost btn-sm">${t("btn_unpublish")}</button>` : ""}
      <button onclick="regenToken('${p.id}')" class="btn btn-ghost btn-sm">${t("btn_token")}</button>
      <button onclick="mkRentUser('${p.id}')" class="btn btn-primary btn-sm">${t("btn_mk_manual")}</button>
      <button onclick="rmRentUser('${p.id}','${esc(p.code)}')" class="btn btn-danger btn-sm">${t("btn_rm_manual")}</button>
      <button onclick="restartPc('${p.id}')" class="btn btn-ghost btn-sm">${t("btn_restart")}</button>
      <button onclick="delPc('${p.id}')" class="btn btn-danger btn-sm">${t("btn_delete")}</button>
    </div>
    <div class="text-xs text-slate-500 mt-3 flex flex-wrap gap-x-3 gap-y-1">
      <span>${t("price_day_1")}<b class="text-slate-200">${rupiah(p.price_hourly)}${t("price_suffix")}</b></span>
      <span>${rupiah(p.price_daily)}/hari • ${rupiah(p.price_weekly)}/minggu • ${rupiah(p.price_monthly)}/bulan</span>
    </div>
  </div>`;
}
async function adminPcsHtml() {
  const [pr, ar] = await Promise.all([api("/api/pcs"), api("/api/admin/rent-accounts")]);
  const rows = pr.data || [];
  refreshAccMap(ar.data);
  return `
    <div class="card rounded-2xl p-5 mb-5 text-sm flex flex-wrap items-center gap-3">
      <div class="flex-1 min-w-[220px]">
        <b class="text-slate-200">${t("add_pc")}</b>
        <div class="text-xs text-slate-400 mt-1">${t("pc_hint")}</div>
      </div>
      <button onclick="createPc()" class="btn btn-primary">${t("btn_add_pc")}</button>
    </div>
    <div id="agentSetup">${agentSetupHtml}</div>
    <div class="grid gap-4" id="pcList">${rows.map(pcCardHtml).join("")}</div>`;
}
async function livePcs() {
  const [pr, ar] = await Promise.all([api("/api/pcs"), api("/api/admin/rent-accounts")]);
  const rows = pr.data || [];
  refreshAccMap(ar.data);
  let needFull = false;
  const seen = new Set();
  for (const p of rows) {
    seen.add(p.id);
    const card = document.querySelector(`[data-pcid="${p.id}"]`);
    if (!card) { needFull = true; break; }
    const b = card.querySelector("[data-badges]");
    const nh = pcBadgesHtml(p);
    if (b && b.innerHTML !== nh) b.innerHTML = nh;
    const lv = card.querySelector("[data-live]");
    const nl = agentLiveHtml(p);
    if (lv && lv.innerHTML !== nl) lv.innerHTML = nl;
    const tk = card.querySelector("[data-task]");
    const nt = pcTaskHtml(p);
    if (tk && tk.innerHTML !== nt) tk.innerHTML = nt;
  }
  const count = document.querySelectorAll("[data-pcid]").length;
  if (needFull || seen.size !== rows.length || count !== rows.length) await renderBody();
}
window.createPc = async function () {
  if (!confirm(t("confirm_create_pc"))) return;
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
  if (!daily && !monthly) { toast(t("need_price")); return; }
  const r = await api(`/api/pcs/${id}`, { method: "PATCH", body: JSON.stringify({
    isActive: true, status: "available",
    ipPublic: document.getElementById("ip-" + id).value,
    priceDaily: daily, priceWeekly: Math.round(daily * 5), priceMonthly: monthly,
  }) });
  toast(r.ok ? t("published_ok") : r.message); renderBody();
};
window.unpublishPc = async function (id) {
  if (!confirm(t("confirm_unpublish"))) return;
  const r = await api(`/api/pcs/${id}`, { method: "PATCH", body: JSON.stringify({ isActive: false }) });
  toast(r.message || "OK"); renderBody();
};
window.regenToken = async function (id) {
  const r = await api(`/api/pcs/${id}/regen-token`, { method: "POST" });
  if (r.ok) showAgentSetup(r.code || "", r.agentToken);
  else toast(r.message || "Gagal");
};
window.closeAgentSetup = function () { agentSetupHtml = ""; renderBody(); };
window.copyAgentToken = function (tkn) {
  navigator.clipboard?.writeText(tkn).then(() => toast(t("token_copied"))).catch(() => prompt(t("token_manual"), tkn));
};
async function agentDownload() {
  try {
    const j = await (await fetch("https://api.github.com/repos/Miriprian/rentalrdp/releases/latest")).json();
    const a = (j.assets || []).find((x) => /^windows-rentalrdp-agent-v.*\.exe$/i.test(x.name));
    if (a) return { url: a.browser_download_url, name: a.name };
  } catch {}
  return { url: "https://github.com/Miriprian/rentalrdp/releases/latest", name: "windows-rentalrdp-agent.exe" };
}
window.showAgentSetup = async function (code, token) {
  const server = location.origin;
  const dl = await agentDownload();
  agentSetupHtml = `
    <div class="card rounded-2xl p-5 mb-5 border border-emerald-500/40 text-sm">
      <div class="flex flex-wrap items-center gap-2 mb-4">
        <b class="text-slate-200">${t("setup_title", { code })}</b>
        <button onclick="closeAgentSetup()" class="ml-auto btn btn-ghost btn-sm">${t("btn_close")}</button>
      </div>
      <div class="grid md:grid-cols-2 gap-5">
        <div class="space-y-2 text-xs text-slate-300">
          <div class="font-bold text-slate-200">${t("setup_1")}</div>
          <a href="${dl.url}" download="${dl.name}" target="_blank" class="btn btn-primary btn-sm">${dl.name}</a>
          <div class="text-slate-400">${t("setup_1_list")}</div>
          <a href="/api/download/agent" class="text-slate-500 underline">${t("setup_1_alt")}</a>
          <div class="font-bold text-slate-200 pt-2">${t("setup_2")}</div>
          <div>${t("setup_2_list")}<b class="text-slate-200">${esc(server)}</b></div>
        </div>
        <div class="space-y-2 text-xs text-slate-300">
          <div class="font-bold text-slate-200">${t("setup_3")}</div>
          <div class="mono bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 break-all text-slate-200">${esc(token)}</div>
          <button onclick="copyAgentToken('${esc(token)}')" class="btn btn-ghost btn-sm">${t("btn_copy_token")}</button>
          <div class="text-slate-400 pt-1">${t("setup_3_list")}</div>
          <div class="text-slate-400 pt-1">${t("setup_3_list2")}</div>
          <div class="font-bold text-slate-200 pt-2">${t("setup_4")}</div>
          <div>${t("setup_4_list")}</div>
        </div>
      </div>
    </div>`;
  renderBody();
};
window.delPc = async function (id) {
  if (!confirm(t("confirm_delete_pc"))) return;
  const r = await api(`/api/pcs/${id}`, { method: "DELETE" });
  toast(r.message || "OK"); renderBody();
};
window.mkRentUser = async function (id) {
  const r = await api(`/api/admin/pcs/${id}/rent-user`, { method: "POST" });
  if (r.ok && r.username) {
    alert(`${t("mk_ok")}\n\nUser : ${r.username}\nPass : ${r.password}\n\n${t("mk_note")}\n${t("mk_saved")}`);
    toast(t("mk_sent"));
    setTab("rentacc");
  } else toast(r.message || "Gagal");
};
window.rmRentUser = async function (id, code) {
  const u = prompt(`${t("rm_prompt")} (${code})`);
  if (!u || !u.trim()) return;
  const r = await api(`/api/admin/pcs/${id}/delete-user`, { method: "POST", body: JSON.stringify({ username: u.trim() }) });
  toast(r.message || "OK"); renderBody();
};
window.restartPc = async function (id) {
  if (!confirm(t("confirm_restart"))) return;
  const r = await api(`/api/admin/pcs/${id}/restart`, { method: "POST" });
  toast(r.message || "OK"); renderBody();
};

/* ── tab RENTALS ──────────────────────────────────────────────────────── */
function rentalsListHtml(rows) {
  const inner = rows.length ? rows.map((x) => `
    <div class="card card-hover rounded-2xl p-5 text-sm">
      <div class="flex flex-wrap gap-2 items-center">
        <b class="mono text-lg text-slate-200">${esc(x.pc_code)}</b>
        ${adminRentalStatusChip(x.status)}
        <span class="ml-auto text-xs text-slate-400">${lab(t("lbl_tenant"))} ${esc(x.username)} • ${lab(t("upto"))} <b class="text-slate-200">${new Date(x.end_at).toLocaleString("id-ID")}</b></span>
      </div>
      ${x.status === "active" ? `<div class="mt-4"><button onclick="terminateRental('${x.id}')" class="btn btn-danger btn-sm">${t("btn_terminate")}</button></div>` : ""}
    </div>`).join("") : `<div class="card rounded-2xl p-8 text-sm text-slate-400 text-center">${t("empty_rental_admin")}</div>`;
  return `<div class="grid gap-4" id="rentalsList">${inner}</div>`;
}
function rentalsKeyOf(rows) { return sig(rows.map((r) => r.id + ":" + r.status)); }
async function adminRentalsHtml() {
  const r = await api("/api/admin/rentals");
  const rows = r.data || [];
  live.keys.rentals = rentalsKeyOf(rows);
  return rentalsListHtml(rows);
}
async function liveRentals() {
  const r = await api("/api/admin/rentals");
  const rows = r.data || [];
  const key = rentalsKeyOf(rows);
  if (key !== live.keys.rentals) {
    live.keys.rentals = key;
    const l = $("#rentalsList");
    if (l) l.outerHTML = rentalsListHtml(rows);
  }
}
window.terminateRental = async function (id) {
  if (!confirm(t("confirm_terminate"))) return;
  const r = await api(`/api/admin/rentals/${id}/terminate`, { method: "POST" });
  toast(r.message || "OK"); renderBody();
};

/* ── tab AKUN RDP (live proses pembuatan akun) ───────────────────────── */
function taskBadge(status, result, pcStatus) {
  if (status === "done") return `<span class="inline-flex items-center gap-1.5">${chip(t("task_done"), "emerald")}</span>`;
  if (status === "failed") {
    const hint = String(result || "").includes("14 characters") ? t("task_fail_shortpass") : t("task_fail_hint");
    return `<span class="inline-flex flex-wrap items-center gap-1.5">${chip(t("task_failed"), "red")}<span class="text-xs text-red-300">${esc(hint)}</span></span>`;
  }
  const off = pcStatus === "offline" || !pcStatus;
  const st = status === "claimed" ? t("task_claimed") : t("task_pending");
  return `<span class="inline-flex flex-wrap items-center gap-1.5">${pulseChip(st, status === "claimed" ? "amber" : "slate")}<span class="text-xs text-slate-400">${off ? t("task_pending_off") : t("task_pending_on")}</span></span>`;
}
function rentAccListHtml(rows) {
  const perPc = new Map();
  for (const a of rows) {
    const k = a.pc_id || a.pc_code || a.username;
    if (!perPc.has(k)) perPc.set(k, { active: null, deleted: null });
    const g = perPc.get(k);
    if (a.status === "active" && (!g.active || new Date(a.created_at) > new Date(g.active.created_at))) g.active = a;
    else if (a.status === "deleted" && (!g.deleted || new Date(a.created_at) > new Date(g.deleted.created_at))) g.deleted = a;
  }
  const groups = [...perPc.values()].filter((g) => g.active || g.deleted);
  const inner = groups.length ? groups.map((g) => {
    const a = g.active;
    let html = `<div class="card rounded-2xl p-5 text-sm flex flex-wrap gap-5">`;
    html += `<div class="flex-1 min-w-[260px]">`;
    if (a) {
      html += `<div class="flex flex-wrap gap-2 items-center"><b class="mono text-slate-200">${esc(a.username)}</b>
        ${chip(t("rental_active"), "emerald")}
        <span class="ml-auto text-xs text-slate-400">${esc(a.pc_code)} • ${new Date(a.created_at).toLocaleString("id-ID")}</span>
      </div>
      <div class="mono text-xs text-slate-300 mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
        <span class="text-slate-500">${t("host_local")}:</span><span>${esc(a.pc_ip_local || "-")}:${esc(a.pc_rdp_port || 3389)}</span>
        <span class="text-slate-500">${t("host_public")}:</span><span>${esc(a.pc_ip_public || "-")}:${esc(a.pc_rdp_port || 3389)}</span>
        <span class="text-slate-500">${t("user")}:</span><span>${esc(a.username)}</span>
        <span class="text-slate-500">${t("pass")}:</span><span class="text-emerald-300">${esc(a.password)}</span>
      </div>
      <div class="text-xs mt-2.5">${taskBadge(a.task_status, a.task_result, a.pc_status)}</div>
      <button onclick='copyAcc(${JSON.stringify(a.username)},${JSON.stringify(a.password || "")},${JSON.stringify((a.pc_ip_local || "-") + ":" + (a.pc_rdp_port || 3389))},${JSON.stringify((a.pc_ip_public || "-") + ":" + (a.pc_rdp_port || 3389))})' class="btn btn-ghost btn-sm mt-3">${t("copy_all")} ⧉</button>`;
    } else {
      html += `<div class="text-sm text-slate-500">${t("rent_acc_empty")}</div>`;
    }
    html += `</div>`;
    if (g.deleted) {
      const d = g.deleted;
      html += `<div class="border-l border-slate-700 pl-5 min-w-[240px] opacity-70">
        <div class="flex flex-wrap gap-2 items-center"><b class="mono text-slate-400">${esc(d.username)}</b>
          ${chip(t("rental_terminated"), "red")}
          <span class="ml-auto text-xs text-slate-500">${new Date(d.created_at).toLocaleString("id-ID")}</span>
        </div>
        <div class="mono text-xs text-slate-500 mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
          <span>${t("user")}:</span><span>${esc(d.username)}</span>
          <span>${t("pass")}:</span><span>${esc(d.password)}</span>
        </div>
        <div class="text-[11px] text-slate-500 mt-2">${t("rent_acc_prev")}</div>
      </div>`;
    }
    return html + `</div>`;
  }).join("") : `<div class="card rounded-2xl p-8 text-sm text-slate-400 text-center">${t("rent_acc_empty")}</div>`;
  return `<div class="card rounded-2xl p-4 mb-4 text-sm">${t("rent_acc_hint")}</div>
  <div class="grid gap-3" id="rentaccList">${inner}</div>`;
}
function rentAccKeyOf(rows) { return sig(rows.map((a) => a.id + ":" + (a.status || "") + ":" + (a.task_status || "") + ":" + (a.pc_status || ""))); }
async function adminRentAccHtml() {
  const r = await api("/api/admin/rent-accounts");
  const rows = r.data || [];
  live.keys.rentacc = rentAccKeyOf(rows);
  return rentAccListHtml(rows);
}
async function liveRentAcc() {
  const r = await api("/api/admin/rent-accounts");
  const rows = r.data || [];
  const key = rentAccKeyOf(rows);
  if (key !== live.keys.rentacc) {
    live.keys.rentacc = key;
    const l = $("#rentaccList");
    if (l) l.outerHTML = rentAccListHtml(rows);
  }
}
window.copyAcc = function (u, p, local, pub) {
  const txt = `${t("host_local")} : ${local}\n${t("host_public")} : ${pub}\n${t("user")} : ${u}\n${t("pass")} : ${p}`;
  navigator.clipboard?.writeText(txt).then(() => toast(t("token_copied"))).catch(() => prompt(t("token_manual"), txt));
};

/* ── tab ORDERS: aksi approve/reject ──────────────────────────────────── */
window.approveOrder = async function (id) {
  if (!confirm(t("confirm_approve"))) return;
  const r = await api(`/api/admin/orders/${id}/approve`, { method: "POST" });
  toast(r.message || "OK");
  if (r.ok && r.rdpPass) alert(`${t("rdp_created")}${r.rdpUser}${t("rdp_created_2")}${r.rdpPass}${t("rdp_created_3")}`);
  renderBody();
};
window.rejectOrder = async function (id) {
  if (!confirm(t("confirm_reject"))) return;
  const r = await api(`/api/admin/orders/${id}/reject`, { method: "POST" });
  toast(r.message || "OK"); renderBody();
};

/* ── tab USERS / VOUCHERS / SETTINGS / AUDIT ──────────────────────────── */
async function adminUsersHtml() {
  const r = await api("/api/admin/users");
  const rows = r.data || [];
  return `<div class="grid gap-3">` + rows.map((u) => `
    <div class="card card-hover rounded-2xl p-4 text-sm flex flex-wrap gap-3 items-center">
      <div class="flex items-center gap-2">
        <b>${esc(u.username)}</b><span class="chip chip-slate">${esc(u.role)}</span>
      </div>
      <span class="text-xs text-slate-400">${esc(u.email)} • ${esc(u.wa_number || "")}</span>
      <span class="ml-auto flex flex-wrap gap-2">
        <select id="role-${u.id}" class="input !w-auto !py-1.5 text-xs"><option ${u.role === "user" ? "selected" : ""}>user</option><option ${u.role === "admin" ? "selected" : ""}>admin</option><option ${u.role === "superadmin" ? "selected" : ""}>superadmin</option></select>
        <button onclick="saveUser('${u.id}')" class="btn btn-ghost btn-sm">${t("btn_save_user")}</button>
        <button onclick="resetPass('${u.id}')" class="btn btn-ghost btn-sm">${t("btn_reset_pw")}</button>
      </span>
    </div>`).join("") + `</div>`;
}
window.saveUser = async function (id) {
  const role = document.getElementById("role-" + id).value;
  const r = await api(`/api/admin/users/${id}`, { method: "PATCH", body: JSON.stringify({ role }) });
  toast(r.message || "OK"); renderBody();
};
window.resetPass = async function (id) {
  const np = prompt(t("ph_new_password"));
  if (!np) return;
  const r = await api(`/api/admin/users/${id}/reset-password`, { method: "POST", body: JSON.stringify({ newPassword: np }) });
  toast(r.message || "OK");
};

async function adminVouchersHtml() {
  const r = await api("/api/admin/vouchers");
  const rows = r.data || [];
  return `<div class="card rounded-2xl p-4 mb-4 text-sm flex gap-2 flex-wrap">
      <input id="vc" placeholder="${esc(t("ph_voucher_code"))}" class="input mono !w-40 !py-2 text-xs"/>
      <input id="vd" type="number" placeholder="${esc(t("ph_discount"))}" class="input !w-32 !py-2 text-xs"/>
      <button onclick="saveVoucher()" class="btn btn-primary btn-sm">${t("btn_save_voucher")}</button>
    </div>
    <div class="grid gap-3">` + rows.map((v) => `<div class="card rounded-xl p-4 text-sm mono flex flex-wrap gap-3">${esc(v.code)} — ${v.discount_percent}% (max ${rupiah(v.max_discount_idr)}) • ${v.used_count}/${v.quota}</div>`).join("") + `</div>`;
}
window.saveVoucher = async function () {
  const r = await api("/api/admin/vouchers", { method: "POST", body: JSON.stringify({ code: $("#vc").value, discountPercent: Number($("#vd").value || 10) }) });
  toast(r.message || "OK"); renderBody();
};

async function adminSettingsHtml() {
  const r = await api("/api/admin/settings");
  const s = r.data || {};
  const fields = ["site_name", "tagline", "wa_admin", "qris_text", "payment_bca", "notice"];
  return `<div class="card rounded-2xl p-5 text-sm space-y-4 max-w-2xl">` + fields.map((k) => `
    <div><label class="text-xs text-slate-400">${k}</label><textarea id="set-${k}" rows="2" class="input mt-1">${esc(s[k] || "")}</textarea></div>`).join("") + `
    <button onclick="saveSettings()" class="btn btn-primary">${t("btn_save_settings")}</button></div>`;
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
  return `<div class="grid gap-1 text-xs mono">` + rows.slice(0, 100).map((a) => `<div class="card rounded-lg p-2 flex flex-wrap gap-x-2"><span class="text-slate-400">${new Date(a.created_at).toLocaleString("id-ID")}</span>• <b>${esc(a.actor_name)}</b> • ${esc(a.action)} • <span class="text-slate-400">${esc(a.entity)}/${esc(a.entity_id)}</span></div>`).join("") + `</div>`;
}

/* ── init ─────────────────────────────────────────────────────────────── */
(async () => {
  await loadMe();
  navInit("admin");
  if (!state.me) {
    $("#dashWrap").innerHTML = loginCardHtml("/admin");
    return;
  }
  if (!isAdminRole(state.me.role)) {
    $("#dashWrap").innerHTML = `<div class="card rounded-2xl p-8 max-w-md mx-auto text-sm text-center space-y-3">
      <b class="text-lg">${t("denied_title")}</b>
      <p class="text-slate-400 text-xs">${t("denied_desc", { role: `<b>${esc(state.me.role)}</b>` })}</p>
      <a href="/app" class="btn btn-primary">${t("back_my_dash")}</a>
    </div>`;
    return;
  }
  $("#dashRole").textContent = `${t("login_as")}${state.me.username}${t("role")}${state.me.role}`;
  paintLive();
  renderTabs();
  renderBody();
  schedule();
})();