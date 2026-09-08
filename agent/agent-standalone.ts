#!/usr/bin/env bun
/**
 * rentalrdp.com — Standalone Bare Metal Agent
 * Satu file .exe, tinggal jalankan. Tidak perlu install Bun/Node apapun.
 *
 * Fitur:
 *   - Pertama kali jalan → tanya server + token → simpan config.json
 *   - Auto-create user Windows/Linux saat order di-approve
 *   - Auto-delete user saat rental expired/terminated
 *   - Heartbeat ke server tiap 15 detik
 *   - Auto-install sebagai startup (Windows) / systemd (Linux)
 *   - Jalankan dengan --install untuk auto-start, --uninstall untuk hapus
 */

import { readFileSync, writeFileSync, existsSync, unlinkSync } from "node:fs";
import { join, dirname } from "node:path";
import { hostname } from "node:os";
import { dlopen, FFIType } from "bun:ffi";

// ─── CONFIG ───────────────────────────────────────────────────
const EXE_DIR = dirname(process.execPath || process.argv[1] || ".");
const CONFIG_FILE = existsSync(join(EXE_DIR, "config.json"))
  ? join(EXE_DIR, "config.json")
  : join(process.cwd(), "config.json");
type Config = { api: string; token: string; interval: number; autostart?: boolean };
const DEFAULT: Config = { api: "", token: "", interval: 15 };

function loadConfig(): Config {
  try {
    if (existsSync(CONFIG_FILE)) {
      return { ...DEFAULT, ...JSON.parse(readFileSync(CONFIG_FILE, "utf8")) };
    }
  } catch {}
  return { ...DEFAULT };
}

function saveConfig(c: Config) {
  writeFileSync(CONFIG_FILE, JSON.stringify(c, null, 2));
}

function setConfigFlag(key: keyof Config, val: boolean) {
  try {
    const c = loadConfig();
    saveConfig({ ...c, [key]: val } as Config);
  } catch {}
}

// ─── CONFIG WIZARD (console prompt) ───────────────────────────
async function wizard(): Promise<Config> {
  const cfg = loadConfig();
  console.clear?.();
  console.log(`
╔══════════════════════════════════════════════════╗
║       rentalrdp.com — Bare Metal Agent Setup     ║
╚══════════════════════════════════════════════════╝
`);

  if (cfg.api && cfg.token) {
    console.log(`  Config ditemukan:`);
    console.log(`  Server : ${cfg.api}`);
    console.log(`  Token  : ${cfg.token.slice(0, 8)}...${cfg.token.slice(-4)}`);
    console.log(`  Status : Siap jalan!\n`);
    const use = await prompt("  Gunakan config ini? (Y/n): ");
    if (use?.toLowerCase() !== "n") return cfg;
  }

  const api = await prompt("  Server URL (contoh: http://103.160.62.10:3000): ");
  const token = await prompt("  Agent Token (dari Dashboard Admin > Kelola PC): ");
  const intervalStr = await prompt("  Polling interval detik (default 15): ");
  const interval = Number(intervalStr) || 15;

  if (!api || !token) {
    console.log("\n  ERROR: Server URL dan Token wajib diisi!");
    process.exit(1);
  }

  const cfg2: Config = { api: api.replace(/\/+$/, ""), token: token.trim(), interval };
  saveConfig(cfg2);
  console.log(`\n  Config tersimpan di: ${CONFIG_FILE}`);
  return cfg2;
}

function prompt(q: string): Promise<string | null> {
  return new Promise((resolve) => {
    process.stdout.write(q);
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.resume();
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === "\n" || ch === "\r") {
          process.stdin.pause();
          process.stdin.removeListener("data", onData);
          resolve(data.trim());
        } else if (ch === "\u0003") {
          process.exit(0);
        } else if (ch === "\u007F" || ch === "\b") {
          data = data.slice(0, -1);
          process.stdout.write("\b \b");
        } else {
          data += ch;
        }
      }
    };
    process.stdin.on("data", onData);
  });
}

// ─── DETEKSI SPEK REAL (dikirim ke server) ──────────────────
// Best-effort: kalau gagal, kirim kosong (server pakai nilai manual admin).
const WIN_SPEC_PS1 = `
$ErrorActionPreference = 'SilentlyContinue'
$o = [ordered]@{ cpu = ""; gpu = ""; ramGb = 0; storageGb = 0; os = ""; storageType = "SSD" }
try { $o.cpu = (Get-CimInstance Win32_Processor | Select-Object -First 1).Name } catch {}
try { $o.gpu = ((Get-CimInstance Win32_VideoController | Select-Object -First 1).Name) } catch {}
try { $o.ramGb = [math]::Round((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory / 1GB) } catch {}
try {
  $t = 0
  Get-CimInstance Win32_DiskDrive | ForEach-Object { $t += $_.Size }
  $o.storageGb = [math]::Round($t / 1GB)
} catch {}
try { $o.os = ((Get-CimInstance Win32_OperatingSystem | Select-Object -First 1).Caption) } catch {}
try {
  $pd = Get-PhysicalDisk | Sort-Object DeviceId | Select-Object -First 1
  if ($pd) { $o.storageType = if ($pd.MediaType -eq "HDD") { "HDD" } else { "SSD" } }
} catch {}
$o | ConvertTo-Json -Compress
`;

async function runPowerShell(script: string): Promise<string> {
  const tmp = join(EXE_DIR, ".specs.ps1");
  try {
    writeFileSync(tmp, script, "utf8");
    const proc = Bun.spawn(
      ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", tmp],
      { stdout: "pipe", stderr: "pipe" }
    );
    const out = await new Response(proc.stdout).text();
    const err = await new Response(proc.stderr).text();
    await proc.exited;
    return (out + err).trim();
  } finally {
    try {
      const { unlinkSync } = await import("node:fs");
      unlinkSync(tmp);
    } catch {}
  }
}

async function detectSpecs() {
  const specs = { cpu: "", gpu: "", ramGb: 0, storageGb: 0, os: "", storageType: "SSD" };
  try {
    if (IS_WIN) {
      const out = await runPowerShell(WIN_SPEC_PS1);
      const m = out.match(/\{.*\}/s);
      if (m) {
        const j = JSON.parse(m[0]);
        specs.cpu = String(j.cpu || "").trim();
        specs.gpu = String(j.gpu || "").trim();
        specs.ramGb = Math.round(Number(j.ramGb || 0));
        specs.storageGb = Math.round(Number(j.storageGb || 0));
        specs.os = String(j.os || "").trim();
        specs.storageType = String(j.storageType || "SSD").trim();
      } else {
        log(`spec raw: ${JSON.stringify(out).slice(0, 200)}`);
      }
    } else {
      const cpuR = await sh(`lscpu | grep -m1 "Model name" | sed 's/.*://'`);
      const gpuR = await sh(`lspci | grep -Ei "vga|3d" | head -1 | sed 's/.*: //'`);
      const ramR = await sh(`awk '/MemTotal/{printf "%d", $2/1024/1024}' /proc/meminfo`);
      const diskR = await sh(`df -BG --total / | awk '/total/{print int($2)}'`);
      const osR = await sh(`. /etc/os-release && echo "$PRETTY_NAME"`);
      specs.cpu = cpuR.out.split("\n").map((s) => s.trim()).find(Boolean) || "";
      specs.gpu = gpuR.out.split("\n").map((s) => s.trim()).find(Boolean) || "";
      specs.ramGb = Math.round(Number(ramR.out.trim()) || 0);
      specs.storageGb = Math.round(Number(diskR.out.trim()) || 0);
      specs.os = osR.out.split("\n").map((s) => s.trim()).find(Boolean) || "";
      specs.storageType = "SSD";
    }
  } catch (e) {
    log(`detectSpecs error: ${String(e).slice(0, 200)}`);
  }
  return specs;
}

// ─── AGENT CORE ───────────────────────────────────────────────
const HOSTNAME = hostname();
const IS_WIN = process.platform === "win32";

async function sh(cmd: string): Promise<{ ok: boolean; out: string }> {
  try {
    const proc = Bun.spawn(
      IS_WIN ? ["cmd", "/c", cmd] : ["sh", "-c", cmd],
      { stdout: "pipe", stderr: "pipe" }
    );
    const out = await new Response(proc.stdout).text();
    const err = await new Response(proc.stderr).text();
    const code = await proc.exited;
    return { ok: code === 0, out: (out + err).slice(0, 2000) };
  } catch (e) {
    return { ok: false, out: String(e).slice(0, 2000) };
  }
}

async function createUser(username: string, password: string) {
  log(`create_user: ${username}`);
  if (IS_WIN) {
    let r = await sh(`net user ${username} ${password} /add`);
    if (!r.ok && (r.out.includes("sudah ada") || r.out.includes("already"))) {
      await sh(`net user ${username} ${password}`);
      r = { ok: true, out: "password reset" };
    }
    if (r.ok) {
      await sh(`net localgroup "Remote Desktop Users" ${username} /add`);
      await sh(`net user ${username} /active:yes`);
    }
    return r;
  } else {
    let r = await sh(`useradd -m -s /bin/bash ${username}`);
    if (r.ok || r.out.includes("already exists")) {
      const r2 = await sh(`echo '${username}:${password}' | chpasswd`);
      return r2.ok ? { ok: true, out: "user ready" } : r2;
    }
    return r;
  }
}

async function deleteUser(username: string) {
  log(`delete_user: ${username}`);
  if (IS_WIN) return await sh(`net user ${username} /delete`);
  return await sh(`userdel -r ${username}`);
}

function log(msg: string) {
  const ts = new Date().toLocaleString("id-ID");
  console.log(`[${ts}] ${msg}`);
}

async function apiCall(cfg: Config, path: string, opts?: RequestInit) {
  const url = `${cfg.api}${path}`;
  return fetch(url, {
    headers: { "Content-Type": "application/json", "x-agent-token": cfg.token },
    ...opts,
  });
}

let detectedSpecs: Record<string, unknown> | null = null;

async function heartbeat(cfg: Config) {
  const first = !detectedSpecs;
  if (!detectedSpecs) detectedSpecs = { ...(await detectSpecs()), hostname: HOSTNAME, platform: process.platform };
  const r = await apiCall(cfg, "/api/agent/heartbeat", {
    method: "POST",
    body: JSON.stringify(detectedSpecs),
  });
  if (first) {
    log(`spek PC: ${detectedSpecs.cpu || "?"} | ${detectedSpecs.gpu || "?"} | ${detectedSpecs.ramGb || "?"}GB | ${detectedSpecs.storageGb || "?"}GB ${detectedSpecs.storageType || ""} | ${detectedSpecs.os || "?"}`);
  }
  if (!r.ok) log(`heartbeat failed: ${r.status} ${(await r.text().catch(() => "")).slice(0, 100)}`);
  return r.ok;
}

async function loop(cfg: Config) {
  // Heartbeat
  try {
    await heartbeat(cfg);
  } catch (e) {
    log(`heartbeat error: ${String(e).slice(0, 80)}`);
  }

  // Poll tasks
  try {
    const r = await apiCall(cfg, "/api/agent/tasks");
    const j = await r.json().catch(() => ({}));
    const tasks = (j.tasks || []) as { id: string; type: string; payload_json: string }[];

    for (const t of tasks) {
      log(`task: ${t.type} (${t.id.slice(0, 8)})`);
      let res = { ok: true, out: "ok" };
      try {
        const p = JSON.parse(t.payload_json || "{}");
        if (t.type === "create_user") res = await createUser(p.username, p.password);
        else if (t.type === "delete_user") res = await deleteUser(p.username);
        else if (t.type === "restart") {
          res = { ok: true, out: "restarting..." };
          setTimeout(() => sh(IS_WIN ? "shutdown /r /t 5" : "reboot"), 2000);
        } else if (t.type === "shutdown") {
          res = { ok: true, out: "shutting down..." };
          setTimeout(() => sh(IS_WIN ? "shutdown /s /t 5" : "poweroff"), 2000);
        } else {
          res = { ok: true, out: "unknown task" };
        }
      } catch (e) {
        res = { ok: false, out: String(e).slice(0, 500) };
      }

      await apiCall(cfg, `/api/agent/tasks/${t.id}/complete`, {
        method: "POST",
        body: JSON.stringify({ ok: res.ok, result: res.out }),
      });
      log(`done: ${res.ok ? "OK" : "FAIL"} - ${res.out.slice(0, 100)}`);
    }
  } catch (e) {
    log(`poll error: ${String(e).slice(0, 80)}`);
  }
}

// ─── AUTO-INSTALL (Windows startup / Linux systemd) ──────────
// Satu kali jalan (wizard) → otomatis didaftarkan auto-start.
// Setelah PC reboot / matilistrik lalu hidup, agent langsung jalan lagi.

// Jalankan program tanpa lewat cmd (hindari masalah quoting path).
async function runExe(argsLocal: string[]): Promise<{ ok: boolean; out: string }> {
  try {
    const proc = Bun.spawn(argsLocal, { stdout: "pipe", stderr: "pipe", windowsHide: true });
    const out = await new Response(proc.stdout).text();
    const err = await new Response(proc.stderr).text();
    const code = await proc.exited;
    return { ok: code === 0, out: (out + err).slice(0, 1500).trim() };
  } catch (e) {
    return { ok: false, out: String(e).slice(0, 1500) };
  }
}

// Sembunyikan console window saat mode --silent.
function hideConsole() {
  try {
    if (!IS_WIN) return;
    const user32 = dlopen("user32.dll", {
      GetConsoleWindow: { args: [], returns: FFIType.ptr },
      ShowWindow: { args: [FFIType.ptr, FFIType.i32], returns: FFIType.bool },
    });
    const h = user32.symbols.GetConsoleWindow();
    if (h) user32.symbols.ShowWindow(h, 0);
  } catch {}
}

async function createWindowsAutoStart(): Promise<boolean> {
  const exePath = process.execPath;
  const tr = `"${exePath}" --silent`;
  // A. Task Scheduler saat BOOT (SYSTEM) — jalan sebelum ada yang login, tahan matilistrik. Butuh admin.
  let bootOk = (await runExe(["schtasks", "/create", "/tn", "rentalrdp-agent", "/tr", tr, "/sc", "onstart", "/ru", "SYSTEM", "/rl", "highest", "/f"])).ok;
  if (!bootOk && process.env.RENTALRDP_NO_ELEVATE !== "1") {
    // A2. Retry lewat UAC (muncul pop-up sekali) supaya boot-start tetap bisa tanpa pencet-pencet lain.
    try {
      const psFile = join(EXE_DIR, ".rentalrdp-install.ps1");
      writeFileSync(psFile, `schtasks /create /tn "rentalrdp-agent" /tr "${tr}" /sc onstart /ru SYSTEM /rl highest /f`);
      await runExe(["powershell", "-NoProfile", "-Command", `Start-Process powershell -Verb RunAs -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File','"${psFile}"' -WindowStyle Hidden`]);
      await Bun.sleep(2500); // beri waktu UAC + pembuatan task
      bootOk = (await runExe(["schtasks", "/query", "/tn", "rentalrdp-agent"])).ok;
    } catch {
    } finally {
      try { unlinkSync(join(EXE_DIR, ".rentalrdp-install.ps1")); } catch {}
    }
  }
  let anyOk = bootOk;
  if (bootOk) {
    log("Auto-start OK: jalan saat BOOT (sebelum login) — tahan matilistrik.");
  }
  // B. Cadangan (penting bila tanpa admin): Task saat login + Registry Run key.
  const logonOk = (await runExe(["schtasks", "/create", "/tn", "rentalrdp-agent", "/tr", tr, "/sc", "onlogon", "/f"])).ok;
  if (logonOk) anyOk = true;
  // C. Beri informasi status ke user.
  if (!anyOk) {
    log("Auto-start: jalan saat login (Registry Run key).");
    log("Tips: sekali jalankan sebagai Administrator biar juga jalan SAAT BOOT walau belum login.");
  }
  // D. Registry Run key (HKCU) — mekanisme paling pasti tanpa admin.
  const reg = await runExe(["reg", "add", "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run", "/v", "rentalrdp-agent", "/t", "REG_SZ", "/d", tr, "/f"]);
  if (!reg.ok) {
    log("⚠️ Gagal tulis registry auto-start: " + reg.out.slice(0, 120));
    return anyOk;
  }
  return true;
}

async function autoInstall() {
  // Sudah terpasang sebelumnya → jangan pasang lagi (hindari pop-up UAC tiap boot).
  if (loadConfig().autostart) return;
  let ok = false;
  if (IS_WIN) {
    ok = await createWindowsAutoStart();
  } else {
    const service = `[Unit]
Description=RentalRDP Agent
After=network.target

[Service]
ExecStart=${process.execPath} --silent
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target`;
    try {
      writeFileSync("/etc/systemd/system/rentalrdp-agent.service", service);
      ok = (await sh("systemctl daemon-reload && systemctl enable --now rentalrdp-agent")).ok;
      log(ok ? "Installed & started sebagai systemd service." : "Gagal start service. Jalankan dengan sudo.");
    } catch {
      log("Gagal install systemd. Coba jalankan dengan sudo.");
    }
  }
  if (ok) setConfigFlag("autostart", true);
}

async function autoUninstall() {
  if (IS_WIN) {
    const r1 = await runExe(["schtasks", "/delete", "/tn", "rentalrdp-agent", "/f"]);
    const r2 = await runExe(["reg", "delete", "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run", "/v", "rentalrdp-agent", "/f"]);
    log(r1.ok || r2.ok ? "Auto-start dihapus (Task + Registry)." : "Belum ada auto-start (atau butuh Administrator).");
  } else {
    const r = await sh("systemctl disable --now rentalrdp-agent && rm -f /etc/systemd/system/rentalrdp-agent.service && systemctl daemon-reload");
    log(r.ok ? "Systemd service dihapus." : "Gagal hapus systemd service. Jalankan dengan sudo.");
  }
}

// ─── MAIN ─────────────────────────────────────────────────────
const args = process.argv.slice(2);

if (args.includes("--install") || args.includes("-i")) {
  await autoInstall();
  process.exit(0);
}

if (args.includes("--uninstall") || args.includes("-u")) {
  await autoUninstall();
  process.exit(0);
}

const SILENT = args.includes("--silent") || args.includes("-s");
if (SILENT) hideConsole();
const cfg = SILENT ? loadConfig() : await wizard();

if (!cfg.api || !cfg.token) {
  console.log("\n  Config belum diisi! Jalankan tanpa --silent untuk setup wizard.");
  console.log("  Atau buat config.json manual:\n");
  console.log('  {"api":"http://SERVER:3000","token":"TOKEN","interval":15}');
  process.exit(1);
}

// Sekali klik: setelah setup/config valid, langsung daftarkan auto-start
// supaya setelah reboot / matilistrik, agent otomatis jalan lagi.
await autoInstall();

console.log(`
╔══════════════════════════════════════════════════╗
║  rentalrdp.com — Bare Metal Agent               ║
║  Host : ${HOSTNAME.padEnd(39)}║
║  API  : ${cfg.api.slice(0, 39).padEnd(39)}║
║  Mode : ${IS_WIN ? "Windows" : "Linux"} ${(IS_WIN ? "(RDP)" : "(SSH)").padEnd(32)}║
║  Poll : setiap ${String(cfg.interval) + " detik".padEnd(30)}║
╠══════════════════════════════════════════════════╣
║  Auto-start: otomatis terpasang (jalan saat boot)║
║  Ctrl+C untuk berhenti.                          ║
║  --uninstall = hapus auto-start                  ║
╚══════════════════════════════════════════════════╝
`);

await loop(cfg);
setInterval(() => loop(cfg), cfg.interval * 1000);
