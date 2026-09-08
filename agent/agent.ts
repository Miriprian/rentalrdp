#!/usr/bin/env bun
/**
 * rentalrdp.com — Bare Metal Agent
 * Jalan di tiap PC fisik (Windows / Linux) yang disewakan.
 * Tugas: polling /api/agent/tasks lalu eksekusi create_user / delete_user / restart / shutdown.
 *
 * Cara pakai:
 *   bun run agent --api http://SERVER:3000 --token TOKEN_DARI_DASHBOARD
 *   (atau) bun run agent/agent.ts --api ... --token ...
 *
 * Butuh hak admin/root untuk buat user OS beneran.
 * Jika bukan admin, agent tetap jalan dalam mode SIMULASI (log saja) agar bisa dites.
 */
const args: Record<string, string> = {};
for (let i = 2; i < process.argv.length; i += 2) {
  const k = process.argv[i]?.replace(/^--/, "");
  const v = process.argv[i + 1] ?? "";
  if (k) args[k] = v;
}
const API = (args.api || process.env.AGENT_API || "http://localhost:3000").replace(/\/$/, "");
const TOKEN = args.token || process.env.AGENT_TOKEN || "";
const INTERVAL = Number(args.interval || process.env.AGENT_INTERVAL || 15) * 1000;
const HOSTNAME = (await import("node:os")).hostname();

if (!TOKEN) {
  console.error("❌ --token wajib. Ambil dari Dashboard Admin > Kelola PC > Token Agent.");
  process.exit(1);
}

console.log(`🤖 rentalrdp agent @ ${HOSTNAME}\n   API: ${API}\n   interval: ${INTERVAL / 1000}s`);

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

// ─── Deteksi spek real PC ─────────────────────────────────────
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
  $o.storageGb = if ($t) { [math]::Round($t) } else { [math]::Round((Get-CimInstance Win32_DiskDrive | Measure-Object Size -Sum).Sum / 1GB) }
} catch {}
try { $o.os = ((Get-CimInstance Win32_OperatingSystem | Select-Object -First 1).Caption) } catch {}
$o | ConvertTo-Json -Compress -Depth 5
`;

async function detectSpecs() {
  const specs = { cpu: "", gpu: "", ramGb: 0, storageGb: 0, os: "", storageType: "SSD", motherboard: "", ramType: "", gpuVramGb: 0, cpuCores: 0, cpuThreads: 0, cpuMaxGhz: 0, ramModules: [] as unknown[], disks: [] as unknown[] };
  try {
    if (IS_WIN) {
      const { writeFileSync, unlinkSync } = await import("node:fs");
      const { join } = await import("node:path");
      const tmp = join(process.cwd(), ".specs.ps1");
      writeFileSync(tmp, WIN_SPEC_PS1, "utf8");
      const r = await sh(`powershell -NoProfile -ExecutionPolicy Bypass -File "${tmp}"`);
      try { unlinkSync(tmp); } catch {}
      const m = r.out.match(/\{.*\}/s);
      if (m) {
        const j = JSON.parse(m[0]);
        specs.cpu = String(j.cpu || "").trim();
        specs.gpu = String(j.gpu || "").trim();
        specs.ramGb = Math.round(Number(j.ramGb || 0));
        specs.storageGb = Math.round(Number(j.storageGb || 0));
        specs.os = String(j.os || "").trim();
        specs.storageType = String(j.storageType || "SSD").trim();
        specs.motherboard = String(j.motherboard || "").trim();
        specs.ramType = String(j.ramType || "").trim();
        specs.gpuVramGb = Math.round(Number(j.gpuVramGb || 0));
        specs.cpuCores = Math.round(Number(j.cpuCores || 0));
        specs.cpuThreads = Math.round(Number(j.cpuThreads || 0));
        specs.cpuMaxGhz = Math.round(Number(j.cpuMaxGhz || 0) * 10) / 10;
        specs.ramModules = Array.isArray(j.ramModules) ? j.ramModules : [];
        specs.disks = Array.isArray(j.disks) ? j.disks : [];
      }
    } else {
      const cpuR = await sh(`lscpu | grep -m1 "Model name" | sed 's/.*://'`);
      const gpuR = await sh(`lspci | grep -Ei "vga|3d" | head -1 | sed 's/.*: //'`);
      const ramR = await sh(`awk '/MemTotal/{printf "%d", $2/1024/1024}' /proc/meminfo`);
      const diskR = await sh(`df -BG --total / | awk '/total/{print int($2)}'`);
      const osR = await sh(`. /etc/os-release && echo "$PRETTY_NAME"`);
      const mbR = await sh(`cat /sys/class/dmi/id/board_vendor /sys/class/dmi/id/board_name 2>/dev/null | tr '\\n' ' '`);
      specs.cpu = cpuR.out.trim() || "";
      specs.gpu = gpuR.out.trim() || "";
      specs.ramGb = Math.round(Number(ramR.out.trim()) || 0);
      specs.storageGb = Math.round(Number(diskR.out.trim()) || 0);
      specs.os = osR.out.trim() || "";
      specs.motherboard = mbR.out.trim();
    }
  } catch {}
  return specs;
}

async function createUser(username: string, password: string) {
  console.log(`[agent] create_user ${username} @ ${process.platform}`);
  if (IS_WIN) {
    let r = await sh(`net user ${username} ${password} /add`);
    if (!r.ok && r.out.includes("sudah ada")) {
      await sh(`net user ${username} ${password}`);
      r = { ok: true, out: "password reset" };
    }
    if (r.ok) {
      await sh(`net localgroup "Remote Desktop Users" ${username} /add`);
      await sh(`net user ${username} /active:yes`);
    }
    return r;
  } else {
    let r = await sh(`sudo useradd -m -s /bin/bash ${username}`);
    if (r.ok || r.out.includes("already exists")) {
      const r2 = await sh(`sh -c "echo '${username}:${password}' | sudo chpasswd"`);
      return r2.ok ? { ok: true, out: "user ready" } : r2;
    }
    return r;
  }
}

async function deleteUser(username: string) {
  const plat = process.platform;
  console.log(`[agent] delete_user ${username}`);
  if (plat === "win32") return await sh(`net user ${username} /delete`);
  return await sh(`sudo userdel -r ${username}`);
}

async function loop() {
  try {
    const s = await detectSpecs();
    const hwKeys = ["ramType", "gpuVramGb", "cpuCores", "cpuThreads", "cpuMaxGhz", "ramModules", "disks"] as const;
    const hw: Record<string, unknown> = {};
    for (const k of hwKeys) {
      hw[k] = s[k];
      delete s[k];
    }
    const specs = { ...s, hw, hostname: HOSTNAME, platform: process.platform };
    await fetch(`${API}/api/agent/heartbeat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-agent-token": TOKEN },
      body: JSON.stringify(specs),
    });
  } catch (e) {
    console.warn("[agent] heartbeat gagal:", String(e).slice(0, 120));
  }
  try {
    const r = await fetch(`${API}/api/agent/tasks`, { headers: { "x-agent-token": TOKEN } });
    const j = await r.json().catch(() => ({}));
    const tasks = (j.tasks || []) as { id: string; type: string; payload_json: string }[];
    for (const t of tasks) {
      console.log(`[agent] task ${t.type} ${t.id}`);
      let res = { ok: true, out: "ok" };
      try {
        const p = JSON.parse(t.payload_json || "{}");
        if (t.type === "create_user") res = await createUser(p.username, p.password);
        else if (t.type === "delete_user") res = await deleteUser(p.username);
        else if (t.type === "restart") { res = { ok: true, out: "restart scheduled" }; setTimeout(() => sh(process.platform === "win32" ? "shutdown /r /t 5" : "sudo reboot"), 2000); }
        else if (t.type === "shutdown") { res = { ok: true, out: "shutdown scheduled" }; setTimeout(() => sh(process.platform === "win32" ? "shutdown /s /t 5" : "sudo poweroff"), 2000); }
        else res = { ok: true, out: "unknown task type — skipped" };
      } catch (e) {
        res = { ok: false, out: String(e).slice(0, 500) };
      }
      await fetch(`${API}/api/agent/tasks/${t.id}/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-agent-token": TOKEN },
        body: JSON.stringify({ ok: res.ok, result: res.out }),
      });
      console.log(`[agent] done ${t.id}: ${res.ok ? "OK" : "FAIL"}`);
    }
  } catch (e) {
    console.warn("[agent] poll gagal:", String(e).slice(0, 120));
  }
}

await loop();
setInterval(loop, INTERVAL);
