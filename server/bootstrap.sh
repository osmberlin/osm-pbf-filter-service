#!/usr/bin/env bash
#
# DRAFT — one-time server provisioning for the osm-pbf-filter-service.
# Run ONCE, by hand, on the FOSSGIS uMap server (see PLAN.md Part A).
# After this, everything runs via GitHub Actions; you shouldn't need to log in again.
#
# Coordinate with Lars Lingner / the FOSSGIS OSM-server admins before running this
# (shared box with uMap). Review every line before executing.
#
# Usage:  sudo bash server/bootstrap.sh
set -euo pipefail

RUNNER_USER="${RUNNER_USER:-osmrunner}"
OSM_ROOT="${OSM_ROOT:-/srv/osm}"
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "==> 1/5 System packages (osmium-tool, nginx, git, jq, python venv)"
apt-get update
apt-get install -y osmium-tool nginx git jq curl ca-certificates python3 python3-venv python3-pip

echo "==> 2/5 pyosmium (provides 'pyosmium-up-to-date')"
# Isolated install so we don't touch the system Python used by other services.
python3 -m venv /opt/pyosmium
/opt/pyosmium/bin/pip install --upgrade pip osmium
ln -sf /opt/pyosmium/bin/pyosmium-up-to-date /usr/local/bin/pyosmium-up-to-date

echo "==> 3/5 Dedicated unprivileged runner user + data dirs"
id -u "$RUNNER_USER" >/dev/null 2>&1 || useradd --system --create-home --shell /bin/bash "$RUNNER_USER"
mkdir -p "$OSM_ROOT"/{planet,work,extracts}
chown -R "$RUNNER_USER":"$RUNNER_USER" "$OSM_ROOT"
chmod -R 0755 "$OSM_ROOT"

echo "==> 4/5 Bun (as $RUNNER_USER)"
sudo -u "$RUNNER_USER" bash -lc 'command -v bun >/dev/null || curl -fsSL https://bun.sh/install | bash'

echo "==> 5/5 nginx site for /srv/osm/extracts"
install -m 0644 "$REPO_DIR/server/nginx-osm-extracts.conf" /etc/nginx/sites-available/osm-extracts.conf
ln -sf /etc/nginx/sites-available/osm-extracts.conf /etc/nginx/sites-enabled/osm-extracts.conf
nginx -t && systemctl reload nginx

cat <<EOF

==> Base provisioning done.

NEXT (manual, NOT scripted — needs a one-time GitHub registration token):

  1) Register the self-hosted runner as user '$RUNNER_USER':
     Download the package:  https://github.com/actions/runner/releases
     cd ~ && mkdir actions-runner && cd actions-runner
     tar xzf ~/actions-runner-linux-x64-*.tar.gz
     ./config.sh --url https://github.com/<org>/<repo> --token <RUNNER_TOKEN> --labels osm --name umap-osm
     sudo ./svc.sh install $RUNNER_USER && sudo ./svc.sh start

  2) Lock the runner down (PLAN.md §A3): require approval for outside PRs,
     no fork pull_request triggers, no passwordless sudo.

  3) TLS for the download host (e.g. certbot) — see server/nginx-osm-extracts.conf.

  4) First data seed: trigger the 'seed-planet' workflow (workflow_dispatch).
EOF
