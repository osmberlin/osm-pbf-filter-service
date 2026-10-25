# Server setup — step by step

How we set up our own server for the service. Background: [PLAN.md](../PLAN.md)
Part A, provisioning details: [server/ansible/README.md](../server/ansible/README.md).

**Server:** Hetzner Cloud **CX43** (8 vCPU shared, 16 GB RAM, 160 GB NVMe), Debian 12, always on.
**Cost:** ~€16/month for the server + ~€0.50/month for the IPv4 address.

What ends up on it: user `osmrunner` (no sudo), `/srv/osm/{sources,work,extracts}`,
the GitHub Actions runner (outbound only), nginx serving `/extracts/`. Everything
else is handled by the workflows.

## 1. Create the server (Hetzner Cloud console)

1. New project (or an existing one) -> **Add Server**.
2. Location **Falkenstein** or **Nuremberg**, image **Debian 12**, type **CX43** (shared vCPU, regular performance).
3. Networking: public IPv4 (needed for GitHub/Geofabrik access and for the extract URLs) and IPv6.
4. **SSH key**: add your public key (initial login is `root` with this key).
5. **Firewalls** -> create a Cloud Firewall with inbound rules **22, 80, 443** (TCP, any source; restrict 22 to your IP if it is stable). Outbound: allow all. Attach it to the server.
6. Name it `hetzner-osm`, create, and note the IPv4 address.

## 2. Run Ansible

```bash
ansible-galaxy collection install community.general
cd server/ansible
cp inventory.example.ini inventory.ini    # replace the IP with the server's
ansible-playbook -i inventory.ini playbook.example.yml
```

Check on the server (`ssh root@<ip>`):

```bash
id osmrunner                      # exists, not in the sudo group
ls -ld /srv/osm/*                 # sources, work, extracts, owned by osmrunner
osmium --version; pyosmium-up-to-date --version; python3 -c "import yaml"
nginx -t && curl -I http://localhost/extracts/   # 404 is fine: the folder is empty
ufw status                        # 22, 80, 443 allowed
```

## 3. Get a runner token

GitHub repo -> **Settings -> Actions -> Runners -> New self-hosted runner** (Linux x64).
Copy the one-time token and the current runner version from that page. The token expires after an hour.

## 4. Register the GitHub Actions runner

As `osmrunner` (replace `<VERSION>` and `<TOKEN>`; the download link is on the same GitHub page):

```bash
su - osmrunner
mkdir -p ~/actions-runner && cd ~/actions-runner
curl -fLO https://github.com/actions/runner/releases/download/v<VERSION>/actions-runner-linux-x64-<VERSION>.tar.gz
tar xzf actions-runner-linux-x64-<VERSION>.tar.gz
./config.sh --url https://github.com/osmberlin/osm-pbf-filter-service \
  --token <TOKEN> --labels osm --name hetzner-osm --unattended
exit
```

Then, as **root** (osmrunner has no sudo, so root installs the dependencies and the service):

```bash
cd /home/osmrunner/actions-runner
./bin/installdependencies.sh
./svc.sh install osmrunner
./svc.sh start
./svc.sh status
```

GitHub should show the runner `hetzner-osm` as **Idle** with the label `osm`.

## 5. Point the code at the server

GitHub repository settings are already done (fork-PR approval, collaborator-only
PRs; see [README -> GitHub repository settings](../README.md#github-repository-settings-done-2026-10-25)).
No GitHub variables or secrets are needed.

Set `PUBLIC_BASE` in `extractor/build.py` to the server IP for now, and commit:

```python
PUBLIC_BASE = "http://<server-ip>/extracts"
```

Once a domain exists: set `osm_download_hostname` in the playbook, re-run Ansible,
run `certbot --nginx -d <hostname>` on the server, and change `PUBLIC_BASE` to `https://<hostname>/extracts`.

## 6. First run

**Actions -> daily -> Run workflow.** The first run downloads Europe (~35 GB;
expect ~10–30 min) before the build starts. Later runs only apply Geofabrik's daily diffs.
Use **seed-sources** only to force a full re-download of a corrupt source.

Verify:

- `http://<server-ip>/extracts/index.json` lists the projects;
- `http://<server-ip>/extracts/<project>/status.json` has a recent `data_timestamp`;
- `curl -O http://<server-ip>/extracts/<project>/latest.osm.pbf && osmium fileinfo latest.osm.pbf` works;
- the run committed `status/` and `plan.json` back to `main`.

## Debugging

Most failures show up as a red Actions run with an `::error::` line and can be fixed in the repo. For the server:

| Symptom | Likely cause | What to do |
|---|---|---|
| Job stays **"Queued"** | Runner service is down or de-registered | As root: `cd /home/osmrunner/actions-runner && ./svc.sh status` / `start`; `journalctl -u 'actions.runner.*'`. If de-registered, repeat step 4 with a new token. |
| `Only N GB free on /srv/osm … Aborting` | Disk full (160 GB; Europe ~35 GB, plus a second copy during updates, plus extracts) | `df -h /srv/osm`; `/srv/osm/work/` is always safe to delete; delete old extracts or resize the server/attach a volume. |
| `pyosmium-up-to-date failed … exit code` | Geofabrik outage/network, or a corrupt source | Usually clears on the next run. If it repeats, run **seed-sources** (`reseed`) for that source. |
| osmium killed / exit 137 | Out of memory (16 GB) | `dmesg -T \| grep -i oom`. Use a lighter extract strategy (`complete_ways`) in the project config, or upgrade to a bigger server type. |
| Download URLs return 404/502 or time out | nginx down, wrong path, or Cloud Firewall rule missing | `nginx -t`, `systemctl status nginx`, `ls /srv/osm/extracts`; check the Cloud Firewall allows 80/443 and `ufw status`. |
| `nginx -t` fails after changing the hostname | Duplicate `default_server` or a bad certbot edit | Check `/etc/nginx/sites-enabled/`; re-run the Ansible role. |
| A run hangs for hours | osmium stuck; the 10 h job timeout cancels it | Look at `top` and the disk; only act if it repeats. |

Handy commands on the server:

```bash
df -h /srv/osm
ls -lh /srv/osm/sources /srv/osm/work /srv/osm/extracts
cat /srv/osm/sources/europe.state.json
osmium fileinfo -g header.option.osmosis_replication_timestamp /srv/osm/sources/europe.osm.pbf
journalctl -u 'actions.runner.*' --since today
```
