# Setup — step by step

What runs where:

- **Every night** GitHub Actions (`.github/workflows/daily.yml`, on a normal
  GitHub-hosted runner) creates a **throwaway Hetzner server**, copies the repo
  onto it, fetches the continent files from **Cloudflare R2**, applies
  Geofabrik's daily diffs, builds the extracts, pushes sources and extracts back
  to R2, commits `plan.json` + `status/`, and **deletes the server**.
- **Downloads** come straight from R2's public URL. Nothing runs permanently.

Cost: server ~€0.13/hour for 1–2 hours a night (~€4–8/month), R2 ~$1–2/month
(storage only; downloads are free). Hetzner prices change, so check them before
you rely on this.

You need: a Cloudflare account (R2), a Hetzner Cloud account, and admin rights on
the GitHub repo. All credentials end up as **GitHub secrets**, never in the repo.

---

## 1. Cloudflare R2: bucket

Cloudflare dashboard → **R2 Object Storage** → **Create bucket**:

- **Name:** `osm-extracts` (the code uses this name: `scripts/nightly.sh`).
- **Location:** *Automatic*, with the location hint **Western Europe (WEUR)**.
  (A strict *EU jurisdiction* bucket also works for storage, but uses a different
  S3 endpoint; stay with Automatic + WEUR unless EU-only storage is required.)
- **Default storage class:** Standard.

## 2. Cloudflare R2: public access

Bucket `osm-extracts` → **Settings** → **Public access**:

- **Public Development URL (r2.dev)** → **Enable**, confirm. Copy the URL, it
  looks like `https://pub-<hash>.r2.dev`.
- r2.dev is rate-limited and meant for testing. For real use, connect a **custom
  domain** in the same place (the domain's DNS must be on Cloudflare). Then the
  URL becomes e.g. `https://extracts.example.org`.

Send me that URL (it isn't secret). I'll put it into `extractor/build.py`
(`PUBLIC_BASE = "https://pub-<hash>.r2.dev/extracts"`).

## 3. Cloudflare R2: access key for the workflow

R2 overview → **API** / **Manage API tokens** → **Create Account API token**:

- **Permissions:** Object Read & Write.
- **Specify bucket(s):** only `osm-extracts`.
- **TTL:** forever (or a date you'll remember to renew).

After **Create** Cloudflare shows the values **once**. Keep them in your password
manager:

- **Access Key ID** → secret `R2_ACCESS_KEY_ID`
- **Secret Access Key** → secret `R2_SECRET_ACCESS_KEY`
- **S3 endpoint** `https://<account-id>.r2.cloudflarestorage.com` → secret `R2_ENDPOINT`

Optional: **Billing → Budget alerts**, e.g. at $5/month.

## 4. Hetzner Cloud: project + API token

[console.hetzner.com](https://console.hetzner.com): create a project
**osm-extracts** (billing set up). In the project: **Security → API tokens →
Generate API token**, permission **Read & Write** → secret `HCLOUD_TOKEN`.

The workflow creates the SSH key and the firewall (SSH only) in this project by
itself, and every server it creates carries the labels
`project=osm-pbf-filter-service,role=nightly`.

## 5. SSH key for the workflow

A dedicated key, used only by the workflow to reach the nightly server:

```bash
ssh-keygen -t ed25519 -N "" -C osm-nightly -f ~/.ssh/osm-nightly
```

The private key (`~/.ssh/osm-nightly`) → secret `SSH_PRIVATE_KEY`. The workflow
derives the public key itself.

## 6. GitHub secrets

Repo → **Settings → Secrets and variables → Actions → New repository secret**,
or with the GitHub CLI **in your own terminal** (so the values never pass
through a chat):

```bash
gh secret set HCLOUD_TOKEN --repo osmberlin/osm-pbf-filter-service
```

```bash
gh secret set R2_ACCESS_KEY_ID --repo osmberlin/osm-pbf-filter-service
```

```bash
gh secret set R2_SECRET_ACCESS_KEY --repo osmberlin/osm-pbf-filter-service
```

```bash
gh secret set R2_ENDPOINT --repo osmberlin/osm-pbf-filter-service
```

```bash
gh secret set SSH_PRIVATE_KEY --repo osmberlin/osm-pbf-filter-service < ~/.ssh/osm-nightly
```

(`gh secret set NAME` without input asks for the value.)

Who can use the secrets: workflows on `main` only. PRs from outside can't be
opened at all (see [README → GitHub repository settings](../README.md#github-repository-settings-done-2026-10-25)),
and workflows from fork PRs never get secrets.

## 7. First run

**Actions → daily → Run workflow** (leave *reseed* empty).

The first night has no sources in R2 yet, so the server downloads Europe from
Geofabrik (~35 GB) and uploads it to R2. Expect 1–2 hours. Later nights only
fetch the file from R2 and apply one day of diffs.

## 8. Checks

- The run is green and its log shows which server type and location were used.
- `https://pub-<hash>.r2.dev/extracts/index.json` lists the projects.
- `…/extracts/<project>/status.json` has a recent `data_timestamp`.
- `curl -O …/extracts/<project>/latest.osm.pbf && osmium fileinfo latest.osm.pbf` works.
- The run committed `plan.json` and `status/` to `main`.
- Hetzner console: **no server left** in the project after the run.

## 9. Later: the world

Enable more continents in `regions/regions.yaml`. `projects/openseamap-vector`
(`area: world`) then covers them all. Each continent adds its file to R2
(all of them together ~85 GB, ~$1.30/month) and some runtime to the nightly
server. Check Russia's coverage first (Geofabrik lists it separately).

---

## Debugging

Most failures show up as a red Actions run with an `::error::` line.

| Symptom | Likely cause | What to do |
|---|---|---|
| `No server type was available` | Hetzner has none of the candidates right now | Re-run later, or add candidates in `server/ansible/nightly-create.yml` (`hcloud_candidates`). |
| `HCLOUD_TOKEN is not set` / Hetzner `unauthorized` | Secret missing or token revoked | Step 4 + 6. |
| SSH step fails (`Permission denied`) | `SSH_PRIVATE_KEY` wrong or has a passphrase | Step 5 + 6 (key without passphrase). |
| rclone `AccessDenied` / `403` | R2 token not scoped to `osm-extracts`, or wrong endpoint | Step 3 + 6. |
| `pyosmium-up-to-date failed` | Geofabrik outage, or a broken source file | Usually clears the next night. If it repeats: run **daily** with *reseed* = `europe`. |
| osmium killed / exit 137 | Out of memory | Use a candidate with more RAM first (`ccx33`: 32 GB). |
| A server is still running after a run | The delete step itself failed | `cd server/ansible && HCLOUD_TOKEN=… ansible-playbook nightly-destroy.yml` deletes every nightly server; the next run also cleans up. |
| Run cancelled after 5.5 h | Too much work for one GitHub job (6 h limit) | Split continents across runs, or use a faster server type. |

Look at the data without a server, from your machine (needs rclone and the R2
key in a local rclone config):

```bash
rclone ls r2:osm-extracts/sources
```
