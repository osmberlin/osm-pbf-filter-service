# server/ansible — provisioning

Provisioning for osm-pbf-filter-service servers (Debian 12). Currently every
night's server is created and deleted by the workflow (path A below), so you
shouldn't need to log into a server for normal operation. Step-by-step guide:
[docs/setup.md](../../docs/setup.md).

## Two paths

| | A. Nightly throwaway server | B. Long-lived server that serves itself |
|---|---|---|
| Used by | `.github/workflows/daily.yml` (current) | nothing yet; e.g. FOSSGIS later |
| Playbooks | [nightly-create.yml](nightly-create.yml), [nightly-destroy.yml](nightly-destroy.yml) | [playbook.example.yml](playbook.example.yml) + [inventory.example.ini](inventory.example.ini) |
| Role mode | `osm_serve: false` | `osm_serve: true` (default) |
| Delivery | files go to Cloudflare R2 | nginx on the server |

### A. Nightly throwaway server

`nightly-create.yml` creates the SSH key and a Cloud Firewall (inbound SSH only),
then tries the server candidates in order (cpx42 in nbg1 and hel1, ccx33 in fsn1
and nbg1, cpx52 in nbg1) because Hetzner types are often unavailable. The first
one that works is used. It waits for SSH and runs the role with
`osm_serve: false` (toolchain only). The server is labelled
`project=osm-pbf-filter-service,role=nightly`; `nightly-destroy.yml` deletes every
server with that label (the workflow runs it first, to clean up after crashed
runs, and last, always). Each attempt is in [tasks/create-server.yml](tasks/create-server.yml).

The workflow needs the secrets `HCLOUD_TOKEN` and `SSH_PRIVATE_KEY` (plus the R2
secrets for the pipeline itself); see [docs/setup.md](../../docs/setup.md). You can
also run the playbooks by hand:

```bash
uv tool install ansible-core --with requests --with python-dateutil
cd server/ansible
ansible-galaxy collection install -r requirements.yml
export HCLOUD_TOKEN=...          # read/write token of the Hetzner project; never written to a file
ansible-playbook nightly-create.yml -e ip_file=/tmp/server_ip   # prints/writes the server IP
ansible-playbook nightly-destroy.yml                            # delete it again, do not forget
```

Needs `~/.ssh/id_ed25519.pub` (override with `-e hcloud_ssh_public_key_path=...`).
A server left running costs money, so always run the destroy playbook.

### B. Long-lived server that serves itself

Only the role runs, with nginx, ufw, certbot and unattended-upgrades. Use it for
an existing or manually created server (e.g. FOSSGIS later):

```bash
ansible-galaxy collection install -r requirements.yml   # community.general is enough here
cp inventory.example.ini inventory.ini   # put the server IP in; initial login is root with your SSH key
ansible-playbook -i inventory.ini playbook.example.yml
```

Once a domain exists: set `osm_download_hostname`, re-run the role, run
`certbot --nginx -d <hostname>`, and update `PUBLIC_BASE` in `extractor/build.py`.
The files would have to get to that server in some way (the current workflow
publishes to R2). If a runner is ever wanted on such a server, a self-hosted
GitHub runner could be registered there, but it needs the hardening for public
repos described in PLAN.md §A8.

## What the role does

`roles/osm_extract_service/` (see [tasks/main.yml](roles/osm_extract_service/tasks/main.yml)).
Always:

1. installs the toolchain: `osmium-tool`, `python3-pyosmium`, `python3-yaml`,
   `rclone`, `rsync`, `git`, `jq`, `curl`;
2. links `pyosmium-up-to-date` onto PATH. Debian 12's `python3-pyosmium` (3.6.0)
   ships it as `/usr/lib/python3-pyosmium/pyosmium-up-to-date` and supports
   `--size` and `--server`, so no virtualenv is needed;
3. creates the unprivileged user `osmrunner` (system user, **no sudo**);
4. creates `/srv/osm/{sources,work,extracts}` owned by that user.

Only with `osm_serve: true`:

5. installs `nginx`, `certbot`, `unattended-upgrades`, `ufw`; turns on automatic
   security updates;
6. installs the nginx site (HTTP, serves `/extracts/`), removes Debian's default
   site, and reloads nginx only after `nginx -t` passes. The default
   `osm_download_hostname: "_"` makes it the default server, so it works with
   only an IP address;
7. enables `ufw` with 22, 80, 443 allowed and everything else inbound denied
   (`osm_enable_ufw: false` to drop it; a cloud firewall in front is the main filter).

Variables are in [defaults/main.yml](roles/osm_extract_service/defaults/main.yml).
Override per inventory or in the play. The role is idempotent.

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
