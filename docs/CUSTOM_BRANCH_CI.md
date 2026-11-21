# Fork CI and GitHub protections

The default `main` is an exact upstream mirror; `custom` is the fork's
reviewed, self-hosted development branch. The GitHub `custom-v*` tag namespace
triggers the separately signed image publishing workflow.

## CI for the custom branch

`.github/workflows/custom-ci.yml` runs on PRs targeting `custom` and pushes
to `custom` and checks:

- Signed image verifier and guided-upgrade regression tests.
- API, Web and Portal lint/unit tests where supported.
- Actual runtime Docker builds, without any registry push, from
  `docker/Dockerfile.api`, `docker/Dockerfile.web` and
  `apps/portal/Dockerfile`.

The existing `secret-scan.yml` and `codeql.yml` workflows are reused,
not duplicated. Their branch triggers in `custom` target `custom`, while
the unchanged `main` branch retains upstream workflow sources.
`confidential-scan.yml` targets `custom` pushes in this branch. CodeQL
scheduled jobs still use the default branch (main) whenever that workflow is
enabled, due to GitHub scheduling semantics. No signing secrets, GHCR write
permissions, or production credentials are accessible to PR checks.

These checks are a minimum, not a replacement for upstream integration,
RLS isolation, live agent compatibility or pre-production smoke testing.
Add integration tests and a staging gate before making significant API,
database, remote-access or M365 executor changes.

## GitHub workflow states

Keep enabled:
- Custom Branch CI
- Signed custom Breeze server release (after the tag-trigger PR is merged)
- Secret Scan
- Confidential Scan
- CodeQL SAST
- smoke-binary-source-github and smoke-binary-source-local (PR-targeted)

Disable the inherited publishing jobs `release.yml`,
`release-promotion.yml`, `promote-release-images.yml`.
Disable upstream scheduled maintenance/hosted runners, perf and other
unneeded workflows as appropriate. Workflow enabled/disabled state is
repository-wide, not branch-specific. A workflow disabled in repository
settings cannot run on `custom` just because its YAML was changed.

## Protect upstream main

Use **Settings > Branches > Add branch protection rule** for exactly `main`.
Choose **Lock branch** and **Allow fork syncing**. Also disallow deletions and
force pushes (default protected-branch behavior). This is designed for
a fork whose `main` must not accept local commits; it does not block the
special upstream synchronization path.

Do not make `main` a writable integration branch. Upstream PR contributions
should start in `feature/*` from the synced upstream main, then be submitted
to LanternOps/breeze, not merged back into the fork's main.

## Protect custom

Create an active branch ruleset for exact name `custom`:

- Require PR before merging and require conversation resolution.
- Require status checks from **Custom / Release safety**, application test
  and Docker build matrix jobs, and **Secret Scan**.
- CodeQL can be required after confirming its check names/runs are available.
- Block force pushes and deletions.
- Optional one approving reviewer when another trusted collaborator is
  available; don't require a reviewer that a solo owner cannot supply.
- Avoid allowing admin bypass except for narrowly controlled recovery.

Register exact check names after they appear in successful PR runs. GitHub
may otherwise leave a PR blocked waiting for a check that cannot run.
Do not enable merge queue unless adopting its required checks and workflows.

## Protect tags

Use an active tag ruleset with exact pattern `custom-v*`:

- Restrict updates and deletions after initial creation.
- Restrict creations only when a deliberate publisher/admin bypass actor is
  configured; otherwise tag push will be denied to everyone.
- Protect the signing environment with `Selected branches and tags` and
  only allow the `custom-v*` **tag** pattern.
- Require a reviewed `custom` commit. The release validation job checks
  that the tag's commit exactly equals the current `custom` branch tip, and
  that its claimed upstream release agrees with official ancestry.
- Prefer a second approver when GitHub plan/collaboration supports it.
- Keep the signing private key in an environment secret, never in source.

## Binaries / agent signing

This server-focused custom workflow replaces API/Web images only. Portal
is currently tested but keeps the official image in the custom manifest.
Do not claim custom Portal/executor deployment until both build/publish and
signed manifest selection are extended.

The official binaries-init image and LanternOps binary release manifest
remain pinned to the official release and signing trust. Separately
self-signed Agent, Viewer or Helper artifacts require their own verified
manifest, key configuration and a supported distribution path. Never
silently replace the official binaries manifest with a custom server image
manifest or trust a newly downloaded signing key implicitly.
