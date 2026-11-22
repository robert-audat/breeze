# Isolated custom GitHub Actions for the Breeze fork

This fork keeps the repository default branch `main` as a locked, clean mirror
of LanternOps. `custom` is the protected source for the self-hosted build.
Never modify upstream workflow files as a routine way to run custom CI.

## Workflow ownership

| Inherited original (retained) | Fork-owned workflow |
| --- | --- |
| `ci.yml` (disabled upstream CI/merge queue) | `custom-ci.yml` |
| `codeql.yml` | `custom-codeql.yml` |
| `secret-scan.yml` | `custom-secret-scan.yml` |
| `confidential-scan.yml` | `custom-confidential-scan.yml` |
| `ci-smoke-binary-source-github.yml` | `custom-binary-source-github.yml` |
| `ci-smoke-binary-source-local.yml` | `custom-binary-source-local.yml` (copy pending; see below) |
| `windows-installer-bootstrap.yml` | `custom-windows-installer.yml` |
| `security.yml` (hosted scheduling/reporting disabled) | `custom-security.yml` (dependency audit) |
| `release.yml` + release promotions | `custom-release.yml` |

The original workflows are retained for upstream comparison and stay disabled
in the fork after replacement checks pass. Disabling workflows in GitHub is
repository-wide and cannot be expressed per branch in YAML.

**Do not disable an original workflow until its replacement has run
successfully.** The local binary source smoke workflow is deliberately retained
on the custom branch until its new copy can be committed and tested. The
connected GitHub tool could not write the full 12KB copy; use a local clone to
finish this one source-preserving operation:

```bash
git fetch origin
git switch feat/isolated-custom-workflows
git pull --ff-only origin feat/isolated-custom-workflows

cp .github/workflows/ci-smoke-binary-source-local.yml \
   .github/workflows/custom-binary-source-local.yml
python3 - <<'PY'
from pathlib import Path
p=Path('.github/workflows/custom-binary-source-local.yml')
s=p.read_text()
s=s.replace('name: smoke-binary-source-local',
            'name: CUSTOM / Binary Source - Local', 1)
s=s.replace('name: BINARY_SOURCE=local download path',
            'name: CUSTOM / BINARY_SOURCE=local download path', 1)
s=s.replace('.github/workflows/ci-smoke-binary-source-local.yml',
            '.github/workflows/custom-binary-source-local.yml', 1)
p.write_text(s)
PY

# Restore the untouched v0.130.0 original in this custom branch.
git fetch upstream --tags
git show v0.130.0:.github/workflows/ci-smoke-binary-source-local.yml \
  > .github/workflows/ci-smoke-binary-source-local.yml

actionlint .github/workflows/custom-binary-source-local.yml
git add .github/workflows/custom-binary-source-local.yml \
        .github/workflows/ci-smoke-binary-source-local.yml
git commit -m "ci: isolate local binary source smoke workflow"
git push origin feat/isolated-custom-workflows
```

This will remove the single remaining original-workflow drift warning.
Never replace this comprehensive end-to-end test with a less complete smoke
check merely to shorten the workflow.

## Required custom CI and security checks

`custom-ci.yml` runs on PRs to `custom` and pushes to `custom`.
It validates release safety, builds API/Web/Portal without publishing, runs
their unit/lint suites and reports the stable aggregate:

- `CUSTOM / Required Checks`

Separate secret and dependency workflows run on every PR and push:

- `CUSTOM / Gitleaks`
- `CUSTOM / Dependency audit`
- `CUSTOM / Confidential info` (PR checks run without the private denylist)

The `custom-codeql.yml` workflow also runs on `custom` PRs and pushes
using Go, JavaScript/TypeScript and Actions analysis. Its reports have
separate matrix names. No custom scheduled/manual workflow requires adding
code to the locked default `main` branch.

Set the `custom` branch ruleset required checks only **after** all have
appeared and passed on a real PR. At minimum require the three checks above
except Confidential info, which can also become required once green. Keep
required checks independent of path-filtered workflows; otherwise PRs
unrelated to those paths may wait indefinitely.

## Complete the enable/disable transition

After reviewing and merging this PR, and after any remaining local workflow
copy is merged and its checks pass:

```bash
REPO=robert-audat/breeze
for f in custom-ci.yml custom-release.yml custom-codeql.yml \
         custom-secret-scan.yml custom-confidential-scan.yml \
         custom-binary-source-github.yml custom-binary-source-local.yml \
         custom-windows-installer.yml custom-security.yml; do
  gh workflow enable "$f" -R "$REPO"
done
for f in codeql.yml secret-scan.yml confidential-scan.yml \
         ci-smoke-binary-source-github.yml ci-smoke-binary-source-local.yml \
         windows-installer-bootstrap.yml; do
  gh workflow disable "$f" -R "$REPO"
done
gh workflow list --all --limit 100 -R "$REPO"
```

Retain all other inherited upstream release, hosted CI, merge-queue and
scheduled workflows disabled. If a new workflow has not yet been indexed by
GitHub, first let the corresponding PR/push event run it, and then retry.

## Upstream workflow drift

`scripts/custom-release/check-workflow-drift.mjs` compares the original
workflow blobs with the last manually reviewed official baseline recorded in
`scripts/custom-release/workflow-baseline.json`. It emits GitHub warnings,
not CI failures. After integrating a new official Breeze release:

1. Examine upstream original changes in `.github/workflows/` and
   `.github/actions/`.
2. Update fork-owned `custom-*.yml` where security fixes, build behavior,
   dependency requirements or tests need to be carried forward.
3. Run actionlint and CI; update the reviewed baseline manifest only after
   consciously reviewing the originals.

## Signed releases and release protection

Official `v0.130.0` points to the same `e8ba47ef...` commit from which
the current `custom` branch diverges. Its official signed image manifest
assets exist. Do not merge newer upstream main development commits into
`custom` before publishing a release claiming this baseline.

The `custom-release.yml` tag trigger requires `custom-v*` and checks:
exact tagged commit equals current `custom` branch head; official ancestry;
successful `CUSTOM / Required Checks`, `CUSTOM / Gitleaks`, and
`CUSTOM / Dependency audit` on that exact commit; signature-verifiable
official inventory. It then builds digest-pinned custom API/Web images and
creates a separately signed custom inventory.

**Critical trust boundary:** the workflow is loaded from the tagged commit.
Its own verification logic cannot stop a user who is allowed to create
`custom-v*` tags pointing to malicious workflow code. Before publishing,
update `Protect Custom Releases` to restrict **initial tag creations**,
with an explicitly authorized and narrowly scoped release publisher bypass.
Keep tag updates/deletions restricted. Configure independent required
reviewers for `custom-release-signing` where possible, and protect the
`custom` branch with PR review and required CI checks. Until those
administrator settings are confirmed, do **not** push a release tag.

All server-only releases retain original signed binaries and original M365
executor image references. Self-signed agents/viewers/helpers use a separate
binary signing trust and distribution process. Portal and custom M365 executor
publishing need additional workflows/manifest policy before use in production.
