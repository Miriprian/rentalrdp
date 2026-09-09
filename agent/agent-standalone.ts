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
// Detail hardware: motherboard, ramType, ramModules, disks, gpuVramGb.
const WIN_SPEC_PS1 = `
$ErrorActionPreference = 'SilentlyContinue'
$o = [ordered]@{ cpu = ""; gpu = ""; ramGb = 0; storageGb = 0; os = ""; storageType = "SSD"; motherboard = ""; ramType = ""; gpuVramGb = 0; cpuCores = 0; cpuThreads = 0; ramModules = @(); disks = @() }
try {
  $p = Get-CimInstance Win32_Processor | Select-Object -First 1
  $o.cpu = $p.Name
  $o.cpuCores = $p.NumberOfCores
  $o.cpuThreads = $p.NumberOfLogicalProcessors
  $o.cpuMaxGhz = if ($p.MaxClockSpeed) { [math]::Round($p.MaxClockSpeed / 1000, 1) } else { 0 }
} catch {}
try {
  $gpu = Get-CimInstance Win32_VideoController | Select-Object -First 1
  $o.gpu = $gpu.Name
  # VRAM real >4GB itu di registry (bukan AdapterRAM WMI yang ke-cap 4GB)
  try {
    $cl = 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}\\0000'
    $qi = Get-ItemProperty -Path $cl -ErrorAction Stop
    if ($qi.'HardwareInformation.qwMemorySize') { $o.gpuVramGb = [math]::Round($qi.'HardwareInformation.qwMemorySize' / 1GB) }
  } catch {}
  if ($o.gpuVramGb -le 0 -and $gpu.AdapterRAM) { $o.gpuVramGb = [math]::Round($gpu.AdapterRAM / 1GB) }
} catch {}
try { $o.ramGb = [math]::Round((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory / 1GB) } catch {}
try {
  $mb = Get-CimInstance Win32_BaseBoard | Select-Object -First 1
  $o.motherboard = (($mb.Manufacturer + " " + $mb.Product).Trim())
} catch {}
try {
  $memType = @{ 24 = "DDR3"; 26 = "DDR4"; 34 = "DDR5" }
  Get-CimInstance Win32_PhysicalMemory | ForEach-Object {
    $type = $memType[[int]$_.SMBIOSMemoryType]
    if (-not $type) { $type = "" }
    if ($type) { $o.ramType = $type }
    $o.ramModules += [ordered]@{
      slot = $_.DeviceLocator
      manufacturer = $_.Manufacturer
      partNumber = $_.PartNumber
      capacityGb = [math]::Round($_.Capacity / 1GB)
      speed = $_.ConfiguredClockSpeed
      type = $type
    }
  }
  if (-not $o.ramType) { $o.ramType = if ($o.ramModules.Count) { "DDR?" } else { "" } }
} catch {}
try {
  $t = 0
  $pds = Get-PhysicalDisk
  if ($pds) {
    $allSsd = $true
    foreach ($pd in $pds) {
      $sg = [math]::Round($pd.Size / 1GB)
      $t += $sg
      $o.disks += [ordered]@{
        model = $pd.FriendlyName
        capacityGb = $sg
        mediaType = $pd.MediaType
        busType = $pd.BusType
      }
      if ($pd.MediaType -eq "HDD") { $allSsd = $false }
    }
    $o.storageType = if ($allSsd) { "SSD" } else { "HDD" }
  }
  if (-not $o.disks.Count) {
    Get-CimInstance Win32_DiskDrive | ForEach-Object {
      $t += [math]::Round($_.Size / 1GB)
      $o.disks += [ordered]@{
        model = $_.Model
        capacityGb = [math]::Round($_.Size / 1GB)
        mediaType = ""
        busType = $_.InterfaceType
      }
    }
  }
  $o.storageGb = [math]::Round($t)
} catch {}
try { $o.os = ((Get-CimInstance Win32_OperatingSystem | Select-Object -First 1).Caption) } catch {}
$o | ConvertTo-Json -Compress -Depth 5
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
  const specs = { cpu: "", gpu: "", ramGb: 0, storageGb: 0, os: "", storageType: "SSD", motherboard: "", ramType: "", gpuVramGb: 0, cpuCores: 0, cpuThreads: 0, cpuMaxGhz: 0, ramModules: [] as unknown[], disks: [] as unknown[] };
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
        specs.storageType = String(j.storageType || "SSD").trim();
        specs.os = String(j.os || "").trim();
        specs.motherboard = String(j.motherboard || "").trim();
        specs.ramType = String(j.ramType || "").trim();
        specs.gpuVramGb = Math.round(Number(j.gpuVramGb || 0));
        specs.cpuCores = Math.round(Number(j.cpuCores || 0));
        specs.cpuThreads = Math.round(Number(j.cpuThreads || 0));
        specs.cpuMaxGhz = Math.round(Number(j.cpuMaxGhz || 0) * 10) / 10;
        specs.ramModules = Array.isArray(j.ramModules) ? j.ramModules : [];
        specs.disks = Array.isArray(j.disks) ? j.disks : [];
      } else {
        log(`spec raw: ${JSON.stringify(out).slice(0, 200)}`);
      }
    } else {
      const cpuR = await sh(`lscpu | grep -m1 "Model name" | sed 's/.*://'`);
      const gpuR = await sh(`lspci | grep -Ei "vga|3d" | head -1 | sed 's/.*: //'`);
      const ramR = await sh(`awk '/MemTotal/{printf "%d", $2/1024/1024}' /proc/meminfo`);
      const ramTypeR = await sh(`awk '/MemTotal/{printf "%d", $2/1024/1024}' /proc/meminfo; echo`); // noop keep
      const diskR = await sh(`df -BG --total / | awk '/total/{print int($2)}'`);
      const osR = await sh(`. /etc/os-release && echo "$PRETTY_NAME"`);
      const mbR = await sh(`cat /sys/class/dmi/id/board_vendor /sys/class/dmi/id/board_name 2>/dev/null | tr '\\n' ' '`);
      specs.cpu = cpuR.out.split("\n").map((s) => s.trim()).find(Boolean) || "";
      specs.gpu = gpuR.out.split("\n").map((s) => s.trim()).find(Boolean) || "";
      specs.ramGb = Math.round(Number(ramR.out.trim()) || 0);
      specs.storageGb = Math.round(Number(diskR.out.trim()) || 0);
      specs.os = osR.out.split("\n").map((s) => s.trim()).find(Boolean) || "";
      specs.storageType = "SSD";
      specs.motherboard = mbR.out.split("\n").map((s) => s.trim()).join(" ").trim();
      void ramTypeR;
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
  if (!detectedSpecs) {
    const s = await detectSpecs();
    const hwKeys = ["ramType", "gpuVramGb", "cpuCores", "cpuThreads", "cpuMaxGhz", "ramModules", "disks"] as const;
    const hw: Record<string, unknown> = {};
    for (const k of hwKeys) {
      hw[k] = s[k];
      delete s[k];
    }
    detectedSpecs = { ...s, hw, hostname: HOSTNAME, platform: process.platform };
  }
  const r = await apiCall(cfg, "/api/agent/heartbeat", {
    method: "POST",
    body: JSON.stringify(detectedSpecs),
  });
  if (first) {
    const hw = (detectedSpecs.hw || {}) as Record<string, unknown>;
    log(`spek PC: ${detectedSpecs.cpu || "?"} | ${detectedSpecs.gpu || "?"} | ${detectedSpecs.ramGb || "?"}GB | ${detectedSpecs.storageGb || "?"}GB ${detectedSpecs.storageType || ""} | ${detectedSpecs.os || "?"} | ${detectedSpecs.motherboard || "?"}`);
    log(`hw detail: RAM ${hw.ramType || "?"} ${JSON.stringify(hw.ramModules || []).slice(0, 200)} | VRAM ${hw.gpuVramGb || 0}GB | disks ${JSON.stringify(hw.disks || []).slice(0, 160)}`);
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

// Cek apakah instance agent lain sudah berjalan (hindari proses ganda).
async function anotherInstanceRunning(): Promise<boolean> {
  try {
    const base = (process.execPath || "rentalrdp-agent").split(/[\\/]/).pop()!.replace(/\.exe$/i, "");
    const r = await sh(`powershell -NoProfile -ExecutionPolicy Bypass -Command "(Get-Process -Name '${base}' -ErrorAction SilentlyContinue | Measure-Object).Count"`);
    const n = parseInt((r.out.match(/\d+/) || ["0"])[0], 10);
    return n > 1;
  } catch {
    return false;
  }
}

// Jalankan perintah schtasks lewat UAC (muncul pop-up sekali) — butuh admin.
async function schtasksElevated(cmd: string) {
  try {
    const psFile = join(EXE_DIR, ".rentalrdp-install.ps1");
    writeFileSync(psFile, cmd);
    await runExe(["powershell", "-NoProfile", "-Command", `Start-Process powershell -Verb RunAs -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File','"${psFile}"' -WindowStyle Hidden`]);
    await Bun.sleep(2500); // beri waktu UAC + pembuatan task
  } catch {
  } finally {
    try { unlinkSync(join(EXE_DIR, ".rentalrdp-install.ps1")); } catch {}
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
  const WATCH = join(EXE_DIR, "rentalrdp-agent-watchdog.bat");

  // 1) Watchdog.bat — restart agent kalau mati (proteksi: penyewa tidak bisa "membunuh" agent).
  try {
    writeFileSync(WATCH, `@echo off\r\ntasklist /fi "IMAGENAME eq rentalrdp-agent.exe" | findstr /i "rentalrdp-agent.exe" >nul\r\nif errorlevel 1 start "" /b "%~dp0rentalrdp-agent.exe" --silent\r\n`, "utf8");
  } catch {}

  // 2) Task BOOT (SYSTEM) — jalan SEBELUM login, session 0 (tak terlihat), dan TIDAK bisa
  //    di-kill oleh user biasa karena proses berjalan sebagai SYSTEM. Butuh admin (UAC sekali).
  const hasBoot = (await runExe(["schtasks", "/query", "/tn", "rentalrdp-agent"])).ok;
  if (!hasBoot && process.env.RENTALRDP_NO_ELEVATE !== "1") {
    await schtasksElevated(`schtasks /create /tn "rentalrdp-agent" /tr "${tr}" /sc onstart /ru SYSTEM /rl highest /f`);
  }
  const bootOk = (await runExe(["schtasks", "/query", "/tn", "rentalrdp-agent"])).ok;

  // 3) Watchdog task (SYSTEM) — tiap 1 menit cek agent; kalau mati → langsung nyalakan lagi.
  const hasWatch = (await runExe(["schtasks", "/query", "/tn", "rentalrdp-agent-watchdog"])).ok;
  if (!hasWatch && process.env.RENTALRDP_NO_ELEVATE !== "1") {
    await schtasksElevated(`schtasks /create /tn "rentalrdp-agent-watchdog" /tr "\"${WATCH}\"" /sc minute /mo 1 /ru SYSTEM /rl highest /f`);
  }
  const watchOk = (await runExe(["schtasks", "/query", "/tn", "rentalrdp-agent-watchdog"])).ok;

  if (bootOk) log("Auto-start OK: jalan saat BOOT (SYSTEM, background, anti-stop).");
  if (watchOk) log("Watchdog OK: auto-restart tiap 1 menit kalau agent mati.");

  // 4) Fallback TANPA admin: task saat login + Registry Run key (masih ada flash terminal & hanya untuk user yang sama).
  if (!bootOk) {
    const logonOk = (await runExe(["schtasks", "/create", "/tn", "rentalrdp-agent", "/tr", tr, "/sc", "onlogon", "/f"])).ok;
    if (logonOk) log("Auto-start: jalan saat login (fallback, tanpa UAC).");
    const reg = await runExe(["reg", "add", "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run", "/v", "rentalrdp-agent", "/t", "REG_SZ", "/d", tr, "/f"]);
    if (reg.ok && !logonOk) log("Auto-start: jalan saat login (Registry Run key - fallback).");
    if (!reg.ok && !logonOk) log("⚠️ Gagal semua auto-start. Jalankan SEKALI sebagai Administrator.");
    return logonOk || reg.ok;
  }
  return true;
}

async function autoInstall() {
  if (IS_WIN) {
    // Sudah terpasang dengan task BOOT → jangan pasang ulang (hindari pop-up UAC tiap boot).
    const hasBoot = (await runExe(["schtasks", "/query", "/tn", "rentalrdp-agent"])).ok;
    if (loadConfig().autostart && hasBoot) return;
    const ok = await createWindowsAutoStart();
    if (ok) setConfigFlag("autostart", true);
    return;
  }
  if (loadConfig().autostart) return;
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
    const ok = (await sh("systemctl daemon-reload && systemctl enable --now rentalrdp-agent")).ok;
    log(ok ? "Installed & started sebagai systemd service." : "Gagal start service. Jalankan dengan sudo.");
    if (ok) setConfigFlag("autostart", true);
  } catch {
    log("Gagal install systemd. Coba jalankan dengan sudo.");
  }
}

async function autoUninstall() {
  if (IS_WIN) {
    const r1 = await runExe(["schtasks", "/delete", "/tn", "rentalrdp-agent", "/f"]);
    const r2 = await runExe(["schtasks", "/delete", "/tn", "rentalrdp-agent-watchdog", "/f"]);
    const r3 = await runExe(["reg", "delete", "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run", "/v", "rentalrdp-agent", "/f"]);
    try { unlinkSync(join(EXE_DIR, "rentalrdp-agent-watchdog.bat")); } catch {}
    log(r1.ok || r2.ok || r3.ok ? "Auto-start dihapus (Boot task + Watchdog + Registry)." : "Belum ada auto-start (atau butuh Administrator).");
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

// Anti ganda: kalau instance lain sudah berjalan (mis. dari auto-start), instance baru keluar.
if (IS_WIN && (await anotherInstanceRunning())) {
  console.log("Agent sudah berjalan. Instance baru ditutup (dua instance tidak diizinkan).");
  process.exit(0);
}

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
