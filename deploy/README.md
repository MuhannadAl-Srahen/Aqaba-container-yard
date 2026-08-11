# Deploying the yard

The production server is a Windows machine at the office. The whole
deployment is the `AqabaYard-Setup` folder:

```
AqabaYard-Setup/
  install.ps1     ← one-shot installer / updater (run as Administrator)
  اقرأني.txt      ← the owner's Arabic instructions
  الأوامر.txt     ← paste-ready commands (opens in Notepad on the target)
  app/
    src/          ← server + shared source (runs under tsx)
    dist/         ← the PRE-BUILT client (bun run build before packaging)
    node_modules/ ← the PRODUCTION runtime, shipped (npm --omit=dev)
    package.json
```

`node_modules` rides in the package on purpose. Installing used to run `npm
install` on the target, which is the slowest and most fragile step there is —
it needs the internet, it can hang on a slow registry, and it made the office
sit watching a stalled window. Shipping it makes the install offline and
instant; the installer only falls back to npm if the folder arrives without
it (which means half a copy).

To cut a new setup package from this repo:

```powershell
bun run build
$pkg = "$env:USERPROFILE\Desktop\AqabaYard-Setup"
Remove-Item -Recurse -Force $pkg -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force "$pkg\app" | Out-Null
Copy-Item -Recurse src, dist, package.json "$pkg\app\"
Copy-Item deploy\install.ps1, "deploy\اقرأني.txt", "deploy\الأوامر.txt" $pkg\

# The production runtime, built in a scratch folder so the repo's dev tree is
# never shipped by accident.
$mods = "$env:TEMP\yard-prod-modules"
Remove-Item -Recurse -Force $mods -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force $mods | Out-Null
Copy-Item package.json "$mods\package.json"
Push-Location $mods; npm install --omit=dev --no-audit --no-fund --loglevel=error; Pop-Location
robocopy "$mods\node_modules" "$pkg\app\node_modules" /MIR /NFL /NDL /NJH /NJS | Out-Null

Compress-Archive -Path $pkg -DestinationPath "$env:USERPROFILE\Desktop\AqabaYard-Setup.zip" -Force
```

What the installer sets up on the target machine:

- Node.js 24 (needed for `node:sqlite`) — downloaded silently if missing.
- The app at `C:\AqabaYard\app`, DATA OUTSIDE IT at `C:\AqabaYard\data`
  (`yard.db` + `backups/`), logs at `C:\AqabaYard\logs\server.log`.
- `npm install --omit=dev` — tsx is a production dependency so the service
  runs TypeScript directly; the client is pre-built so no build tools are
  ever needed on the server.
- A Scheduled Task `AqabaYard` (SYSTEM, at startup, auto-restart) running
  `start-yard.cmd` → port 8787.
- A firewall rule for LAN access, and Tailscale for the public HTTPS link:
  `tailscale up` once, then `tailscale funnel --bg 8787` — the printed
  `https://<machine>.<tailnet>.ts.net` URL is the yard's permanent address.
- PDF export uses the machine's own Edge — preinstalled on Windows.

Re-running `install.ps1` is the update path: it mirrors `app/` and never
touches `data/`.
