import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { Script, createContext } from "node:vm";

const read = (path: string) => readFileSync(new URL("../" + path, import.meta.url), "utf8");
function fixture() {
  const elements: Record<string, any> = {};
  const element = (selector: string) => elements[selector] ||= {
    innerHTML: "", textContent: "", value: "", dataset: {},
    querySelectorAll: () => [], classList: { toggle() {}, add() {}, remove() {} },
    setAttribute() {}, removeAttribute() {}, addEventListener() {},
  };
  const context = createContext({
    console, setTimeout, clearTimeout,
    document: { querySelector: element, querySelectorAll: () => [] },
    window: { addEventListener() {} }, location: { hash: "" }, history: { replaceState() {} },
  });
  new Script(read("public/js/i18n.js")).runInContext(context);
  const common = read("public/js/common.js");
  new Script(common.slice(0, common.lastIndexOf("langInit();"))).runInContext(context);
  const landing = read("public/js/landing.js");
  new Script(landing.slice(0, landing.indexOf('$("#btnLogin").onclick'))).runInContext(context);
  const run = (code: string) => new Script(code).runInContext(context);
  return { context, run, element };
}

describe("static frontend contracts", () => {
  test("every browser script parses", () => {
    for (const file of readdirSync(new URL("../public/js", import.meta.url))) {
      if (file.endsWith(".js")) expect(() => new Script(read("public/js/" + file))).not.toThrow();
    }
  });
  test("page IDs are unique and scripts are versioned", () => {
    for (const file of ["index", "app", "admin"]) {
      const html = read(`public/${file}.html`);
      const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
      expect(new Set(ids).size).toBe(ids.length);
      expect(html).not.toContain("cdn.tailwindcss.com");
      expect(html).toContain("/css/utilities.css?v=41");
      expect(html).toContain("/js/common.js?v=41");
    }
  });
  test("all translated markup keys exist in both languages", () => {
    const { run } = fixture();
    const dictionaries = run("I18N");
    for (const file of ["index", "app", "admin"]) {
      const keys = [...read(`public/${file}.html`).matchAll(/data-i18n(?:-html|-ph|-title|-aria)?="([^"]+)"/g)].map((match) => match[1]);
      for (const key of keys) {
        expect(dictionaries.id[key], `id:${key}`).toBeDefined();
        expect(dictionaries.en[key], `en:${key}`).toBeDefined();
      }
    }
  });
});

describe("catalog and checkout", () => {
  const pc = { id: "test-pc", code: "RDP-01", name: "Studio <test>", cpu: "Ryzen 7", gpu: "RTX 4070", ram_gb: 32, storage_gb: 1000, status: "available", price_hourly: 10000, price_daily: 75000, price_weekly: 350000, price_monthly: 1200000 };
  test("all four prices use the existing backend fields", () => {
    const { run } = fixture();
    run(`globalThis.pc = ${JSON.stringify(pc)}`);
    expect(run("priceFor(pc, 'HOURLY')")).toBe(10000);
    expect(run("priceFor(pc, 'DAILY')")).toBe(75000);
    expect(run("priceFor(pc, 'WEEKLY')")).toBe(350000);
    expect(run("priceFor(pc, 'MONTHLY')")).toBe(1200000);
  });
  test("catalog escapes names and blocks unavailable machines", () => {
    const { run, element } = fixture();
    element("#catalogPeriod").value = "DAILY";
    run(`landing.pcs = [${JSON.stringify(pc)}, ${JSON.stringify({ ...pc, id: "off", status: "offline" })}]; renderPcs()`);
    const html = element("#pcGrid").innerHTML;
    expect(html).toContain("Studio &lt;test&gt;");
    expect(html).toContain("Rp75.000");
    expect(html).toMatch(/data-rent-pc="off" disabled/);
    expect(html).toContain('data-rent-pc="test-pc"');
  });
  test("availability and search filters leave the source catalog untouched", () => {
    const { run, element } = fixture();
    element("#catalogPeriod").value = "HOURLY";
    run(`landing.pcs = [${JSON.stringify(pc)}, ${JSON.stringify({ ...pc, id: "off", status: "offline" })}]; landing.filter = 'available'; renderPcs()`);
    expect(element("#pcGrid").innerHTML).not.toContain('data-rent-pc="off"');
    run("landing.query = 'unmatched'; renderPcs()");
    expect(element("#pcGrid").innerHTML).toContain("data-reset");
    expect(run("landing.pcs.length")).toBe(2);
  });
  test("refresh preserves the selected checkout package", () => {
    const { run, element } = fixture();
    element("#orderPlan").value = "MONTHLY";
    run("landing.plans = [{code:'HOURLY',name:'Hourly',duration_hours:1},{code:'MONTHLY',name:'Monthly',duration_hours:720}]; renderPlanOptions()");
    expect(element("#orderPlan").value).toBe("MONTHLY");
  });
  test("copy buttons remain valid JavaScript with quotes in credentials", () => {
    const { run, context } = fixture();
    const user = read("public/js/user.js");
    new Script(user.slice(0, user.lastIndexOf("(async () => {"))).runInContext(context);
    const html = run(`copyBtn('a"b', 'Copy')`);
    const handler = html.match(/onclick="([^"]+)"/)[1].replaceAll("&quot;", '"');
    expect(() => new Script(handler)).not.toThrow();
  });
});
