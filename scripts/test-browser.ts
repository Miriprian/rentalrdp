// Real-browser regression against preview:ui ONLY. No production data or agents.
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { chromium, type Page } from "playwright-core";

const base = "http://localhost:3100";
const settings = await (await fetch(base + "/api/public/settings")).json() as any;
assert.match(settings.data?.notice || "", /PREVIEW ONLY/, "Refusing to test against a non-preview database");
const temp = process.platform === "win32" ? join(process.env.LOCALAPPDATA!, "Temp", "opencode") : tmpdir();
const artifacts = mkdtempSync(join(temp, "rentalrdp-browser-"));
const browser = await chromium.launch(process.env.UI_BROWSER_PATH
  ? { executablePath: process.env.UI_BROWSER_PATH, headless: true }
  : { channel: process.platform === "win32" ? "msedge" : "chrome", headless: true });
const failures: string[] = [];
const results: string[] = [];
function track(page: Page) { page.on("pageerror", (error) => failures.push(error.message)); }
async function ready(page: Page) {
  await page.waitForFunction(() => !document.querySelector("#dashBody .loading-state"));
}
async function noOverflow(page: Page, label: string) {
  const size = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth }));
  assert.ok(size.document <= size.viewport + 1, `${label}: horizontal overflow ${JSON.stringify(size)}`);
}

try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: "id-ID", colorScheme: "light" });
  await context.addInitScript(() => { if (!localStorage.getItem("lang")) localStorage.setItem("lang", "id"); if (!localStorage.getItem("theme")) localStorage.setItem("theme", "light"); });
  const page = await context.newPage(); track(page);
  await page.goto(base);
  await page.locator(".machine-card").first().waitFor();
  await page.locator("#catalogSearch").fill("RTX");
  assert.ok(await page.locator(".machine-card").count() > 0);
  await page.locator("#catalogSearch").fill("no-matching-machine");
  await page.locator("[data-reset]").waitFor();
  await page.locator("[data-reset]").click();
  await page.locator('[data-filter="available"]').click();
  assert.equal(await page.locator("[data-rent-pc]:disabled").count(), 0);
  await page.locator("#catalogPeriod").selectOption("MONTHLY");
  assert.ok((await page.locator(".machine-price").first().textContent())?.includes("/bulan"));
  await page.locator(".machine-details").first().locator("summary").click();
  await page.locator(".machine-details[open] .spec-table").first().waitFor({ state: "visible" });
  await page.locator("#btnRefresh").click();
  assert.equal(await page.locator("#catalogPeriod").inputValue(), "MONTHLY");
  await page.locator(".machine-details[open]").first().locator("summary").click();
  await page.screenshot({ path: join(artifacts, "home-desktop.png"), fullPage: true });
  results.push("Catalog search, availability filter, all prices, full specs, refresh");

  await page.locator("#btnLogin").click();
  await page.locator('[data-close="authModal"]').click();
  assert.equal(await page.locator("#authModal").isVisible(), false);
  await page.locator("#btnLogin").click();
  await page.locator("#tabReg").click();
  const username = "ui_" + Date.now();
  const password = "UiTest_" + crypto.randomUUID().slice(0, 12);
  await page.locator("#rgUser").fill(username);
  await page.locator("#rgEmail").fill(username + "@example.test");
  await page.locator("#rgName").fill("UI Regression");
  await page.locator("#rgWA").fill("081234567890");
  await page.locator("#rgPass").fill(password);
  await Promise.all([page.waitForURL("**/app"), page.locator("#doReg").click()]);
  await page.locator(".empty-state").waitFor();
  await page.goto(base + "/admin");
  await page.getByText("Akses ditolak", { exact: true }).waitFor();
  assert.equal((await context.request.get(base + "/api/pcs")).status(), 403);
  results.push("Modal dismissal, registration, role-based access protection");

  await page.goto(base + "/#katalog");
  await page.locator(".machine-card").first().waitFor();
  await page.locator("#catalogPeriod").selectOption("DAILY");
  const available = page.locator("[data-rent-pc]:enabled").first();
  const pcId = await available.getAttribute("data-rent-pc");
  const pcs = await (await context.request.get(base + "/api/public/pcs")).json();
  const pc = pcs.data.find((row: any) => row.id === pcId);
  await available.click();
  assert.equal(await page.locator("#orderPlan").inputValue(), "DAILY");
  await page.locator("#orderVoucher").fill("WELCOME10");
  await page.locator("#orderPay").selectOption("bca");
  await page.locator("#orderNote").fill("Automated isolated UI regression");
  await Promise.all([page.waitForURL("**/app"), page.locator("#doOrder").click()]);
  await page.locator(".proof-form").waitFor();
  const orders = await (await context.request.get(base + "/api/orders/mine")).json();
  const order = orders.data[0];
  assert.equal(order.total_idr, pc.price_daily - Math.min(Math.floor(pc.price_daily * .1), 50000));
  await page.locator(".proof-form input").fill("UI-REGRESSION-REF");
  await page.locator(".proof-form button").click();
  await page.getByText("UI-REGRESSION-REF", { exact: true }).waitFor();
  results.push("Checkout, voucher calculation, payment reference submission");

  const adminContext = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: "id-ID" });
  await adminContext.addInitScript(() => { if (!localStorage.getItem("lang")) localStorage.setItem("lang", "id"); if (!localStorage.getItem("theme")) localStorage.setItem("theme", "light"); });
  const admin = await adminContext.newPage(); track(admin);
  admin.on("dialog", (dialog) => dialog.accept());
  await admin.goto(base + "/admin");
  await admin.locator("#liUser").fill("obake");
  await admin.locator("#liPass").fill("obake");
  await admin.locator("#inlineLoginBtn").click();
  await admin.locator("#ordersList").waitFor();
  const orderCard = admin.locator("#ordersList > .card").filter({ hasText: order.code });
  await orderCard.locator("button").filter({ hasText: "Approve" }).click();
  await orderCard.locator(".chip").filter({ hasText: "Aktif" }).waitFor();
  for (const key of ["pcs", "rentals", "rentacc", "users", "vouchers", "settings", "audit", "akun"]) {
    await admin.locator(`#dashTabs button[onclick="setTab('${key}')"]`).click();
    await ready(admin);
    assert.ok(!(await admin.locator("#dashBody").textContent())?.includes("Gagal memuat"), key);
  }
  await admin.locator('#dashTabs button[onclick="setTab(\'pcs\')"]').click();
  await admin.locator(".pc-admin-card").first().waitFor();
  const daily = admin.locator('input[id^="pd-"]').first();
  await daily.fill("88888");
  await admin.evaluate(async () => { await (window as any).livePcs(); });
  assert.equal(await daily.inputValue(), "88888", "Live refresh must not overwrite unsaved pricing");
  results.push("Admin login, approval, all 9 panels, live-refresh input preservation");

  await page.goto(base + "/app#rentals");
  await page.locator(".rental-credentials").waitFor();
  assert.equal(await page.locator(".credential strong").count(), 3);
  assert.ok((await page.locator(".credential strong").nth(2).textContent())!.length > 0);
  await page.bringToFront();
  await page.locator(".credential button").first().click();
  await page.locator("#toast").filter({ hasText: "Disalin" }).waitFor();
  const before = await (await context.request.get(base + "/api/rentals/mine")).json();
  await page.getByRole("button", { name: "+1 hari", exact: true }).click();
  await page.locator("#toast").filter({ hasText: "Diperpanjang" }).waitFor();
  const after = await (await context.request.get(base + "/api/rentals/mine")).json();
  assert.equal(new Date(after.data[0].end_at).getTime() - new Date(before.data[0].end_at).getTime(), 24 * 3600000);
  results.push("Decrypted RDP details, copy action, rental extension");

  for (const width of [360, 390, 768]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto(base);
    await page.locator(".machine-card").first().waitFor();
    await noOverflow(page, `Home ${width}`);
    if (width === 390) await page.screenshot({ path: join(artifacts, "home-mobile.png"), fullPage: true });
    await page.locator("[data-rent-pc]:enabled").first().click();
    await page.locator("#orderModal").waitFor({ state: "visible" });
    const modal = await page.locator("#orderModal").boundingBox();
    assert.ok(modal && modal.width <= width, "Checkout fits mobile");
    await page.locator('[data-close="orderModal"]').click();
    await page.goto(base + "/app#rentals");
    await page.locator(".rental-credentials").waitFor();
    await noOverflow(page, `Workspace ${width}`);
    await admin.setViewportSize({ width, height: 844 });
    await admin.goto(base + "/admin#pcs");
    await admin.locator(".pc-admin-card").first().waitFor();
    await noOverflow(admin, `Admin PC ${width}`);
    await admin.goto(base + "/admin#settings");
    await admin.locator(".settings-panel").waitFor();
    await noOverflow(admin, `Settings ${width}`);
  }
  results.push("360 / 390 / 768px: home, checkout, renter workspace, PC manager, settings; no horizontal overflow");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(base);
  await page.locator(".machine-card").first().waitFor();
  await page.locator("#themeSel").selectOption("dark");
  assert.equal(await page.locator("html").getAttribute("data-theme"), "dark");
  await page.screenshot({ path: join(artifacts, "home-dark.png"), fullPage: true, animations: "disabled" });
  await page.locator("#langSel").selectOption("en");
  await page.getByRole("heading", { name: "Hardware there. Control here." }).waitFor();
  assert.equal(await page.locator("html").getAttribute("lang"), "en");
  results.push("Dark mode and English localization");
  assert.deepEqual(failures, [], "No uncaught browser errors");
  console.log(results.map((result) => "PASS: " + result).join("\n"));
  console.log("Screenshots:", artifacts);
} catch (error) {
  console.error("Completed checks:", results);
  for (const context of browser.contexts()) for (const page of context.pages()) {
    console.error("Failure state:", await page.evaluate(() => ({
      url: location.href,
      title: document.querySelector("#viewTitle")?.textContent,
      credentials: document.querySelectorAll(".credential").length,
      error: document.querySelector("#dashBody")?.textContent?.includes("Gagal memuat") ? document.querySelector("#dashBody")?.textContent : null,
    })));
  }
  throw error;
} finally { await browser.close(); }
