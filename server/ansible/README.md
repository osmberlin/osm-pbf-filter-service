# server/ansible — provisioning

One-time provisioning for our own osm-pbf-filter-service server: a Hetzner Cloud
**CX43** (8 vCPU, 16 GB RAM, 160 GB NVMe), **Debian 12**. After this runs, the
GitHub Actions runner does everything else; you shouldn't need to log into the
server for normal operation. Step-by-step guide:
[docs/server-setup.md](../../docs/server-setup.md).

## What the role does

`roles/osm_extract_service/` (see [tasks/main.yml](roles/osm_extract_service/tasks/main.yml)):

1. installs apt packages: `osmium-tool`, `python3-pyosmium`, `python3-yaml`,
   `nginx`, `git`, `jq`, `curl`, `certbot`, `unattended-upgrades`, `ufw`;
2. links `pyosmium-up-to-date` onto PATH. Debian 12's `python3-pyosmium` (3.6.0)
   ships it as `/usr/lib/python3-pyosmium/pyosmium-up-to-date` and supports
   `--size` and `--server`, so no virtualenv is needed;
3. turns on automatic security updates (`unattended-upgrades`);
4. creates the unprivileged runner user `osmrunner` (system user, **no sudo**);
5. creates `/srv/osm/{sources,work,extracts}` owned by that user;
6. installs the nginx site (HTTP, serves `/extracts/`), removes Debian's default
   site, and reloads nginx only after `nginx -t` passes. The default
   `osm_download_hostname: "_"` makes it the default server, so it works with
   only an IP address;
7. enables `ufw` with 22, 80, 443 allowed and everything else inbound denied.

**Firewall decision:** the main filter is the **Hetzner Cloud Firewall**
(created by `hetzner.yml`, free, rules 22/80/443). `ufw` is a second layer on the
box, kept minimal; set `osm_enable_ufw: false` to drop it.

Variables are in [defaults/main.yml](roles/osm_extract_service/defaults/main.yml).
Override per inventory or in the play.

## Two ways to run it

**A. New Hetzner server, fully from code** ([hetzner.yml](hetzner.yml)). Creates the
SSH key, Cloud Firewall (22/80/443 in) and the server with the `hetzner.hcloud`
modules, waits for SSH, then runs the role. No OpenTofu and no state file: the
modules are idempotent by resource name (re-running changes nothing).

```bash
# one-time tooling (see docs/server-setup.md step 4)
uv tool install ansible-core --with requests --with python-dateutil
cd server/ansible
ansible-galaxy collection install -r requirements.yml
export HCLOUD_TOKEN=...          # read/write token of the Hetzner project; never written to a file
ansible-playbook hetzner.yml
```

Variables (override with `-e`): `hcloud_server_name` (osm-extracts),
`hcloud_server_type` (cx43), `hcloud_image` (debian-12), `hcloud_location`
(fsn1; or nbg1), `hcloud_ssh_public_key_path` (`~/.ssh/id_ed25519.pub`),
`hcloud_ssh_source_ips` (restrict SSH to your IP), `hcloud_labels`.
The key's private half must be available to ssh (agent or default key).
Tear down with `ansible-playbook hetzner-destroy.yml -e confirm=yes`
(deletes the server and all its data; key and firewall stay).

**B. Existing server** (e.g. FOSSGIS later): [playbook.example.yml](playbook.example.yml)
with an inventory; only the role runs.

```bash
ansible-galaxy collection install -r requirements.yml   # community.general is enough here
cp inventory.example.ini inventory.ini   # put the server IP in; initial login is root with your SSH key
ansible-playbook -i inventory.ini playbook.example.yml
```

The role is idempotent; re-run it after OS upgrades or variable changes.

## Manual follow-up (NOT in the role)

Runner registration needs a one-time token from GitHub (Settings -> Actions ->
Runners -> New self-hosted runner), so it stays manual. Full commands with the
current runner version are in [docs/server-setup.md](../../docs/server-setup.md#6-register-the-github-actions-runner).
In short: download the runner as `osmrunner`, `./config.sh --labels osm
--name hetzner-osm`, then as root `./svc.sh install osmrunner && ./svc.sh start`.

Then:

- Keep the runner locked down (PLAN.md §A3): fork PRs need approval, no fork
  `pull_request` triggers on the self-hosted runner, no sudo for `osmrunner`.
- Once a domain exists: set `osm_download_hostname`, re-run the role, run
  `certbot --nginx -d <hostname>`, and update `PUBLIC_BASE` in `extractor/build.py`.

## Paused: FOSSGIS / uMap variant

> **Paused (2026-10-25).** Running this on the shared FOSSGIS uMap server is on
> hold; we run our own server instead. This note stays relevant for later.
>
> **Agreed with the FOSSGIS admin (2026-10-25).** If it comes back, it does
> **not** hook into the uMap role or its tasks. It gets its **own Ansible role /
> task setup** in the FOSSGIS repo. It may use the same shared services that the
> server already has (e.g. nginx), but keeps its **own folders and its own users**,
> separate from uMap.
>
> FOSSGIS Ansible repo (access needed, ask the FOSSGIS admins), uMap role for
> reference: <https://gitlab.fossgis.de/osm-server/ansible_openstreetmap.de/-/blob/master/roles/umap/tasks/main.yml?ref_type=heads>
