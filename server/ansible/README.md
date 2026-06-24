# server/ansible — provisioning

One-time provisioning for the osm-pbf-filter-service host (PLAN.md Part A). After
this runs, the GitHub Actions runner does everything else; you shouldn't need to
log into the server for normal operation.

> **Align with FOSSGIS.** The server is part of the FOSSGIS fleet (managed
> centrally; infra docs/playbooks live in the FOSSGIS GitLab). The expectation is
> to **fold the `osm_extract_service` role into the FOSSGIS setup**, matching their
> inventory/var conventions — not to run this standalone. The files here are a
> complete, reviewable reference of what the role must do; the exact placement is
> to be agreed with Lars Lingner / the FOSSGIS admins.

## What the role does

`roles/osm_extract_service/` (see [tasks/main.yml](roles/osm_extract_service/tasks/main.yml)):

1. installs system packages (`osmium-tool`, `nginx`, `git`, `jq`, `python3*`);
2. creates a pyosmium virtualenv and links `pyosmium-up-to-date` onto PATH;
3. creates the unprivileged runner user (`osmrunner`);
4. creates `/srv/osm/{planet,work,extracts}` owned by that user;
5. installs a **pinned** Bun (idempotent);
6. installs + enables the nginx site (HTTP; certbot adds TLS) and reloads nginx
   only after `nginx -t` passes.

Variables are in [defaults/main.yml](roles/osm_extract_service/defaults/main.yml)
(host, runner user, Bun version, paths). Override per inventory.

## Run (standalone example)

```bash
cd server/ansible
ansible-playbook -i inventory.example.ini playbook.example.yml
```

## Manual follow-up (NOT in the role)

The GitHub Actions runner registration is interactive (needs a one-time token),
so it stays manual. As the `osmrunner` user:

```bash
# Download the package: https://github.com/actions/runner/releases
mkdir -p ~/actions-runner && cd ~/actions-runner
tar xzf ~/actions-runner-linux-x64-*.tar.gz
./config.sh --url https://github.com/<org>/<repo> --token <RUNNER_TOKEN> \
  --labels osm --name umap-osm
sudo ./svc.sh install osmrunner && sudo ./svc.sh start
```

Then:

- Lock the runner down (PLAN.md §A3): require approval for outside PRs, no fork
  `pull_request` triggers, no passwordless sudo.
- TLS for the download host: `certbot --nginx -d <hostname>`.
- First data seed: trigger the `seed-planet` workflow (`workflow_dispatch`).
