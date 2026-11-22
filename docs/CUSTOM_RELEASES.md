# Signed custom Breeze server releases (robert-audat/breeze)

This fork adds a **separately signed** server-image layer to the existing Breeze
`guided-setup.sh`. It does not disable or replace the upstream signature
verification. The official Breeze base and the fork revision are tracked
separately.

| Identity | Example | Meaning |
| --- | --- | --- |
| `BREEZE_VERSION` | `0.130.0` | Official Breeze release baseline; used by runtime, agents and migrations |
| `BREEZE_CUSTOM_RELEASE_VERSION` | `v0.130.0-custom.1` | Signed fork revision of custom server code |
| GitHub Release asset tag | `custom-v0.130.0-custom.1` | Non-`v*` tag to avoid the upstream full agent release workflow |
| `BREEZE_CUSTOM_RELEASE_REPOSITORY` | `robert-audat/breeze` | Repository publishing the custom release |
| `BREEZE_CUSTOM_RELEASE_PUBLIC_KEYS` | Base64 Ed25519 public key | Locally pinned fork signing trust anchor |

## Trust boundaries

1. The **official LanternOps release manifest** and Ed25519 signature are
   downloaded and verified with `RELEASE_ARTIFACT_MANIFEST_PUBLIC_KEYS`, using
   the existing Breeze verifier unchanged.
2. The fork's separately signed seven-image manifest uses
   `BREEZE_CUSTOM_RELEASE_PUBLIC_KEYS`. The installer validates its signature,
   repository identity, custom version, and two additional signed fields:
   `upstreamRelease` and `upstreamManifestSha256`. The latter must match the
   exact bytes of the verified official manifest.
3. The fork manifest may replace **only API, Web or Portal** with digest-pinned
   images from `ghcr.io/robert-audat/breeze/{api,web,portal}`. It must carry the
   exact official digest and repository for **binaries and all M365 executors**.
4. The **official signed binaries manifest pair** remains staged in Breeze's
   binaries volume; it is NOT replaced by the fork's server-only manifest.
5. A new deployment does not trust a public key downloaded from the fork. The
   operator explicitly pins the custom key in `.env` (or supplies it once via
   environment variable). A conflicting shell override is rejected.
6. Any failed custom verification prevents image selection and (in upgrade
   mode) leaves `.env` byte-for-byte unchanged. No `--allow-unverified-release`
   bypass is allowed for custom releases.

Release signatures authenticate the manifest publisher, not runtime correctness.
Review GitHub Actions provenance, source commit, and CI checks before production.
The workflow currently builds `linux/amd64` server images only. Use a different
builder configuration if your server architecture differs.

## Initial GitHub signing setup

Generate a signing key pair locally, outside your Git repository:

```bash
umask 077
openssl genpkey -algorithm Ed25519 -out custom-release-private.pem
openssl pkey -in custom-release-private.pem -pubout -outform DER \
  | tail -c 32 | openssl base64 -A
```

Create the GitHub Actions **Environment** `custom-release-signing` in
`robert-audat/breeze`. In this environment, configure:

- Secret `CUSTOM_RELEASE_SIGNING_KEY_PEM`: full private PEM file contents.
- Variable `CUSTOM_RELEASE_PUBLIC_KEY_B64`: the base64-encoded raw public key
  printed above.

The validation job also requires the exact tagged commit to have successful
`CUSTOM / Required Checks`, `CUSTOM / Gitleaks` and
`CUSTOM / Dependency audit` status checks. All three must complete on
the protected `custom` branch **before** the release tag is pushed.
Missing, pending or failed checks prevent the publish job from accessing
the signing environment.

The workflow runs on a `custom-v*` **tag**, not on a branch event. Under the
environment's deployment branch/tag restrictions, select **Selected branches and
tags**, then add an allowed **tag** pattern `custom-v*` (not just branch
`custom`). Add required reviewers if available. A separate GitHub **tag ruleset** must restrict initial creation of
`custom-v*` tags to a narrowly authorized publisher/bypass actor, and
restrict updates and deletions. Until creation restrictions are configured,
an authorized repository writer may create a tag at unreviewed workflow
code; the tagged workflow could then be modified to bypass its own checks.
Environment protection (ideally a second independent reviewer) mitigates
this additional trust risk. Do not publish a signed release until both
protections are established.
Protect `custom` with PR, review, and check requirements. Only create tags
from reviewed `custom` commits, and never expose signing secrets to
untrusted PR workflows. Do not commit private keys.

Make sure the workflow's `GITHUB_TOKEN` has `packages:write` and
`contents:write` and that the resulting GHCR image packages are accessible to
your IONOS server (public packages or authenticated Docker registry pull).

## Publish a release (tag-triggered)

The fork's **default branch stays `main`**. GitHub Actions starts this
workflow when a new tag matching `custom-v*` is pushed. Because it is a
tag-triggered workflow, its file can live in `custom` without changing the
fork's default branch. Do not use the inherited `v*` release workflows.

1. Base `custom` on the **exact official release tag**, apply fork-only
   changes, resolve conflicts and run upstream CI. The workflow verifies that
   `custom` diverged from upstream `main` at precisely the selected
   upstream release tag. This prevents mislabeling newer development commits
   as a past official release. Do not reset your deployment branch without
   preserving your own commits.
2. Ensure the custom branch is pushed and the signing environment has the
   public key and private signing key configured.
3. Create and push an annotated release tag pointing at the **current custom
   branch head** (the validation job checks this).

   ```bash
   git fetch origin
   git switch custom
   git pull --ff-only origin custom
   git tag -a custom-v0.130.0-custom.1 -m "Custom Breeze v0.130.0-custom.1"
   git push origin refs/tags/custom-v0.130.0-custom.1
   ```

   Replace the version above with a **validated** official baseline and the
   next unused custom revision; it is illustrative only. Avoid creating the
   tag unless the ancestry check and repository checks can pass.
4. The workflow first validates tag syntax, the exact tagged commit, the
   selected upstream tag and local tests **without signing secrets**. Only
   after validation succeeds does the publishing job access the
   `custom-release-signing` environment. It then downloads and verifies the
   official signed inventory, builds API and Web by immutable digests, signs
   a custom seven-image manifest, verifies it and publishes a GitHub Release
   under the same custom tag.
5. Confirm the release assets are `release-artifact-manifest.json` and
   `release-artifact-manifest.json.ed25519`. Treat revisions as immutable.
   Never re-point an existing release tag. Use `custom.2` for a rebuild.

If you need to test the workflow itself before the ancestry check can pass,
test only local verification and CI; do not grant it production signing
credentials or publish a misleading release tag.

The Portal, binaries and M365 executor images remain official. The signed
manifest records the custom commit SHA and hashes the official image inventory
to bind both release identities. If needed later, the manifest builder can
also support a separately built, verified custom Portal image.

**Verified baseline (November 22, 2026):** the official v0.130.0 tag
points to `e8ba47ef00660dd0021e00790b3d8ba799085c8a`, exactly the
upstream commit where this fork's `custom` branch diverges. Confirm again
with `git merge-base origin/custom upstream/main` before tagging. Do not
merge unreleased upstream commits into the custom branch before publishing
this release. The official v0.130.0 release has signed manifest assets,
but verification must still pass in the release workflow.

**Inherited workflows:** this fork also contains upstream `v*` release
workflows. Keep the upstream release/promotion workflows disabled in the fork,
and protect the `custom-v*` tag namespace. Maintain regular PR test and
security workflows as appropriate.

## Fresh installation using a signed custom release

On a **new, empty** Breeze host, clone this fork (including the helper scripts),
select the corresponding official baseline, and run guided setup normally with
one extra flag:

```bash
git clone https://github.com/robert-audat/breeze.git /opt/breeze-source
cd /opt/breeze-source
git switch custom
export BREEZE_SETUP_VERSION=0.130.0
export BREEZE_CUSTOM_RELEASE_REPOSITORY=robert-audat/breeze
export BREEZE_CUSTOM_RELEASE_PUBLIC_KEYS='<YOUR_CUSTOM_PUBLIC_KEY_BASE64>'
bash scripts/guided-setup.sh --work-dir /opt/breeze \
  --custom-release v0.130.0-custom.1
```

This requires a **published, signed** matching custom release, and is not a
replacement for upgrading an existing server. For an existing `/opt/breeze`,
use the upgrade path below and retain its data, secrets and volumes.

## Upgrade an existing installation on IONOS

Use the **fork's** `scripts/guided-setup.sh` and its adjacent
`scripts/custom-release/` helpers. Do not run a single unmodified upstream
installer file through `curl | bash` in custom mode. Example paths below assume
you cloned the fork into `/opt/breeze-source`, with the actual Breeze Compose
installation at `/opt/breeze`.

```bash
cd /opt/breeze-source
git switch custom
git pull --ff-only origin custom

# Obtain this PUBLIC key from your GitHub Actions environment variable.
export BREEZE_CUSTOM_RELEASE_PUBLIC_KEYS='<BASE64_ED25519_PUBLIC_KEY>'
export BREEZE_CUSTOM_RELEASE_REPOSITORY='robert-audat/breeze'

# Verify and stage images without restarting first.
sudo --preserve-env=BREEZE_CUSTOM_RELEASE_PUBLIC_KEYS,BREEZE_CUSTOM_RELEASE_REPOSITORY \
  bash scripts/guided-setup.sh \
    --work-dir /opt/breeze \
    --upgrade v0.130.0 \
    --custom-release v0.130.0-custom.1 \
    --no-up -y

# Review upgraded .env and release notes before the actual restart.
cd /opt/breeze
sudo docker compose config --images
```

`--no-up` updates and backs up `.env`, so take a database backup and perform
upgrade preflight **before** running it. The actual Compose rollout can then be
performed with the exact reviewed image set:

```bash
cd /opt/breeze
sudo docker compose pull
sudo docker compose up -d
sudo docker compose ps
```

**Important:** With `BINARY_SOURCE=local`, the signed binaries manifest pair
must be staged in the binaries volume. The `--no-up` command prints the exact
pair-placement instruction; follow it before `compose up -d`. To have guided
setup perform this placement and rollout itself, omit `--no-up` when running
the guided command after completing your preflight review. Do not run an upgrade
against production without reviewing upstream upgrade notes and migrations.

For the first switch from official to custom, `.env` must have the public key
set or receive it via the exported shell variable. The installer writes the
custom key and repository to `.env`, for reuse on subsequent upgrades.

On later upgrades, explicitly pass the intended new custom revision every time:

```bash
bash scripts/guided-setup.sh --work-dir /opt/breeze \
  --upgrade v0.130.0 --custom-release v0.130.0-custom.1
```

The installer refuses an upgrade without `--custom-release` when the existing
`.env` identifies a custom installation. This prevents accidental reversion to
the official server images.

## Important operational constraints

- The `guided-setup.sh` upgrade path updates its four image references and
  runtime version; it **does not** upgrade the Compose file. Compare
  `docker-compose.yml`, `.env.example` and `UPGRADING.md` on every upstream jump.
- PostgreSQL migrations may be forward-only. Back up the live database and
  relevant volumes before initiating any production upgrade; do not assume a
  Compose rollback restores data compatibility.
- Your existing IONOS S3, TURN, Caddy, M365 Graph executors, local OIDC signer
  and custom signed agent distribution must remain configured independently.
- The AGPL-3.0 core and separately commercially licensed `ee/` directory retain
  their respective license obligations.
- If custom code changes agent/backend protocols, test compatibility against
  your currently deployed agent and Viewer/Helper versions before rollout.
