#!/usr/bin/env bun
/**
 * Rental PC by Miriprian — Standalone Bare Metal Agent
 * Satu file .exe, tinggal jalankan. Tidak perlu install Bun/Node apapun.
 *
 * Fitur:
 *   - Pertama kali jalan → tanya server + token → simpan config.json
 *   - Auto-create user Windows/Linux saat order di-approve
 *   - Auto-delete user saat rental expired/terminated
 *   - Heartbeat ke server tiap 15 detik
 *   - Tes kecepatan internet otomatis (speedtest.net) tiap boot & tiap 12 jam (+jitter)
 *   - Auto-install sebagai startup (Windows) / systemd (Linux)
 */

import { readFileSync, writeFileSync, existsSync, unlinkSync, mkdirSync, rmSync, readdirSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { connect } from "node:net";
import { hostname, networkInterfaces } from "node:os";
import { dlopen, FFIType } from "bun:ffi";

// ─── CONFIG ───────────────────────────────────────────────────
// Versi di-inject saat build (--define METADATA_VERSION="..."). Kalau build tanpa
// --define (mis. dev), VERSION otomatis "dev".
declare const METADATA_VERSION: string | undefined;
const VERSION = (typeof METADATA_VERSION !== "undefined" && METADATA_VERSION) || "dev";
const REMOTE_VERSION_URL = "https://raw.githubusercontent.com/Miriprian/rentalrdp/main/agent/AGENT_VERSION";

const EXE_DIR = dirname(process.execPath || process.argv[1] || ".");
const CONFIG_FILE = existsSync(join(EXE_DIR, "config.json"))
  ? join(EXE_DIR, "config.json")
  : join(process.cwd(), "config.json");
// Nama file & "process image name" mengikuti nama exe (mis. rentalrdp-agent-v1.exe).
const AGENT_EXE_NAME = (process.execPath || "rentalrdp-agent").split(/[\\/]/).pop()!;
const PROC_BASE = AGENT_EXE_NAME.replace(/\.exe$/i, "");
type Config = { api: string; token: string; interval: number; autostart?: boolean; version?: string };
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
║  Rental PC by Miriprian — Agent Setup            ║
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

// ─── SELF-UPDATE (unduh agent terbaru dari GitHub Releases) ────
const REPO = "Miriprian/rentalrdp";
const ASSET_NAME = "windows-rentalrdp-agent.exe";
const API_LATEST_URL = `https://api.github.com/repos/${REPO}/releases/latest`;

async function httpText(url: string, timeoutMs = 20000): Promise<string | null> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const r = await fetch(url, { signal: ctrl.signal, headers: { "User-Agent": "rentalrdp-agent" } });
    clearTimeout(t);
    if (!r.ok) return null;
    return await r.text();
  } catch {
    return null;
  }
}

async function latestRelease(): Promise<{ tag: string; url: string } | null> {
  try {
    const txt = await httpText(API_LATEST_URL);
    if (!txt) return null;
    const j = JSON.parse(txt);
    const tag = String(j.tag_name || "");
    const asset =
      (j.assets || []).find((a: { name: string; browser_download_url: string }) => a.name === ASSET_NAME) ||
      (j.assets || []).find((a: { name: string; browser_download_url: string }) => /^windows-rentalrdp-agent-v.*\.exe$/i.test(a.name)) ||
      (j.assets || []).find((a: { name: string; browser_download_url: string }) => /^rentalrdp-agent-v.*\.exe$/i.test(a.name));
    if (!tag || !asset) return null;
    return { tag, url: asset.browser_download_url };
  } catch {
    return null;
  }
}

// Bandingkan versi "1", "1.2", "1.2.3" — numerik per bagian.
function cmpVersion(a: string, b: string): number {
  const pa = String(a || "0").split(".").map((x) => parseInt(x, 10) || 0);
  const pb = String(b || "0").split(".").map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

// Update SIMPLE (sesuai permintaan): hanya mengunduh exe versi terbaru ke folder yang sama
// dengan nama finalnya (mis. windows-rentalrdp-agent-v12.exe). TIDAK membunuh proses,
// TIDAK menjalankan batch, TIDAK auto-restart.
// 1) Pilih menu 2 → file baru terunduh di samping file lama.
// 2) Tutup terminal, jalankan manual exe yang baru.
// 3) Di agent baru pilih menu 1 → agent otomatis menghapus exe versi lama di folder yang sama.
async function downloadUpdate(cfg: Config, rel: { url: string }): Promise<boolean> {
  const newName = decodeURIComponent(rel.url.split("/").pop() || AGENT_EXE_NAME);
  const newPath = join(EXE_DIR, newName);
  try {
    try { rmSync(join(EXE_DIR, ".update"), { recursive: true, force: true }); } catch {}
    try { rmSync(process.execPath + ".new", { force: true }); } catch {}
    log("Mengunduh versi terbaru dari GitHub...");
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 120000);
    const r = await fetch(rel.url, { signal: ctrl.signal });
    clearTimeout(t);
    if (!r.ok) throw new Error("unduh gagal (HTTP " + r.status + ")");
    const buf = await r.arrayBuffer();
    writeFileSync(newPath, Buffer.from(buf));
    log(`Terunduh ${(buf.byteLength / 1048576).toFixed(1)} MB → ${newName}`);
    console.log(`
  ------------------------------------------------------------------
   UPDATE SELESAI (manual):
   1) Tutup terminal ini.
   2) Jalankan file baru: ${newName}
   3) Di agent baru pilih menu 1 — exe versi lama di folder ini akan dihapus otomatis.
  ------------------------------------------------------------------
`);
    return true;
  } catch (e) {
    log("Update gagal: " + String(e).slice(0, 200));
    log("Coba lagi, atau unduh manual dari halaman Releases GitHub.");
    return false;
  }
}

// Exe yang masih dirujuk oleh boot task / HKCU Run / watchdog.bat — jangan dihapus.
async function referencedAgentRefs(): Promise<string[]> {
  const refs: string[] = [];
  try {
    const xml = (await runExe(["schtasks", "/query", "/tn", "rentalrdp-agent", "/xml"])).out;
    if (xml) refs.push(xml.toLowerCase());
  } catch {}
  try {
    const reg = (await runExe(["reg", "query", "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run", "/v", "rentalrdp-agent"])).out;
    if (reg) refs.push(reg.toLowerCase());
  } catch {}
  const wd = join(EXE_DIR, "rentalrdp-agent-watchdog.bat");
  try { if (existsSync(wd)) refs.push(readFileSync(wd, "utf8").toLowerCase()); } catch {}
  return refs;
}

// Hapus exe agent versi LAMA di folder yang sama, sisakan versi sekarang (dan yang lebih baru).
// Sebelum dihapus, proses yang masih menjalankan file itu (mis. instance boot task / watchdog)
// dibunuh dulu — itu penyebab "masih di gunakan" sehingga file tak bisa dihapus manual.
async function cleanupOldAgents() {
  try {
    const curBase = basename(process.execPath).toLowerCase();
    const files = readdirSync(EXE_DIR).filter((f) => /^windows-rentalrdp-agent-v\d+\.exe$/i.test(f));
    const refs = IS_WIN ? await referencedAgentRefs() : [];
    const isReferenced = (f: string) => refs.some((r) => r.includes(f.toLowerCase()));
    for (const f of files) {
      if (f.toLowerCase() === curBase) continue;
      const m = f.match(/v(\d+)\.exe$/i);
      if (!m) continue;
      if (Number(m[1]) > Number(VERSION)) continue;
      // Jika boot task / HKCU Run / watchdog MASIH menunjuk exe ini (mis. gagal update saat
      // bukan admin), jangan hapus — kalau dihapus auto-start akan rusak.
      if (isReferenced(f)) {
        log(`Lewati ${f} — masih dirujuk auto-start (update dulu via menu 1 sebagai Administrator).`);
        continue;
      }
      const full = join(EXE_DIR, f);
      let first = true;
      for (let i = 0; i < 12 && existsSync(full); i++) {
        if (first) { await runExe(["taskkill", "/f", "/im", f]); first = false; }
        await runExe(["taskkill", "/f", "/im", f]);
        Bun.sleepSync(400);
        try { rmSync(full, { force: true }); } catch {}
      }
      if (existsSync(full)) {
        log(`Hapus ${f} GAGAL (masih di pakai) — coba hapus manual setelah restart.`);
      } else {
        log(`Versi lama dihapus: ${f}`);
      }
    }
    try { rmSync(join(EXE_DIR, ".update"), { recursive: true, force: true }); } catch {}
    for (const f of readdirSync(EXE_DIR).filter((x) => x.endsWith(".new"))) {
      try { rmSync(join(EXE_DIR, f), { force: true }); } catch {}
    }
  } catch (e) {
    log("Bersihkan exe lama gagal: " + String(e).slice(0, 120));
  }
}

async function checkAndUpdate(cfg: Config, force = false): Promise<boolean> {
  log("Cek update dari GitHub...");
  if (VERSION === "dev") {
    log("Build ini 'dev' (tanpa versi). Skip cek update.");
    return false;
  }
  const [rel, remoteText] = await Promise.all([latestRelease(), httpText(REMOTE_VERSION_URL)]);
  const remote = (remoteText || "").trim();
  if (!rel || !remote) {
    log("Cek update gagal. Pastikan repo GitHub & Releases-nya PUBLIC (tanpa login).");
    return false;
  }
  if (!force && cmpVersion(VERSION, remote) >= 0) {
    log(`Agent sudah versi terbaru: v${VERSION}.`);
    return false;
  }
  log(`Versi saat ini : v${VERSION}`);
  log(`Versi terbaru  : v${remote}`);
  const ans = await prompt("  Update sekarang? (Y/n): ");
  if (ans?.toLowerCase() === "n") return false;
  return downloadUpdate(cfg, rel);
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
  const specs = { cpu: "", gpu: "", ramGb: 0, storageGb: 0, os: "", storageType: "SSD", motherboard: "", ramType: "", gpuVramGb: 0, cpuCores: 0, cpuThreads: 0, cpuMaxGhz: 0, ramModules: [] as unknown[], disks: [] as unknown[], lanIp: "" };
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
  // IP LAN (untuk Host local di info koneksi RDP)
  try {
    const nets = networkInterfaces();
    for (const list of Object.values(nets)) {
      for (const x of list || []) {
        if (x.family === "IPv4" && !x.internal) {
          specs.lanIp = x.address;
          break;
        }
      }
      if (specs.lanIp) break;
    }
  } catch {}
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
      await sh(`net user ${username} /active:yes`);
      // Akun sewa = FULL ADMINISTRATOR (kebijakan pemilik: penyewa dapat kendali penuh PC).
      // Ditambah via SID (S-1-5-32-544) supaya tahan bahasa Windows (seperti SID RDP).
      await makeAdmin(username);
      const adminOk = await isMemberAdmin(username);
      // Wajib: izinkan remote login → tambah ke grup "Remote Desktop Users"
      // via SID (S-1-5-32-555) supaya tetap jalan di Windows berbahasa non-English
      // (di mana "net localgroup \"Remote Desktop Users\"" gagal karena nama terlokalisasi).
      await allowRdp(username);
      // Jaminan "hanya 1 akun": buang SEMUA user lain (termasuk akun setup Windows
      // / account pengguna lama) kecuali akun rent_ baru ini + akun sistem built-in.
      const purged = await purgeExtraAccounts(username);
      // PC auto logout: semua session interaktif diputus → layar login.
      await logoffAllInteractive();
      // Kunci terakhir: sweep paksa folder profil yatim (obake & rent_ lama yang
      // akunnya sudah hilang lebih dulu) supaya C:\Users benar-benar bersih.
      const swept = await sweepOrphanProfiles();
      return {
        ok: true,
        out:
          `akun terbuat (administrator ${adminOk ? "✓" : "✗"}) | hapus akun lama: ${purged.length ? purged.join("; ") : "tidak ada"} | profil: ${swept.length ? swept.map((s) => s.split("|").pop()).join(", ") : "tidak ada"} | pc logout`,
      };
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

function notFoundMsg(out: string) {
  return /not found|could not be found|tidak dapat ditemukan|tidak ditemukan/i.test(out);
}

// Akhiri session user (mis. masih login RDP/console) supaya akunnya bisa dihapus.
async function endUserSessions(name: string) {
  try {
    const meOut = (await sh("whoami")).out.trim().toLowerCase().split("\\").pop();
    if (meOut && meOut === name.toLowerCase()) return; // jangan logoff session kita sendiri
  } catch {}
  for (const tool of ["query user", "quser"]) {
    const out = (await sh(`${tool} "${name}" 2>nul`)).out;
    const rows = out.split(/\r?\n/).filter((l) => l.trim() && !/USERNAME\s+SESSIONNAME/i.test(l));
    for (const row of rows) {
      const toks = row.trim().replace(/^>/, "").trim().split(/\s+/);
      const stateIdx = toks.findIndex((x) => /^(Active|Disc|Conn|Other|Connect)$/i.test(x));
      const id = stateIdx > 0 ? toks[stateIdx - 1] : toks[toks.length - 2];
      if (/^\d+$/.test(id || "")) {
        await sh(`logoff ${id} 2>nul`);
        await new Promise((res) => setTimeout(res, 1500));
      }
    }
    if (rows.length) return;
  }
}

async function purgeExtraAccounts(keep: string): Promise<string[]> {
  const results: string[] = [];
  try {
    const keepE = keep.replace(/'/g, "''");
    const ps =
      `Get-LocalUser | Where-Object { $_.Name -ne '${keepE}' -and $_.Name -notmatch '(?i)^(administrator|guest|defaultaccount|wdagutilityaccount)$' } | ForEach-Object { "$($_.Name)|$($_.SID.Value)" }`;
    const out = await runPowerShell(ps);
    const users = out
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter((l) => l.includes("|"))
      .map((l) => {
        const [n, sid] = l.split("|");
        return { name: n, sid };
      });
    if (!users.length) return results;
    let bridged = false;
    const bridge = async () => {
      if (!bridged) {
        bridged = true;
        await sh(`net user administrator ${genPass()}`);
        await sh(`net user administrator /active:yes`);
        log("Administrator built-in dinyalakan sementara sebagai jembatan penghapusan.");
      }
    };
    for (const { name: u, sid } of users) {
      // Hapus instant: putus dulu SEMUA session akun ini (RDP/console) sebelum hapus,
      // supaya Windows tidak menolak karena "sedang di gunakan".
      await endUserSessions(u);
      let d = await sh(`net user "${u}" /delete`);
      if (!d.ok && !notFoundMsg(d.out)) {
        // 2) kalaupun masih gagal ("admin terakhir"): jembatan Administrator sementara.
        await bridge();
        d = await sh(`net user "${u}" /delete`);
      }
      if (!d.ok && !notFoundMsg(d.out)) {
        // 3) terakhir: Remove-LocalUser (bisa menghapus walau profile di-lock).
        const po = await runPowerShell(
          `try { Remove-LocalUser -Name '${u.replace(/'/g, "''")}' -ErrorAction Stop; Write-Output 'removed' } catch { $_.Exception.Message }`
        );
        d = po.includes("removed") ? { ok: true, out: "remove-localuser ok" } : { ok: false, out: po };
      }
      if (d.ok || notFoundMsg(d.out)) {
        const profOk = await removeProfile(sid, u);
        const line = profOk ? `hapus ${u} + profile` : `hapus ${u} (profile gagal dihapus)`;
        results.push(line);
        log(`purge akun lama: ${line}`);
      } else {
        const line = `GAGAL hapus ${u} (${d.out.slice(0, 140)})`;
        results.push(line);
        log(`purge akun lama: ${line}`);
      }
    }
    if (bridged) {
      await sh(`net user administrator /active:no`);
      log("Administrator built-in dinonaktifkan kembali setelah purge selesai.");
    }
    // Lapor sisa akun non-sistem setelah purge (transparan: kalau masih ada, ketahuan namanya).
    try {
      const left = (await runPowerShell(
        `Get-LocalUser | Where-Object { $_.Name -notmatch '(?i)^(administrator|guest|defaultaccount|wdagutilityaccount)$' } | ForEach-Object { $_.Name }`
      ))
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean);
      const leftover = left.filter((n) => n.toLowerCase() !== keep.toLowerCase());
      if (leftover.length) results.push(`SISA: ${leftover.join(", ")}`);
    } catch {}
  } catch (e) {
    results.push(String(e).slice(0, 140));
    log("purge akun lama gagal: " + String(e).slice(0, 120));
  }
  return results;
}

function genPass(n = 16) {
  const c = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  let s = "";
  for (let i = 0; i < n; i++) s += c[Math.floor(Math.random() * c.length)];
  return s;
}

async function addToGroup(username: string, sid: string, fallbackGroup: string) {
  const ps =
    `try { Add-LocalGroupMember -Group (Get-LocalGroup -SID ${sid}) -Member '${username}'; Write-Output 'ok' } catch { Write-Output 'fail' }`;
  const out = await runPowerShell(ps);
  if (out.includes("ok")) return;
  // Fallback: nama grup bahasa Inggris (Windows en-US).
  await sh(`net localgroup "${fallbackGroup}" ${username} /add`);
}

async function allowRdp(username: string) {
  await addToGroup(username, "S-1-5-32-555", "Remote Desktop Users");
}

async function removeProfile(sid: string, name: string): Promise<boolean> {
  // Hapus folder profil (mis. C:\Users\<user>) milik akun yang baru dihapus.
  // Lewat Win32_UserProfile agar aman walau Users berada di drive non-C.
  const safeSid = sid.replace(/[^0-9-]/g, "");
  if (!safeSid) return false;
  for (let i = 0; i < 4; i++) {
    const po = await runPowerShell(
      `$p = Get-CimInstance Win32_UserProfile -Filter "SID='${safeSid}'" -ErrorAction SilentlyContinue; if ($p) { try { $path = $p.LocalPath; if (Test-Path -LiteralPath $path) { & cmd /c "rd /s /q \`"$path\`"" 2>$null }; if (Test-Path -LiteralPath $path) { throw 'profil masih ada' }; Remove-CimInstance -InputObject $p -ErrorAction SilentlyContinue; Write-Output 'removed' } catch { Write-Output $_.Exception.Message } } else { Write-Output 'removed' }`
    );
    if (po.includes("removed")) return true;
    await new Promise((res) => setTimeout(res, 1500));
  }
  return false;
}

// Sweep profil YATIM: hapus paksa SEMUA folder profil (C:\Users\*) yang SID-nya
// bukan milik user lokal yang masih ada (termasuk akun sistem) & bukan profil
// khusus (Public/Default/dll). Dipanggil di akhir Buat Akun supaya C:\Users bersih.
async function sweepOrphanProfiles(): Promise<string[]> {
  const lines: string[] = [];
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const ps = `
$curSids = @(Get-LocalUser | ForEach-Object { $_.SID.Value })
$skipPrefix = @('S-1-5-18','S-1-5-19','S-1-5-20','S-1-5-80')
Get-CimInstance Win32_UserProfile | Where-Object { -not $_.Special } | ForEach-Object {
  $sidTxt = [string]$_.SID
  if ($curSids -contains $sidTxt) { return }
  $svc = $false
  foreach ($s in $skipPrefix) { if ($sidTxt.StartsWith($s)) { $svc = $true } }
  if ($svc) { return }
  $path = $_.LocalPath
  $name = Split-Path -Path $path -Leaf
  try {
    if (Test-Path -LiteralPath $path) {
      & cmd /c "rd /s /q \`"$path\`"" 2>$null
    }
    if (Test-Path -LiteralPath $path) {
      Write-Output ("FAIL|" + $name + "|masih ada")
    } else {
      Remove-CimInstance -InputObject $_ -ErrorAction SilentlyContinue
      Write-Output ("OK|" + $name)
    }
  } catch {
    Write-Output ("FAIL|" + $name + "|" + $_.Exception.Message)
  }
}`;
      const out = await runPowerShell(ps);
      for (const row of out.split(/\r?\n/)) {
        if (/^(OK|FAIL)\|/.test(row)) lines.push(row);
      }
      const anyFail = lines.some((l) => l.startsWith("FAIL"));
      if (!anyFail) break;
      await new Promise((res) => setTimeout(res, 1500));
    } catch {
      break;
    }
  }
  return lines;
}

async function makeAdmin(username: string) {
  await addToGroup(username, "S-1-5-32-544", "Administrators");
}

// Logout SEMUA session interaktif (console + RDP) → layar login muncul,
// penyewa wajib login ulang dengan akun baru. Aman: skip session 0 (SYSTEM)
// dan skip session milik user yang menjalankan agent (biar agent tidak mati jika
// dijalankan manual dari sesi user).
async function logoffAllInteractive() {
  try {
    let me = "";
    try { me = (await sh("whoami")).out.trim().toLowerCase().split("\\").pop() || ""; } catch {}
    const out = (await sh("query session /format:csv 2>nul")).out;
    for (const line of out.split(/\r?\n/)) {
      if (!line.startsWith("\"")) continue;
      const f = line.replace(/\r/g, "").split(",");
      const session = (f[0] || "").replace(/"/g, "");
      const user = (f[1] || "").replace(/"/g, "").trim();
      const id = (f[2] || "").replace(/"/g, "").trim();
      const state = (f[3] || "").replace(/"/g, "").trim();
      if (!session || !/^\d+$/.test(id) || Number(id) === 0) continue;
      if (state === "Listen") continue;
      if (me && me !== "system" && user.toLowerCase() === me) continue;
      await sh(`logoff ${Number(id)} 2>nul`);
    }
  } catch {}
}

async function isMemberAdmin(name: string): Promise<boolean> {
  try {
    const out = await runPowerShell(
      `try { (Get-LocalGroupMember -Group (Get-LocalGroup -SID S-1-5-32-544) | Where-Object { $_.Name -match '${name.replace(/'/g, "''")}' }).Count } catch { '0' }`
    );
    const n = parseInt((out.trim().split(/\r?\n/).pop() || "0"), 10);
    return n > 0;
  } catch {
    return false;
  }
}

async function deleteUser(username: string) {
  log(`delete_user: ${username}`);
  if (IS_WIN) {
    let d = await sh(`net user "${username}" /delete`);
    if (!d.ok && !notFoundMsg(d.out)) {
      await endUserSessions(username);
      d = await sh(`net user "${username}" /delete`);
    }
    return d.ok || notFoundMsg(d.out)
      ? { ok: true, out: "user deleted" }
      : { ok: false, out: d.out.slice(0, 300) };
  }
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

// ─── TES KECEPATAN INTERNET (protokol speedtest.net / Ookla) ──
// Murni JS (fetch + node:net), tanpa dependency native → aman di-bundle jadi .exe.
// Alur: ambil daftar server Ookla (engine=js) → pilih yang terjangkau → ukur
// ping (TCP RTT), download (file uji Ookla), upload (POST ke upload.php).
type NetResult = { downloadMbps: number; uploadMbps: number; pingMs: number; testedAt: string };
const NET_CACHE = existsSync(join(EXE_DIR, "speed.json")) ? join(EXE_DIR, "speed.json") : join(process.cwd(), "speed.json");
// Tes ulang otomatis tiap 12 jam + jitter acak (±30 menit) per unit, supaya kalau
// PC sudah banyak speedtest tidak jalan bareng-bareng (tidak membebani server/server Ookla).
const SPEED_INTERVAL_MS = 12 * 60 * 60 * 1000;
const SPEED_JITTER_MS = Math.floor(Math.random() * 30 * 60 * 1000);
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0";
let netState: NetResult | null = loadNetState();
let netBusy = false;

function loadNetState(): NetResult | null {
  try {
    if (existsSync(NET_CACHE)) {
      const j = JSON.parse(readFileSync(NET_CACHE, "utf8"));
      if (j && typeof j.downloadMbps === "number") return j as NetResult;
    }
  } catch {}
  return null;
}

function saveNetState(r: NetResult) {
  try { writeFileSync(NET_CACHE, JSON.stringify(r)); } catch {}
}

function netBodyNet(): Record<string, unknown> {
  if (!netState) return {};
  return {
    netDownloadMbps: netState.downloadMbps,
    netUploadMbps: netState.uploadMbps,
    netPingMs: netState.pingMs,
    netTestedAt: netState.testedAt,
  };
}

async function fetchOoklaServers(): Promise<{ url: string; host: string; name: string }[]> {
  try {
    const r = await fetch("https://www.speedtest.net/api/js/servers?engine=js&limit=8", { headers: { "User-Agent": UA } });
    if (!r.ok) return [];
    const list = (await r.json()) as { url?: string; host?: string; name?: string }[];
    return list
      .map((s) => ({ url: s.url || "", host: s.host || "", name: s.name || "Ookla" }))
      .filter((s) => /^https?:\/\//i.test(s.url));
  } catch {
    return [];
  }
}

function parseNetHost(h: string): { host: string; port: number } {
  const i = h.lastIndexOf(":");
  if (i > 0) {
    const p = parseInt(h.slice(i + 1), 10);
    if (p > 0) return { host: h.slice(0, i), port: p };
  }
  return { host: h, port: 80 };
}

function measurePingMs(host: string, port: number): Promise<number> {
  return new Promise((res) => {
    const t0 = performance.now();
    const s = connect(port, host);
    const done = (v: number) => { try { s.destroy(); } catch {} res(v); };
    const to = setTimeout(() => done(0), 4000);
    s.setTimeout(4000, () => done(0));
    s.once("connect", () => { clearTimeout(to); done(performance.now() - t0); });
    s.once("error", () => { clearTimeout(to); done(0); });
  });
}

async function fetchBytes(url: string, timeoutMs: number): Promise<{ bytes: number; ms: number } | null> {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const t0 = performance.now();
    const r = await fetch(url, { signal: ctrl.signal, headers: { "User-Agent": UA } });
    if (!r.ok || !r.body) return null;
    let bytes = 0;
    try {
      const reader = r.body.getReader();
      for (;;) { const { done, value } = await reader.read(); if (done) break; bytes += value.length; }
    } catch {}
    return { bytes, ms: performance.now() - t0 };
  } catch {
    return null;
  } finally {
    clearTimeout(to);
  }
}

async function doNetDownload(baseUrl: string): Promise<number> {
  let best = 0;
  const deadline = Date.now() + 25000;
  for (const n of [1000, 2500, 3500, 5000]) {
    if (Date.now() > deadline) break;
    const url = baseUrl.replace(/\/[^/]*$/, `/random${n}x${n}.jpg`);
    const r = await fetchBytes(url, 20000);
    if (r && r.ms >= 300) best = Math.max(best, (r.bytes * 8 * 1000) / 1e6 / r.ms);
  }
  return Math.round(best * 10) / 10;
}

async function doNetUpload(url: string): Promise<number> {
  let best = 0;
  const deadline = Date.now() + 20000;
  for (const mb of [0.5, 1, 2, 4, 8, 16, 32]) {
    if (Date.now() > deadline) break;
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 20000);
    try {
      const buf = new Uint8Array(Math.floor(mb * 1024 * 1024)).fill(7);
      const t0 = performance.now();
      const r = await fetch(url, {
        method: "POST",
        body: buf,
        signal: ctrl.signal,
        headers: { "User-Agent": UA, "Content-Type": "application/octet-stream" },
      });
      const ms = performance.now() - t0;
      if (r.ok && ms >= 200) best = Math.max(best, (buf.length * 8 * 1000) / 1e6 / ms);
    } catch {}
    finally { clearTimeout(to); }
  }
  return Math.round(best * 10) / 10;
}

async function runSpeedTest() {
  if (netBusy) return;
  netBusy = true;
  try {
    log("tes kecepatan internet (speedtest.net) dimulai...");
    const servers = await fetchOoklaServers();
    let srv: { url: string; host: string; name: string } | null = null;
    let ping = 0;
    for (const s of servers.slice(0, 6)) {
      const hp = parseNetHost(s.host || `${new URL(s.url).hostname}:8080`);
      const pings: number[] = [];
      for (let i = 0; i < 5; i++) { const p = await measurePingMs(hp.host, hp.port); if (p > 0) pings.push(p); }
      if (pings.length) {
        pings.sort((a, b) => a - b);
        ping = pings[Math.floor((pings.length - 1) / 2)];
        srv = s;
        break;
      }
    }
    if (!srv || !ping) { log("tes kecepatan: tidak ada server Ookla yang terjangkau."); return; }
    const dl = await doNetDownload(srv.url);
    const ul = await doNetUpload(srv.url);
    netState = { downloadMbps: dl, uploadMbps: ul, pingMs: Math.round(ping * 10) / 10, testedAt: new Date().toISOString() };
    saveNetState(netState);
    log(`kecepatan internet: ${dl}↓ / ${ul}↑ Mbps • ping ${Math.round(ping)}ms (${srv.name})`);
  } catch (e) {
    log(`tes kecepatan gagal: ${String(e).slice(0, 120)}`);
  } finally {
    netBusy = false;
  }
}

function maybeSpeedTest() {
  if (netBusy) return;
  if (netState && Date.now() - new Date(netState.testedAt).getTime() < SPEED_INTERVAL_MS + SPEED_JITTER_MS) return;
  void runSpeedTest();
}

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
    body: JSON.stringify({ ...detectedSpecs, ...netBodyNet() }),
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

  // Tes kecepatan internet (satu kali saat boot, lalu tiap 6 jam) — background
  maybeSpeedTest();

  // Poll tasks
  try {
    const r = await apiCall(cfg, "/api/agent/tasks");
    const j = await r.json().catch(() => ({}));
    const tasks = (j.tasks || []) as { id: string; type: string; payload_json: string }[];

    // Self-heal tiap loop: pastikan tidak ada instance agent versi LAWAS yang masih
    // hidup & ikut mengeksekusi task (biar logika terbaru yang selalu jalan).
    await cleanupOldAgents();

    for (const t of tasks) {
      log(`task: ${t.type} (${t.id.slice(0, 8)})`);
      let res = { ok: true, out: "ok" };
      try {
        const p = JSON.parse(t.payload_json || "{}");
        // Timeout keamanan: kalau eksekusi kepalang lama (mis. hapus folder profil besar),
        // post hasilnya supaya task tidak menggantung di "sedang diproses" selamanya.
        const done = await Promise.race([
          (async () => {
            if (t.type === "create_user") return await createUser(p.username, p.password);
            if (t.type === "delete_user") return await deleteUser(p.username);
            if (t.type === "restart") {
              setTimeout(() => sh(IS_WIN ? "shutdown /r /t 5" : "reboot"), 2000);
              return { ok: true, out: "restarting..." };
            }
            if (t.type === "shutdown") {
              setTimeout(() => sh(IS_WIN ? "shutdown /s /t 5" : "poweroff"), 2000);
              return { ok: true, out: "shutting down..." };
            }
            return { ok: true, out: "unknown task" };
          })(),
          new Promise<{ ok: boolean; out: string }>((resolve) =>
            setTimeout(() => resolve({ ok: false, out: "WAKTU HABIS (240s) — proses mungkin masih berjalan di latar belakang" }), 240000)
          ),
        ]);
        res = done;
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

// Cek apakah proses berjalan sebagai Administrator (Windows).
async function isWindowsAdmin(): Promise<boolean> {
  try {
    const r = await runExe(["powershell", "-NoProfile", "-Command", "([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)"]);
    return r.out.trim() === "True";
  } catch {
    return false;
  }
}

async function schtasksHas(name: string): Promise<boolean> {
  return (await runExe(["schtasks", "/query", "/tn", name])).ok;
}

// Tulis ulang mechanisme: buat task BOOT + Watchdog (SYSTEM) langsung kalau admin,
// atau sekali lewat UAC (pop-up) kalau bukan admin — lalu POLLING sampai task benar-benar
// muncul (dulu cukup 2,5dtk sehingga gampang false-negative). Kalau sama sekali gagal,
// fallback ke auto-start saat login (HKCU\...\Run) agar agent tetap ikut start.
async function createWindowsAutoStart(): Promise<{ bootOk: boolean; watchOk: boolean; mode: "system" | "user" | "none" }> {
  const exePath = process.execPath;
  const WATCH = join(EXE_DIR, "rentalrdp-agent-watchdog.bat");
  const TASK_BOOT = "rentalrdp-agent";
  const TASK_WATCH = "rentalrdp-agent-watchdog";

  // 1) Bersihkan mekanisme lama (sumber jendela/UAC berlebih): Registry Run key + task.
  await runExe(["reg", "delete", "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run", "/v", "rentalrdp-agent", "/f"]);
  await runExe(["schtasks", "/delete", "/tn", TASK_BOOT, "/f"]);
  await runExe(["schtasks", "/delete", "/tn", TASK_WATCH, "/f"]);

  // 2) Watchdog.bat — restart agent kalau mati (proteksi anti di-stop penyewa).
  try {
    writeFileSync(WATCH, `@echo off\r\nsetlocal\r\npowershell -NoProfile -ExecutionPolicy Bypass -Command "if (-not (Get-Process -Name '${PROC_BASE}' -ErrorAction SilentlyContinue)) { Start-Process -FilePath '%~dp0${AGENT_EXE_NAME}' -ArgumentList '--silent' -WindowStyle Hidden }"\r\n`, "utf8");
  } catch {}

  const tr = `"${exePath}" --silent`;
  const trWatch = `"${WATCH}"`;

  // 3) Buat task BOOT + Watchdog sebagai SYSTEM (jalan sebelum login, anti-stop).
  if (await isWindowsAdmin()) {
    // Sudah admin → buat langsung, tanpa UAC.
    await runExe(["schtasks", "/create", "/tn", TASK_BOOT, "/tr", tr, "/sc", "onstart", "/ru", "SYSTEM", "/rl", "highest", "/f"]);
    await runExe(["schtasks", "/create", "/tn", TASK_WATCH, "/tr", trWatch, "/sc", "minute", "/mo", "1", "/ru", "SYSTEM", "/rl", "highest", "/f"]);
  } else {
    // Bukan admin → minta konfirmasi UAC SEKALI untuk membuat kedua task,
    // lalu tunggu sampai task-nya benar-benar muncul (UAC + create butuh beberapa detik).
    let psFile = "";
    if (process.env.RENTALRDP_NO_ELEVATE !== "1") {
      console.log("  Akan muncul pop-up UAC (User Account Control) — klik \u201cYa\u201d / \u201cYes\u201d.\n");
      psFile = join(EXE_DIR, ".rentalrdp-install.ps1");
      try {
        writeFileSync(psFile,
          `schtasks /create /tn "${TASK_BOOT}" /tr "${tr}" /sc onstart /ru SYSTEM /rl highest /f\r\n` +
          `schtasks /create /tn "${TASK_WATCH}" /tr "${trWatch}" /sc minute /mo 1 /ru SYSTEM /rl highest /f\r\n`,
          "utf8");
        await runExe(["powershell", "-NoProfile", "-Command", `Start-Process powershell -Verb RunAs -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File','"${psFile}"' -WindowStyle Hidden`]);
      } catch {}
    }
    // Polling sampai task muncul (atau timeout 20 detik).
    const end = Date.now() + 20000;
    while (Date.now() < end) {
      if ((await schtasksHas(TASK_BOOT)) && (await schtasksHas(TASK_WATCH))) break;
      await Bun.sleep(700);
    }
    if (psFile) { try { unlinkSync(psFile); } catch {} }
  }

  const bootOk = await schtasksHas(TASK_BOOT);
  const watchOk = await schtasksHas(TASK_WATCH);
  let mode: "system" | "user" | "none" = "none";

  if (bootOk) { mode = "system"; log("Auto-start OK: task BOOT SYSTEM (background, anti-stop)."); }
  if (watchOk) log("Watchdog OK: auto-restart tiap 1 menit kalau agent mati.");

  // 4) Sama sekali tidak dapat izin admin / UAC ditolak → fallback auto-start saat login.
  if (!bootOk && !watchOk) {
    const r = await runExe(["reg", "add", "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run", "/v", "rentalrdp-agent", "/d", `"${exePath}" --silent`, "/f"]);
    if (r.ok) {
      mode = "user";
      log(`Auto-start (login, non-admin) AKTIF — tanpa proteksi SYSTEM. Untuk proteksi penuh anti-stop: jalankan ${AGENT_EXE_NAME} sebagai ADMINISTRATOR (klik kanan → Run as administrator → pilih 1).`);
    } else {
      log(`⚠️ Auto-start GAGAL. Jalankan ${AGENT_EXE_NAME} sebagai ADMINISTRATOR (klik kanan → Run as administrator → pilih 1).`);
    }
  }

  return { bootOk, watchOk, mode };
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

// Cek apakah task BOOT menunjuk exe yang sama dengan lokasi agent sekarang
// (kalau tidak, task lama menunjuk path lama → perlu dibuat ulang saat migrasi folder).
async function bootTaskMatchesCurrent(): Promise<boolean> {
  try {
    const xml = (await runExe(["schtasks", "/query", "/tn", "rentalrdp-agent", "/xml"])).out;
    if (!xml.trim()) return false; // task tidak ada
    return xml.toLowerCase().includes((process.execPath || "").toLowerCase());
  } catch {
    return false;
  }
}

async function autoInstall() {
  if (IS_WIN) {
    // Sudah terpasang dengan task BOOT → jangan pasang ulang (hindari pop-up UAC tiap boot).
    const hasBoot = (await runExe(["schtasks", "/query", "/tn", "rentalrdp-agent"])).ok;
    const cfg = loadConfig();
    if (cfg.autostart && hasBoot) {
      // Task ada tapi menunjuk lokasi lama (exe pernah dipindah ke ProgramData\agent)?
      if (await bootTaskMatchesCurrent()) return;
      log("Task auto-start masih menunjuk lokasi lama — memperbarui ke " + process.execPath);
    }
    const wasAuto = cfg.autostart;
    const { mode } = await createWindowsAutoStart();
    if (mode !== "none" && !wasAuto) setConfigFlag("autostart", true);
    return;
  }
  if (loadConfig().autostart) return;
  const service = `[Unit]
Description=Rental PC by Miriprian Agent
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

async function syncAutoStartPath() {
  if (!IS_WIN) return;
  const cfg = loadConfig();
  if (!cfg.autostart) return;
  const WATCH = join(EXE_DIR, "rentalrdp-agent-watchdog.bat");
  // watchdog.bat menunjuk nama exe runtime — bisa berubah saat update rename file.
  try {
    writeFileSync(WATCH, `@echo off\r\nsetlocal\r\npowershell -NoProfile -ExecutionPolicy Bypass -Command "if (-not (Get-Process -Name '${PROC_BASE}' -ErrorAction SilentlyContinue)) { Start-Process -FilePath '%~dp0${AGENT_EXE_NAME}' -ArgumentList '--silent' -WindowStyle Hidden }"\r\n`, "utf8");
  } catch {}
  const hasBoot = await schtasksHas("rentalrdp-agent");
  if (hasBoot) {
    if (await bootTaskMatchesCurrent()) return;
    // Task lama menunjuk exe lama → perbarui ke exe sekarang (kalau bukan admin, skip diam-diam;
    // watchdog tetap pakai nama baru sehingga recovery tetap jalan).
    await runExe(["schtasks", "/create", "/tn", "rentalrdp-agent", "/tr", `"${process.execPath}" --silent`, "/sc", "onstart", "/ru", "SYSTEM", "/rl", "highest", "/f"]);
    await runExe(["schtasks", "/create", "/tn", "rentalrdp-agent-watchdog", "/tr", `"${WATCH}"`, "/sc", "minute", "/mo", "1", "/ru", "SYSTEM", "/rl", "highest", "/f"]);
  } else {
    // Fallback login (non-admin): perbarui HKCU Run ke exe sekarang.
    await runExe(["reg", "add", "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run", "/v", "rentalrdp-agent", "/d", `"${process.execPath}" --silent`, "/f"]);
  }
}

// ─── MENU INSTALLER INTERAKTIF ───────────────────────────────
// Menu minimal; console TETAP TERBUKA sampai user memilih Keluar.
// Update bersifat MANUAL (menu 2 cuma unduh exe baru; proses lama hanya berhenti
// saat terminalnya ditutup). Tidak ada opsi stop / uninstall / reset — supaya
// penyewa/hacker tak bisa mematikan agent dan memakai RDP gratis tanpa terhitung waktu.
async function interactiveMenu(): Promise<"run" | "exit"> {
  const cfgNow = loadConfig();
  const configured = !!(cfgNow.api && cfgNow.token);
  console.log(`
┌──────────────────────────────────────────────────────────┐
│ Rental PC by Miriprian — Agent                             │
├──────────────────────────────────────────────────────────┤
│  File         : ${AGENT_EXE_NAME}
│  Versi        : v${VERSION}
│  Server       : ${configured ? cfgNow.api : "(belum diisi)"}
│  Auto-start   : ${cfgNow.autostart ? "AKTIF (BOOT + watchdog)" : "nonaktif"}
└──────────────────────────────────────────────────────────┘
`);
  while (true) {
    console.log(`
  1)  Install / Ganti Token  (server URL + token + auto-start)
  2)  Update Agent           (unduh exe terbaru di folder ini → jalankan manual → menu 1 hapus versi lama)
  3)  Keluar
`);
    const ans = ((await prompt("  Pilih [1/2/3], Enter = 1 : ")) || "1").trim();
    switch (ans) {
      case "1": {
        const c2 = await wizard();
        if (!c2.api || !c2.token) {
          console.log("  Setup tidak lengkap → coba lagi.\n");
          continue;
        }
        await autoInstall();
        // Pastikan boot task / watchdog menunjuk exe SEKARANG, lalu bersihkan exe versi lama.
        await syncAutoStartPath();
        await cleanupOldAgents();
        console.log("");
        const runNow = await prompt("  Jalankan agent sekarang? (Y/n): ");
        if (runNow?.toLowerCase() !== "n") return "run";
        continue;
      }
      case "2": {
        await checkAndUpdate(loadConfig(), true);
        console.log("");
        continue;
      }
      case "3":
      case "q":
      case "x":
      case "0":
        return "exit";
      default:
        console.log("  Pilihan tidak dikenal.\n");
    }
  }
}

// ─── MAIN ─────────────────────────────────────────────────────
const args = process.argv.slice(2);
const SILENT = args.includes("--silent") || args.includes("-s");
if (SILENT) hideConsole();

// Bersihkan sisa update lama (folder .update & file .new dari versi terdahulu).
try { rmSync(join(EXE_DIR, ".update"), { recursive: true, force: true }); } catch {}
try { rmSync(process.execPath + ".new", { force: true }); } catch {}

if (args.includes("--version") || args.includes("-v")) {
  console.log(`${AGENT_EXE_NAME} v${VERSION}`);
  process.exit(0);
}

if (args.includes("--install") || args.includes("-i")) {
  await autoInstall();
  process.exit(0);
}

// Catatan keamanan: tanpa --uninstall. Agent hanya berhenti manual (tutup terminal atau
// Ctrl+C di jendelanya). Supaya agent tak bisa dimatikan diam-diam penyewa/hacker demi RDP gratis.

if (args.includes("--update")) {
  await checkAndUpdate(loadConfig(), true);
  process.exit(0);
}

let cfg: Config;
if (SILENT) {
  cfg = loadConfig();
} else {
  const choice = await interactiveMenu();
  if (choice !== "run") process.exit(0);
  cfg = loadConfig();
}

if (!cfg.api || !cfg.token) {
  console.log("\n  Config belum diisi. Jalankan exe → menu → 1 (Install / Ganti Token).\n");
  process.exit(1);
}

console.log(`
╔══════════════════════════════════════════════════╗
║  Rental PC by Miriprian — Agent                  ║
║  File  : ${AGENT_EXE_NAME.padEnd(38).slice(0, 38)}║
║  Versi : v${VERSION.padEnd(38).slice(0, 38)}║
║  Host  : ${HOSTNAME.padEnd(38).slice(0, 38)}║
║  API   : ${cfg.api.slice(0, 38).padEnd(38)}║
║  Mode  : ${(IS_WIN ? "Windows (RDP)" : "Linux (SSH)").padEnd(38)}║
║  Poll  : ${("setiap " + cfg.interval + " detik").padEnd(38)}║
╠══════════════════════════════════════════════════╣
║  Ctrl+C untuk berhenti.                          ║
╚══════════════════════════════════════════════════╝
`);

loop(cfg);
// Nama file bisa berubah saat update (rename ke versi terbaru) → samakan lagi
// boot task / watchdog / HKCU Run biar tetap menunjuk exe yang sekarang.
await syncAutoStartPath();
// Self-heal: setiap kali agent versi terbaru jalan, exe versi lama di folder yang sama
// (yang biasanya terkunci oleh instance boot task/watchdog) dibunuh & dihapus.
await cleanupOldAgents();
// Self-heal profil: setiap boot, folder profil yatim (C:\Users) dibersihkan pelan-pelan
// tanpa memblokir apa-apa — sisa obake/rent_ lama pasti hilang cepat atau lambat.
sweepOrphanProfiles().catch(() => {});
setInterval(() => loop(cfg), cfg.interval * 1000);
