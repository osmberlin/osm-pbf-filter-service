# Admin setup session — step by step

A checklist for setting up the service on the shared FOSSGIS uMap server together
with the server admin. Each step says **where** it happens (server or GitHub) and
**who** does it. Background: [PLAN.md](../PLAN.md) Part A, provisioning details:
[server/ansible/README.md](../server/ansible/README.md).

## What gets installed (2-minute pitch for the admin)

- **One unprivileged user** `osmrunner`, no sudo. Everything runs as this user.
- **One directory** `/srv/osm/` (planet ~87 GB, `work/` for temporary files, `extracts/` for the served results).
- **One systemd service**: the GitHub Actions runner. It only connects *outbound* to GitHub. No inbound port.
- **One nginx site** that serves `/srv/osm/extracts/` read-only at `https://<host>/extracts/…`.
- **Packages** (all apt, except pyosmium in a venv under `/opt/pyosmium`): `osmium-tool`, `jq`, `git`, `curl`, `python3`, `python3-venv`, `python3-yaml`. The orchestrator is plain Python, no extra runtime.
- **Load**: one nightly job. It updates the planet (one rewrite of the 87 GB file) and cuts the extracts. The load is mostly disk I/O. A disk guard aborts the job when less than 120 GB is free.

Nothing else changes on the server. After the setup there is no routine admin work.

## Before the session (prepare)

| # | Where | Who | Step |
|---|---|---|---|
| 0.1 | — | us | Agree on the **download hostname**, e.g. `osm-extracts.<umap-domain>`, and who sets the DNS record. |
| 0.2 | — | admin | Confirm **Python ≥ 3.11** (`python3 --version`; Debian 12 and Ubuntu 24.04 ship it) and the **free disk** (we need ≥ 300 GB on the volume holding `/srv/osm`, SSD preferred) and the RAM. |
| 0.3 | — | admin | Decide whether to **fold the Ansible role into the FOSSGIS playbooks** or run it standalone once. |

## Part 1 — Server (admin, ~30 min)

| # | Step | Check it worked |
|---|---|---|
| 1.1 | Set `osm_download_hostname` (and `osm_root` if not `/srv/osm`) in the inventory. | — |
| 1.2 | Run the role: `cd server/ansible && ansible-playbook -i <inventory> playbook.example.yml` | `id osmrunner`; `ls -ld /srv/osm/*` is owned by osmrunner; `osmium --version`; `pyosmium-up-to-date --help`; `python3 -c "import yaml"` |
| 1.3 | Point DNS at the server, then add TLS: `certbot --nginx -d <hostname>` | `curl -I https://<hostname>/extracts/` returns 404 (that's expected: the folder is empty and there is no autoindex) |
| 1.4 | Register the runner as `osmrunner`. Get the token in step 2.1, then follow [server/ansible/README.md → Manual follow-up](../server/ansible/README.md#manual-follow-up-not-in-the-role). Use label **`osm`**. | `sudo ./svc.sh status` shows the service as active; GitHub shows the runner as "Idle" |

## Part 2 — GitHub (us, ~10 min)

Repo: https://github.com/osmberlin/osm-pbf-filter-service

| # | Step |
|---|---|
| 2.1 | **Settings → Actions → Runners → New self-hosted runner**: copy the one-time token for step 1.4. |
| 2.2 | **Settings → Actions → General → Fork pull request workflows**: set "Require approval for all outside collaborators". This is mandatory, because the repo is public and the runner sits on a shared server (PLAN.md §A3). |
| 2.3 | Put the agreed hostname in the code: `PUBLIC_BASE` in `extractor/build.py` and `osm_download_hostname` in the Ansible inventory. No GitHub variables or secrets are needed. |
| 2.4 | **Actions → seed-planet → Run workflow**, type `reseed`. This downloads the 87 GB planet and checks its md5. It takes a few hours, and the session doesn't need to wait for it. |

## Part 3 — Test (us, after the seed finishes)

The repo ships a small test project, `projects/test-neukoelln` (spieli's tag set,
cut to Berlin-Neukölln straight from the planet). It is the only project with a
committed polygon so far. The other projects are skipped with a "region has no
polygon" annotation, which is expected.

1. Actions → `daily` → Run workflow. Check that:
   - `https://<hostname>/extracts/index.json` lists `test-neukoelln`;
   - `https://<hostname>/extracts/test-neukoelln/status.json` has a recent `data_timestamp`;
   - `curl -O https://<hostname>/extracts/test-neukoelln/latest.osm.pbf && osmium fileinfo latest.osm.pbf` works;
   - the run committed `status/` and `plan.json` back to `main`.

## Debugging — cases that need the admin

Most failures show up as a red GitHub Actions run with an `::error::` line, and we can fix them in the repo. The admin is only needed for these:

| Symptom (in the Actions log) | Likely cause | Admin action |
|---|---|---|
| The job stays **"Queued"** forever | The runner service is down or was de-registered | `cd ~osmrunner/actions-runner && sudo ./svc.sh status` / `start`; check `journalctl -u actions.runner.*` |
| `Only N GB free on /srv/osm … Aborting` | The disk is full, from the planet growing or from uMap | Free space or grow the volume. Leftovers in `/srv/osm/work/` are always safe to delete. |
| `pyosmium-up-to-date failed with exit code …` | Network or a planet.openstreetmap.org outage, or a corrupt planet | Usually it clears itself on the next run. If it keeps failing, we run `seed-planet` again; the admin only needs to check outbound HTTPS. |
| osmium killed / exit 137 | Out of memory (the OOM killer) | Check `dmesg`. We can switch the extract strategy to `complete_ways` in the config to use less RAM. |
| uMap is slow during the night | Disk I/O contention | Agree on a different cron time (in `daily.yml`) or an `ionice`/`nice` wrapper. |
| Downloads return 404/502 | nginx site disabled, or a certificate problem | `nginx -t`, `systemctl status nginx`, `certbot renew --dry-run` |
| A run hangs for hours | osmium stuck; the 10 h job timeout cancels it | Nothing, unless it repeats; then look at load and the disk. |
| Runner needs an update / OS upgrade | — | The runner updates itself. After an OS upgrade, re-run the Ansible role (it is idempotent). |

Handy commands on the server:

```bash
sudo -u osmrunner df -h /srv/osm
ls -lh /srv/osm/planet /srv/osm/work /srv/osm/extracts
jq . /srv/osm/planet/update-state.json          # last planet update + data age
osmium fileinfo -g header.option.osmosis_replication_timestamp /srv/osm/planet/planet.osm.pbf
journalctl -u 'actions.runner.*' --since today
```

## Open questions to settle in the session

- The download hostname and who owns DNS and TLS for it.
- Fold the role into the FOSSGIS playbooks, or run it standalone?
- Preferred nightly time window (default 03:00 UTC), based on uMap's quiet hours.
- Monitoring: is there existing alerting (disk, load) we should hook into?
