# Deploying the Playground for the GitHub Pages demo

The [Playground](frontend/) is a single-page app: FastAPI backend + React
frontend. GitHub Pages only serves static files, so the frontend is built and
published there, but it needs a real backend somewhere to talk to. This repo
runs that backend on a small always-free cloud VM.

## Architecture

```
GitHub Pages (static)                 Your VM (Oracle Cloud Free Tier)
https://wilkiyoshi.github.io/            https://<ip>.nip.io
matriAIx_teste/playground/    ────►      Caddy (HTTPS) → uvicorn :8765
(built with VITE_API_BASE_URL)           (FastAPI backend, systemd service)
```

The frontend build bakes the backend's URL in at build time
(`VITE_API_BASE_URL`, see `vite.config.ts` and `src/lib/api.ts`). The backend
allows that origin via CORS (`MATRIX_EXTRA_CORS_ORIGINS`, see
`backend/api/app.py`).

**No provider API key lives on the server.** Each person testing the
Playground pastes their own Anthropic key into the Settings popover (top bar,
key icon) — it's stored in their browser only and sent as a request header,
forwarded straight into that one job's subprocess env. See
`frontend/src/lib/anthropicApiKey.ts` and
`frontend/src/components/ApiKeySettingsPopover.tsx`.

## One-time server setup

1. Provision an Ubuntu VM with a public IP and port 22 reachable (any cloud
   works; this was written against Oracle Cloud's Always Free
   `VM.Standard.E2.1.Micro`/`VM.Standard.A1.Flex` shapes). Open ports 80 and
   443 in whatever security group / security list fronts the VM.
2. SSH in and run the setup script:
   ```bash
   curl -fsSL https://raw.githubusercontent.com/wilkiyoshi/matriAIx_teste/main/application/playground/deploy/oracle-vm-setup.sh \
     | sudo REPO_BRANCH=main bash
   ```
   It installs Python/uv, Caddy, clones this repo, installs the backend's
   deps, and runs it as the `matraix-playground` systemd service behind Caddy
   with a Let's Encrypt certificate for `<public-ip>.nip.io`. Full detail and
   every step it takes: `deploy/oracle-vm-setup.sh`.
3. Confirm it's up: `curl https://<public-ip>.nip.io/api/health` → `{"status":"ok"}`.
4. In the GitHub repo, set the **`PLAYGROUND_API_BASE_URL`** repository
   variable (Settings → Secrets and variables → Actions → Variables) to
   `https://<public-ip>.nip.io`. `.github/workflows/gh-pages.yml` reads it at
   build time; without it, the workflow falls back to whatever IP is hardcoded
   there.
5. Push to `main` (or re-run the `Deploy Handbook to GitHub Pages` workflow) —
   it rebuilds the frontend against that backend and publishes it under
   `/playground/` on the Pages site.

## Redeploying after a code change

```bash
ssh ubuntu@<public-ip>
sudo -u matraix bash -lc 'cd /opt/matriaix && git pull && export PATH=$HOME/.local/bin:$PATH && uv sync'
sudo systemctl restart matraix-playground
```

## Scope of this deployment

The VM runs the backend host-native (Survey and Chat agents — no Docker
needed for those). It does **not** install Docker, so Web and OS-app tasks
(which run inside Harbor-launched containers) won't work through this public
demo; those still require the full local `docker`-based setup from
[`docs/quickstart.md`](../../docs/quickstart.md). A `VM.Standard.A1.Flex`
instance with Docker installed can run those too — see the setup script's
comments for what to add.

## Troubleshooting

| Symptom | Check |
|---|---|
| `https://<ip>.nip.io` doesn't load at all | `journalctl -u caddy -n 100 --no-pager` — usually a firewall (OS iptables or the cloud security list) blocking 80/443 |
| Loads but `/api/health` 502s | `journalctl -u matraix-playground -n 100 --no-pager` |
| Frontend loads but every API call fails in the browser console with a CORS error | `MATRIX_EXTRA_CORS_ORIGINS` on the server doesn't match the Pages origin exactly (scheme + host, no trailing slash) |
| Frontend loads but calls go to `localhost` / wrong host | The GitHub Pages build wasn't given `VITE_API_BASE_URL` — check the `PLAYGROUND_API_BASE_URL` repo variable and re-run the `gh-pages.yml` workflow |
| Persona World → `matraix-persona-1m` fails with a "release not found locally" 404 | Expected until you import it — the coreset is gitignored (too large to commit) and isn't downloaded by default. Fix: `sudo -u matraix bash -lc 'cd /opt/matriaix && export PATH=$HOME/.local/bin:$PATH && .venv/bin/hf download MatrAIx2026/MatrAIx_Persona_1M_Public_Release --repo-type dataset --local-dir persona/datasets/matraix-persona-1m/release'` (~6.8GB, one-time; no service restart needed, it's read from disk on each request). Or pass `IMPORT_PERSONA_1M=1` to `oracle-vm-setup.sh` on a fresh provision. |
