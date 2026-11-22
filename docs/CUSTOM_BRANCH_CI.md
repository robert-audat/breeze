# Custom branch CI (Breeze fork)

This document is superseded by [Isolated custom GitHub Actions](CUSTOM_WORKFLOW_POLICY.md).
Read that document for the current workflow names, migration sequence,
required status checks, security scanning, upstream drift review, and signed
release trust boundaries.

In short:
- `main` is a locked upstream mirror; `custom` is the protected build branch.
- All active fork-owned workflows use `custom-*.yml` file names.
- `custom-ci.yml` provides `CUSTOM / Required Checks` across release safety,
  API/Web/Portal tests and read-only Docker builds.
- `custom-security.yml` validates dependency security; secret scanning,
  CodeQL, and binary source checks are separate custom workflows.
- `custom-release.yml` builds the signed, digest-pinned custom API/Web image
  release only after reviewed source and successful CI/security checks.
- Original upstream workflows stay in source control unchanged and are
  disabled in this fork after their custom equivalents have passed.

Do not publish a `custom-v*` tag before restricting initial tag creation
to a trusted release publisher and finalizing the signing environment.

Initial custom workflow validation: 2026-11-22.
