#!/usr/bin/env node
// Advisory only. Compare the last reviewed upstream release with the fork's
// current main mirror, and compare mapped upstream workflows to custom files.
// Never modify a baseline or suppress any required check.
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, appendFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '../..');
const baseline = JSON.parse(readFileSync(join(root, 'scripts/custom-release/workflow-baseline.json'), 'utf8'));
const reviewed = baseline.upstreamCommit;
const upstream = 'refs/remotes/origin/main';
const output = resolve(process.env.REPORT_DIR || join(root, '.git/custom-upstream-review'));
mkdirSync(output, { recursive: true });

function git(args, allowed = [0]) {
  const result = spawnSync('git', args, {
    cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error || !allowed.includes(result.status)) {
    throw new Error('git ' + args.join(' ') + ': ' + (result.error?.message || result.stderr || result.status));
  }
  return result.stdout;
}
function at(ref, file) {
  const result = spawnSync('git', ['show', ref + ':' + file], {
    cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
  });
  return result.status === 0 && !result.error ? result.stdout : null;
}
function blob(ref, file) {
  const result = spawnSync('git', ['rev-parse', '--verify', ref + ':' + file], {
    cwd: root, encoding: 'utf8',
  });
  return result.status === 0 && !result.error ? result.stdout.trim() : null;
}
function changed(from, to) {
  return git(['diff', '--no-ext-diff', '--name-only', '-z', from, to]).split('\0').filter(Boolean);
}
function classify(file) {
  if (/^\.github\/workflows\/(?!custom-).+\.ya?ml$/.test(file)) return 'Original workflows';
  if (file.startsWith('.github/actions/')) return 'Shared local actions';
  if (/(^|\/)(vitest|jest|playwright|eslint)[^/]*config\.[^/]+$/.test(file)
    || /(^|\/)__tests__\/.*setup/.test(file)) return 'Test configurations';
  if (/(^|\/)(__tests__\/|[^/]+\.(test|spec)\.[cm]?[jt]sx?$)/.test(file))
    return 'Application and endpoint tests';
  if (/^apps\/api\/src\/routes\//.test(file)
    || /^apps\/(web|portal)\/src\/(pages\/api|lib\/api)\//.test(file))
    return 'API and endpoint implementation';
  if (/(^|\/)(Dockerfile[^/]*|docker-compose[^/]*)$/.test(file)
    || /^scripts\/(release|security)\//.test(file)
    || file === 'scripts/guided-setup.sh') return 'Build, release and security tooling';
  if (/^(package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|\.node-version)$/.test(file)
    || /^apps\/(api|web|portal)\/package\.json$/.test(file))
    return 'Dependency and runtime inputs';
  return null;
}
function quote(file) { return String.fromCharCode(96) + file + String.fromCharCode(96); }
function shorten(value) { return value.slice(0, 12); }
function cap(text) {
  const max = 4 * 1024 * 1024;
  return text.length > max
    ? text.slice(0, max) + '\n\n[TRUNCATED: generate the full diff locally with git]\n'
    : text;
}
if (!/^[a-f0-9]{40}$/.test(reviewed || '')) {
  throw new Error('workflow-baseline.json needs a manually reviewed upstreamCommit');
}
git(['cat-file', '-e', reviewed + '^{commit}']);
const mainSha = git(['rev-parse', upstream + '^{commit}']).trim();
const headSha = git(['rev-parse', 'HEAD^{commit}']).trim();
const ancestor = spawnSync('git', ['merge-base', '--is-ancestor', reviewed, upstream], {cwd: root}).status === 0;
const upstreamChanges = changed(reviewed, upstream).filter(classify);
const checkoutChanges = new Set(changed(reviewed, 'HEAD'));
const mappings = baseline.workflowMappings || {};
const mappedOriginals = new Set(Object.keys(mappings));
const newWorkflows = upstreamChanges.filter(file =>
  classify(file) === 'Original workflows' && !mappedOriginals.has(file));
const changesByCategory = {};
for (const file of upstreamChanges) {
  const kind = classify(file);
  const sameAsMain = blob(upstream, file) === blob('HEAD', file);
  const integrated = sameAsMain ? 'same upstream blob in checkout'
    : checkoutChanges.has(file) ? 'different version in checkout' : 'not yet integrated';
  (changesByCategory[kind] ||= []).push({ file, integrated });
}

const scratch = mkdtempSync(join(tmpdir(), 'breeze-workflow-diff-'));
const comparisons = [];
const patchPairs = [];
try {
  for (const [original, customFiles] of Object.entries(mappings)) {
    const originalContent = at(upstream, original);
    for (const custom of customFiles) {
      const customContent = at('HEAD', custom);
      const present = originalContent !== null && customContent !== null;
      let differs = null;
      if (present) {
        const before = join(scratch, 'upstream.yml');
        const after = join(scratch, 'custom.yml');
        writeFileSync(before, originalContent);
        writeFileSync(after, customContent);
        const diff = git(['diff', '--no-ext-diff', '--no-index', '--', before, after], [0, 1]);
        differs = Boolean(diff);
        patchPairs.push('## ' + original + ' --> ' + custom + '\n' + (diff || '[Identical]\n'));
      } else {
        patchPairs.push('## ' + original + ' --> ' + custom + '\n[File missing in main or checkout]\n');
      }
      comparisons.push({
        original, custom, changedInMain: upstreamChanges.includes(original),
        originalPresent: originalContent !== null, customPresent: customContent !== null, differs,
      });
    }
  }
} finally {
  rmSync(scratch, {recursive: true, force: true});
}

const upstreamPatch = upstreamChanges.length
  ? git(['diff', '--no-ext-diff', '--unified=3', reviewed, upstream, '--', ...upstreamChanges])
  : '[No relevant upstream changes]\n';
writeFileSync(join(output, 'upstream-changes.patch'), cap(upstreamPatch));
writeFileSync(join(output, 'workflow-pair-comparisons.patch'), cap(patchPairs.join('\n')));
writeFileSync(join(output, 'upstream-changed-files.tsv'),
  upstreamChanges.map(file => classify(file) + '\t' + file).join('\n') + '\n');

const summary = [
  '# CUSTOM upstream compatibility review (advisory only)', '',
  'Differences are review prompts, not merge blockers or automatic baseline acknowledgements.', '',
  '- Reviewed upstream: **' + baseline.upstreamRelease + '** (' + quote(shorten(reviewed)) + ')',
  '- Current mirror main: ' + quote(shorten(mainSha)),
  '- PR/push checkout: ' + quote(shorten(headSha)),
  '- Reviewed baseline is ancestor of mirror: ' + (ancestor ? 'yes' : '**NO: inspect history**'),
  '- Relevant upstream changes: **' + upstreamChanges.length + '**',
  '- New or unmapped original workflows: **' + newWorkflows.length + '**', '',
];
if (upstreamChanges.length === 0) summary.push('No relevant upstream changes since the reviewed baseline.', '');
for (const [kind, items] of Object.entries(changesByCategory)) {
  summary.push('## ' + kind + ' (' + items.length + ')', '');
  for (const item of items.slice(0, 100)) summary.push('- ' + quote(item.file) + ': ' + item.integrated);
  if (items.length > 100) summary.push('- ... ' + (items.length - 100) + ' additional changes in the artifact');
  summary.push('');
}
summary.push('## Upstream to CUSTOM workflow mappings', '',
  'These workflows intentionally differ. Inspect the comparison artifact whenever the upstream workflow changes.', '');
for (const entry of comparisons) {
  summary.push('- ' + quote(entry.original) + ' -> ' + quote(entry.custom) + ': '
    + ((!entry.originalPresent || !entry.customPresent) ? '**missing file**'
      : entry.changedInMain ? 'upstream changed; compare implementations' : 'no upstream change'));
}
summary.push('', '## Human review checklist', '',
  '- [ ] Review upstream CI, security, release, and shared-action changes.',
  '- [ ] Review endpoint and app-test changes, test discovery, and runtime dependencies.',
  '- [ ] Compare upstream improvements against the independent CUSTOM workflow implementations.',
  '- [ ] Adapt CUSTOM code through a separately reviewed PR when necessary.',
  '- [ ] Advance the reviewed commit and baseline hashes only after review and integration.', '',
  'Download the artifact for full upstream and workflow-pair diffs, changed-file inventory and JSON.', '');
writeFileSync(join(output, 'report.md'), summary.join('\n'));
writeFileSync(join(output, 'report.json'), JSON.stringify({
  policy: 'advisory-only', baselineRelease: baseline.upstreamRelease,
  baselineCommit: reviewed, mainSha, headSha, baselineAncestor: ancestor,
  changesByCategory, unmappedWorkflows: newWorkflows, comparisons,
}, null, 2) + '\n');
if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary.join('\n'));
}
if (upstreamChanges.length > 0) {
  console.log('::notice title=Upstream compatibility review::' + upstreamChanges.length
    + ' relevant upstream change(s). See the review artifact.');
}
if (newWorkflows.length) {
  console.log('::warning title=Unmapped upstream workflows::' + newWorkflows.length
    + ' changed workflow(s) have no mapping; inspect review report.');
}
if (!ancestor) console.log('::warning title=Baseline history::Reviewed commit is not ancestor of main.');
for (const entry of comparisons) {
  if (!entry.originalPresent || !entry.customPresent) {
    console.log('::warning title=Missing workflow mapping::' + entry.original + ' -> ' + entry.custom);
  }
}
console.log('CUSTOM upstream review: ' + upstreamChanges.length
  + ' relevant file(s); ' + newWorkflows.length + ' unmapped workflow(s).');
