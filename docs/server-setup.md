# Server setup — step by step

How we set up our own server for the service. Background: [PLAN.md](../PLAN.md)
Part A, provisioning details: [server/ansible/README.md](../server/ansible/README.md).

**Server:** Hetzner Cloud **CX43** (8 vCPU shared, 16 GB RAM, 160 GB NVMe), Debian 12, always on.
**Cost:** CX43 roughly €16/month + primary IPv4 roughly €0.50/month (check the current price at <https://www.hetzner.com/cloud>).

What ends up on it: user `osmrunner` (no sudo), `/srv/osm/{sources,work,extracts}`,
the GitHub Actions runner (outbound only), nginx serving `/extracts/`. Everything
else is handled by the workflows.

## Agents

Everything below except the account, billing and the runner token is code in
`server/ansible/`. An agent with `HCLOUD_TOKEN` and an SSH key can run the
playbooks; everything it changes is a diff in the repo.

## Plan

First run: **Europe only** (~35 GB). Then enable the world (see
`regions/regions.yaml` and, once enabled, `projects/openseamap-vector`). All
continents peak at roughly 130 GB of the 160 GB disk. If that gets tight, add a
Hetzner Volume later.

## Checklist

### 1. Hetzner account and project

Create (or use) a Hetzner Cloud account, billing set up (decide who pays), and a
new project named **osm-extracts**.

### 2. API token

In the project: **Security -> API tokens -> Generate**, permission **Read & Write**.
Store it only locally (password manager). In the shell that runs Ansible:

```bash
export HCLOUD_TOKEN=...
```

It is never written into the repo or a file.

### 3. SSH key

Have an ed25519 key (`ssh-keygen -t ed25519`). The playbook uploads
`~/.ssh/id_ed25519.pub` (change with `-e hcloud_ssh_public_key_path=...`);
the private key must be usable by ssh (agent or default key).

### 4. Install the Ansible tooling

Recommended (isolated from system Python):

```bash
uv tool install ansible-core --with requests --with python-dateutil
cd server/ansible
ansible-galaxy collection install -r requirements.yml
```

The current `hetzner.hcloud` collection needs `requests` and `python-dateutil`
on the controller (not the old `hcloud` package). With Homebrew Ansible they
are already included.

### 5. Create and provision the server

```bash
cd server/ansible
ansible-playbook hetzner.yml
```

This creates the SSH key, the Cloud Firewall (22/80/443), a **CX43** with
Debian 12 in `fsn1` (use `-e hcloud_location=nbg1` for Nuremberg), waits for SSH,
runs the role, and prints the IP. Details: [server/ansible/README.md](../server/ansible/README.md).

Check on the server (`ssh root@<ip>`):

```bash
id osmrunner                      # exists, not in the sudo group
ls -ld /srv/osm/*                 # sources, work, extracts, owned by osmrunner
osmium --version; pyosmium-up-to-date --version; python3 -c "import yaml"
nginx -t && curl -I http://localhost/extracts/   # 404 is fine: the folder is empty
ufw status                        # 22, 80, 443 allowed
```

### 6. Register the GitHub Actions runner

Repo -> **Settings -> Actions -> Runners -> New self-hosted runner** (Linux x64).
Copy the one-time token and runner version (the token expires after an hour).

As `osmrunner` (replace `<VERSION>` and `<TOKEN>`):

```bash
su - osmrunner
mkdir -p ~/actions-runner && cd ~/actions-runner
curl -fLO https://github.com/actions/runner/releases/download/v<VERSION>/actions-runner-linux-x64-<VERSION>.tar.gz
tar xzf actions-runner-linux-x64-<VERSION>.tar.gz
./config.sh --url https://github.com/osmberlin/osm-pbf-filter-service \
  --token <TOKEN> --labels osm --name hetzner-osm --unattended
exit
```

Then as **root** (osmrunner has no sudo):

```bash
cd /home/osmrunner/actions-runner
./bin/installdependencies.sh
./svc.sh install osmrunner
./svc.sh start
./svc.sh status
```

GitHub should show `hetzner-osm` as **Idle** with the label `osm`.

### 7. Point the code at the server

GitHub repository settings are already done (see
[README -> GitHub repository settings](../README.md#github-repository-settings-done-2026-10-25)).
No GitHub variables or secrets are needed. Set in `extractor/build.py` and push:

```python
PUBLIC_BASE = "http://<server-ip>/extracts"
```

### 8. First run

**Actions -> daily -> Run workflow.** The first run downloads Europe (~35 GB,
expect ~10-30 min), later runs only apply Geofabrik's daily diffs. Use
**seed-sources** only to force a full re-download of a corrupt source.

### 9. Checks

- `http://<server-ip>/extracts/index.json` lists the projects;
- `http://<server-ip>/extracts/<project>/status.json` has a recent `data_timestamp`;
- `curl -O http://<server-ip>/extracts/<project>/latest.osm.pbf && osmium fileinfo latest.osm.pbf` works;
- the run committed `status/` and `plan.json` back to `main`.

### 10. Later: domain and TLS

Set `osm_download_hostname` (in `hetzner.yml` or the play), re-run the playbook,
run `certbot --nginx -d <hostname>` on the server, and change `PUBLIC_BASE` to
`https://<hostname>/extracts`.

### 11. Teardown

```bash
ansible-playbook hetzner-destroy.yml -e confirm=yes
```

Deletes the server **and all downloaded data** (re-download on the next
setup); the SSH key and firewall stay.

## Debugging

Most failures show up as a red Actions run with an `::error::` line and can be fixed in the repo. For the server:

| Symptom | Likely cause | What to do |
|---|---|---|
| Job stays **"Queued"** | Runner service is down or de-registered | As root: `cd /home/osmrunner/actions-runner && ./svc.sh status` / `start`; `journalctl -u 'actions.runner.*'`. If de-registered, repeat step 6 with a new token. |
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
