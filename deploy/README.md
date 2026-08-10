# Deploying the yard

The production server is a Windows machine at the office. The whole
deployment is the `AqabaYard-Setup` folder:

```
AqabaYard-Setup/
  install.ps1     ← one-shot installer / updater (run as Administrator)
  اقرأني.txt      ← the owner's Arabic instructions
  app/
    src/          ← server + shared source (runs under tsx)
    dist/         ← the PRE-BUILT client (bun run build before packaging)
    package.json
```

To cut a new setup package from this repo:

```powershell
bun run build
$pkg = "$env:USERPROFILE\Desktop\AqabaYard-Setup"
Remove-Item -Recurse -Force $pkg -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force "$pkg\app" | Out-Null
Copy-Item -Recurse src, dist, package.json "$pkg\app\"
Copy-Item deploy\install.ps1, "deploy\اقرأني.txt" $pkg\
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
