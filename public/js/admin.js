/* Rental PC by Miriprian — panel admin (/admin) : order, PC, rental, user, voucher, settings, audit */
let tab = "orders";

function renderTabs() {
  const tabs = [["orders", t("tab_incoming")], ["pcs", t("tab_pcs")], ["rentals", t("tab_active_rentals")], ["users", t("tab_users")], ["vouchers", t("tab_vouchers")], ["settings", t("tab_settings")], ["audit", t("tab_audit")], ["akun", t("tab_akun")]];
  if (!tabs.find((t) => t[0] === tab)) tab = "orders";
  $("#dashTabs").innerHTML = tabs.map(([k, l]) => `<button onclick="setTab('${k}')" class="px-4 py-2 rounded-lg ${tab === k ? "bg-emerald-600 font-bold" : "bg-slate-800"}">${l}</button>`).join("");
}
window.setTab = function (k) { tab = k; renderTabs(); renderBody(); };

async function renderBody() {
  const b = $("#dashBody");
  b.innerHTML = `<div class="text-sm text-slate-400">Memuat…</div>`;
  try {
    if (tab === "orders") b.innerHTML = await adminOrdersHtml();
    else if (tab === "pcs") b.innerHTML = await adminPcsHtml();
    else if (tab === "rentals") b.innerHTML = await adminRentalsHtml();
    else if (tab === "users") b.innerHTML = await adminUsersHtml();
    else if (tab === "vouchers") b.innerHTML = await adminVouchersHtml();
    else if (tab === "settings") b.innerHTML = await adminSettingsHtml();
    else if (tab === "audit") b.innerHTML = await adminAuditHtml();
    else b.innerHTML = akunHtml();
  } catch (e) { b.innerHTML = `<div class="text-red-300 text-sm">${t("load_fail")}${esc(e.message)}</div>`; }
}

async function adminOrdersHtml() {
  const s = await api("/api/admin/stats");
  const r = await api("/api/admin/orders");
  const rows = r.data || [];
  const st = s.data || {};
  return `
    <div class="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4 text-center text-xs">
      <div class="card rounded-xl p-3"><div class="text-xl font-extrabold">${st.users ?? 0}</div>Users</div>
      <div class="card rounded-xl p-3"><div class="text-xl font-extrabold">${st.pcs ?? 0}</div>PC</div>
      <div class="card rounded-xl p-3"><div class="text-xl font-extrabold text-amber-300">${st.pendingOrders ?? 0}</div>Pending</div>
      <div class="card rounded-xl p-3"><div class="text-xl font-extrabold text-emerald-300">${st.activeRentals ?? 0}</div>Aktif</div>
      <div class="card rounded-xl p-3"><div class="text-xl font-extrabold text-emerald-300">${rupiah(st.revenue ?? 0)}</div>Revenue</div>
    </div>
    <div class="grid gap-3">` + (rows.length ? rows.map((o) => `
      <div class="card rounded-xl p-4 text-sm">
        <div class="flex flex-wrap gap-2 items-center"><b class="mono">${esc(o.code)}</b><span class="text-xs px-2 py-1 rounded bg-slate-800">${esc(o.status)}</span><span class="ml-auto font-bold text-emerald-300">${rupiah(o.total_idr)}</span></div>
        <div class="text-slate-300 mt-1">👤 ${esc(o.username)} (${esc(o.wa_number || "-")}) • ${esc(o.pc_code)} • ${esc(o.plan_code)} • ${o.duration_hours}j • via ${esc(o.payment_method)}</div>
        ${o.payment_proof ? `<div class="text-xs mt-1">🧾 ${t("proof_label")}<b>${esc(o.payment_proof)}</b></div>` : `<div class="text-xs text-slate-500">${t("no_proof")}</div>`}
        ${o.note ? `<div class="text-xs text-slate-400">📝 ${esc(o.note)}</div>` : ""}
        <div class="flex gap-2 mt-3">
          <button onclick="approveOrder('${o.id}')" class="px-4 py-2 rounded-lg bg-emerald-600 text-xs font-bold">✅ ${t("btn_approve")}</button>
          <button onclick="rejectOrder('${o.id}')" class="px-4 py-2 rounded-lg bg-red-700 text-xs">${t("btn_reject")}</button>
        </div>
      </div>`).join("") : `<div class="card rounded-xl p-6 text-sm text-slate-400">${t("empty_orders_admin")}</div>`) + `</div>`;
}
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

let agentSetupHtml = "";

async function adminPcsHtml() {
  const r = await api("/api/pcs");
  const rows = r.data || [];
  return `
    <div class="card rounded-xl p-4 mb-4 text-sm">
      <div class="flex flex-wrap items-center gap-3">
        <b>${t("add_pc")}</b>
        <button onclick="createPc()" class="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 font-bold">${t("btn_add_pc")}</button>
      </div>
      <div class="text-xs text-slate-400 mt-2">${t("pc_hint")}</div>
    </div>
    <div id="agentSetup">${agentSetupHtml}</div>
    <div class="grid gap-3">` + rows.map((p) => `
      <div class="card rounded-xl p-4 text-sm">
        <div class="flex gap-2 items-center flex-wrap"><b class="mono">${esc(p.code)}</b> ${statusBadge(p.status)}
          ${!p.last_seen_at ? `<span class="text-[11px] px-2 py-1 rounded-full bg-slate-700 font-bold">${t("waiting_agent")}</span>` : (p.is_active ? `<span class="text-[11px] px-2 py-1 rounded-full bg-emerald-700 font-bold">${t("published")}</span>` : `<span class="text-[11px] px-2 py-1 rounded-full bg-amber-700 font-bold">${t("not_published")}</span>`)}
          <span class="ml-auto text-xs">${esc(p.ip_public || "-")} • ${t("last_seen")}${p.last_seen_at ? new Date(p.last_seen_at).toLocaleString("id-ID") : "-"}</span>
        </div>
        ${p.cpu ? `<div class="mt-1">${specHtml(p)}</div>` : `<div class="mt-1 text-slate-300">${esc(p.name)} ${t("spek_wait")}</div>`}
        <div class="flex flex-wrap gap-2 mt-3 text-xs">
          <select id="st-${p.id}" class="px-3 py-2 rounded-lg bg-slate-800"><option ${p.status === "available" ? "selected" : ""}>available</option><option ${p.status === "rented" ? "selected" : ""}>rented</option><option ${p.status === "maintenance" ? "selected" : ""}>maintenance</option><option ${p.status === "offline" ? "selected" : ""}>offline</option></select>
          <input id="ip-${p.id}" value="${esc(p.ip_public || "")}" placeholder="IP publik" class="px-3 py-2 rounded-lg bg-slate-800 border border-slate-700"/>
          <input id="pd-${p.id}" type="number" value="${p.price_daily}" placeholder="${esc(t("ph_price_day"))}" title="${esc(t("tt_price_day"))}" class="px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 w-28"/>
          <input id="pm-${p.id}" type="number" value="${p.price_monthly}" placeholder="${esc(t("ph_price_month"))}" title="${esc(t("tt_price_month"))}" class="px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 w-28"/>
          <button onclick="savePc('${p.id}')" class="px-4 py-2 rounded-lg bg-slate-700">${t("btn_save")}</button>
          ${p.last_seen_at && !p.is_active ? `<button onclick="publishPc('${p.id}')" class="px-4 py-2 rounded-lg bg-emerald-600 font-bold">${t("btn_publish")}</button>` : ""}
          ${p.is_active ? `<button onclick="unpublishPc('${p.id}')" class="px-4 py-2 rounded-lg bg-slate-700">${t("btn_unpublish")}</button>` : ""}
          <button onclick="regenToken('${p.id}')" class="px-4 py-2 rounded-lg bg-amber-700">${t("btn_token")}</button>
          <button onclick="delPc('${p.id}')" class="px-4 py-2 rounded-lg bg-red-800">${t("btn_delete")}</button>
        </div>
        <div class="text-xs text-slate-500 mt-1"><span class="md:inline-block pr-2">${t("price_day_1")}<b class="text-emerald-300">${rupiah(p.price_hourly)}${t("price_suffix")}</b></span><span class="md:inline-block">${rupiah(p.price_daily)}/hari • ${rupiah(p.price_weekly)}/minggu • ${rupiah(p.price_monthly)}/bulan</span></div>
      </div>`).join("") + `</div>`;
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
    <div class="card rounded-xl p-5 mb-4 border border-emerald-700 text-sm">
      <div class="flex flex-wrap items-center gap-2 mb-3">
        <b class="text-emerald-300">${t("setup_title", { code })}</b>
        <button onclick="closeAgentSetup()" class="ml-auto px-3 py-1 rounded bg-slate-800 text-xs">${t("btn_close")}</button>
      </div>
      <div class="grid md:grid-cols-2 gap-4">
        <div class="space-y-2 text-xs text-slate-300">
          <div class="font-bold text-slate-200">${t("setup_1")}</div>
          <a href="${dl.url}" download="${dl.name}" target="_blank" class="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 font-bold">⬇ ${dl.name}</a>
          <div class="text-slate-400">${t("setup_1_list")}</div>
          <a href="/api/download/agent" class="text-slate-500 underline">${t("setup_1_alt")}</a>
          <div class="font-bold text-slate-200 pt-2">${t("setup_2")}</div>
          <div>${t("setup_2_list")}<b class="text-emerald-300">${esc(server)}</b></div>
        </div>
        <div class="space-y-2 text-xs text-slate-300">
          <div class="font-bold text-slate-200">${t("setup_3")}</div>
          <div class="mono bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 break-all text-emerald-300">${esc(token)}</div>
          <button onclick="copyAgentToken('${esc(token)}')" class="px-4 py-2 rounded-lg bg-slate-700">${t("btn_copy_token")}</button>
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

async function adminRentalsHtml() {
  const r = await api("/api/admin/rentals");
  const rows = r.data || [];
  return `<div class="grid gap-3">` + (rows.length ? rows.map((x) => `
    <div class="card rounded-xl p-4 text-sm">
      <div class="flex gap-2 items-center"><b class="mono">${esc(x.pc_code)}</b><span class="text-xs px-2 py-1 rounded bg-slate-800">${esc(x.status)}</span><span class="ml-auto text-xs">👤 ${esc(x.username)} •${t("upto")}${new Date(x.end_at).toLocaleString("id-ID")}</span></div>
      ${x.status === "active" ? `<button onclick="terminateRental('${x.id}')" class="mt-3 px-4 py-2 rounded-lg bg-red-700 text-xs">${t("btn_terminate")}</button>` : ""}
    </div>`).join("") : t("empty_rental_admin")) + `</div>`;
}
window.terminateRental = async function (id) {
  if (!confirm(t("confirm_terminate"))) return;
  const r = await api(`/api/admin/rentals/${id}/terminate`, { method: "POST" });
  toast(r.message || "OK"); renderBody();
};

async function adminUsersHtml() {
  const r = await api("/api/admin/users");
  const rows = r.data || [];
  return `<div class="grid gap-2">` + rows.map((u) => `
    <div class="card rounded-xl p-4 text-sm flex flex-wrap gap-2 items-center">
      <b>${esc(u.username)}</b><span class="text-xs px-2 py-1 rounded bg-slate-800">${esc(u.role)}</span>
      <span class="text-xs text-slate-400">${esc(u.email)} • ${esc(u.wa_number || "")}</span>
      <span class="ml-auto flex gap-2">
        <select id="role-${u.id}" class="px-2 py-1 rounded bg-slate-800 text-xs"><option ${u.role === "user" ? "selected" : ""}>user</option><option ${u.role === "admin" ? "selected" : ""}>admin</option><option ${u.role === "superadmin" ? "selected" : ""}>superadmin</option></select>
        <button onclick="saveUser('${u.id}')" class="px-3 py-1 rounded bg-slate-700 text-xs">${t("btn_save_user")}</button>
        <button onclick="resetPass('${u.id}')" class="px-3 py-1 rounded bg-amber-700 text-xs">${t("btn_reset_pw")}</button>
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
  return `<div class="card rounded-xl p-4 mb-3 text-sm flex gap-2 flex-wrap">
      <input id="vc" placeholder="${esc(t("ph_voucher_code"))}" class="px-3 py-2 rounded bg-slate-800 mono"/>
      <input id="vd" type="number" placeholder="${esc(t("ph_discount"))}" class="px-3 py-2 rounded bg-slate-800"/>
      <button onclick="saveVoucher()" class="px-4 py-2 rounded bg-emerald-600 font-bold">${t("btn_save_voucher")}</button>
    </div>
    <div class="grid gap-2">` + rows.map((v) => `<div class="card rounded-xl p-3 text-sm mono">${esc(v.code)} — ${v.discount_percent}% (max ${rupiah(v.max_discount_idr)}) • ${v.used_count}/${v.quota}</div>`).join("") + `</div>`;
}
window.saveVoucher = async function () {
  const r = await api("/api/admin/vouchers", { method: "POST", body: JSON.stringify({ code: $("#vc").value, discountPercent: Number($("#vd").value || 10) }) });
  toast(r.message || "OK"); renderBody();
};

async function adminSettingsHtml() {
  const r = await api("/api/admin/settings");
  const s = r.data || {};
  const fields = ["site_name", "tagline", "wa_admin", "qris_text", "payment_bca", "notice"];
  return `<div class="card rounded-xl p-5 text-sm space-y-3 max-w-2xl">` + fields.map((k) => `
    <div><label class="text-xs text-slate-400">${k}</label><textarea id="set-${k}" rows="2" class="w-full mt-1 px-3 py-2 rounded-lg bg-slate-800 border border-slate-700">${esc(s[k] || "")}</textarea></div>`).join("") + `
    <button onclick="saveSettings()" class="px-5 py-3 rounded-xl bg-emerald-600 font-bold">${t("btn_save_settings")}</button></div>`;
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
  return `<div class="grid gap-1 text-xs mono">` + rows.slice(0, 100).map((a) => `<div class="card rounded-lg p-2">${new Date(a.created_at).toLocaleString("id-ID")} • <b>${esc(a.actor_name)}</b> • ${esc(a.action)} • ${esc(a.entity)}/${esc(a.entity_id)}</div>`).join("") + `</div>`;
}

(async () => {
  await loadMe();
  navInit("admin");
  if (!state.me) {
    $("#dashWrap").innerHTML = loginCardHtml("/admin");
    return;
  }
  if (!isAdminRole(state.me.role)) {
    $("#dashWrap").innerHTML = `<div class="card rounded-2xl p-6 max-w-md mx-auto text-sm text-center space-y-3">
      <div class="text-3xl">⛔</div><b>${t("denied_title")}</b>
      <p class="text-slate-400">${t("denied_desc", { role: `<b>${esc(state.me.role)}</b>` })}</p>
      <a href="/app" class="inline-block px-5 py-3 rounded-xl bg-emerald-600 font-bold">${t("back_my_dash")}</a>
    </div>`;
    return;
  }
  $("#dashRole").textContent = `${t("login_as")}${state.me.username}${t("role")}${state.me.role}`;
  renderTabs();
  renderBody();
})();
