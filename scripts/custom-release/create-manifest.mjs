#!/usr/bin/env node
// Run in trusted CI. The private signing key is read from a file and must never
// be committed or uploaded as a release asset.
import { createHash, createPrivateKey, sign } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const fail = (message) => { throw new Error(message); };
const cli = process.argv.slice(2);
if (cli.length % 2 !== 0) fail('each option must have a value');
const args = {};
for (let index = 0; index < cli.length; index += 2) {
  const key = cli[index];
  if (!/^--[a-z-]+$/u.test(key) || Object.hasOwn(args, key)) fail(`invalid or repeated option: ${key}`);
  args[key] = cli[index + 1];
}
function arg(name) { const value = args[`--${name}`]; if (!value) fail(`missing --${name}`); return value; }

const release = arg('release');
const upstream = arg('upstream');
const repository = arg('repository');
const sourceCommit = arg('source-commit');
const officialPath = arg('official-manifest');
const keyPath = arg('signing-key-file');
const outputDir = arg('output-dir');
const revisionRe = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)-custom\.([1-9]\d*)$/u;
const upstreamRe = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u;
if (!revisionRe.test(release) || !upstreamRe.test(upstream) || !release.startsWith(`${upstream}-custom.`)) {
  fail('custom version must be vUPSTREAM-custom.POSITIVE_REVISION');
}
if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(repository) || repository.toLowerCase() === 'lanternops/breeze') {
  fail('custom repository must be the fork owner/name');
}
if (!/^[0-9a-f]{40}$/u.test(sourceCommit)) fail('source commit must be a full Git commit SHA');
const officialBytes = readFileSync(officialPath);
const official = JSON.parse(officialBytes.toString('utf8'));
if (official.release !== upstream || official.repository.toLowerCase() !== 'lanternops/breeze' || official.schemaVersion !== 1) {
  fail('official manifest identity mismatch');
}
const required = ['api', 'binaries', 'm365-communications-executor', 'm365-graph-actions-executor', 'm365-graph-read-executor', 'portal', 'web'];
if (!Array.isArray(official.images) || official.images.length !== required.length ||
    required.some((name) => !official.images.some((image) => image.name === name))) {
  fail('official image set is incomplete');
}
const imageRefRe = /^([a-z0-9][a-z0-9.-]*(?::[0-9]{1,5})?\/[a-z0-9][a-z0-9._/-]*)@(sha256:[0-9a-f]{64})$/u;
const changes = {};
for (const name of ['api', 'web', 'portal']) {
  const ref = args[`--${name}-ref`];
  if (!ref) continue;
  const match = imageRefRe.exec(ref);
  const allowed = `ghcr.io/${repository.toLowerCase()}/${name}`;
  if (!match || match[1] !== allowed) fail(`${name} override must be a digest-pinned ${allowed} image`);
  changes[name] = { name, repository: match[1], digest: match[2] };
}
if (!Object.keys(changes).length) fail('at least one custom image is required');
const images = official.images.map((original) => changes[original.name] ?? {
  digest: original.digest, name: original.name, repository: original.repository,
}).sort((a, b) => a.name.localeCompare(b.name));

// Deliberately preserve the canonical layout expected by Breeze's existing
// bash verifier: sourceCommit is the final top-level field without a comma.
const manifest = {
  assets: [],
  images,
  release,
  repository,
  schemaVersion: 1,
  upstreamManifestSha256: createHash('sha256').update(officialBytes).digest('hex'),
  upstreamRelease: upstream,
  sourceCommit,
};
const data = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
const privateKey = createPrivateKey(readFileSync(keyPath));
if (privateKey.asymmetricKeyType !== 'ed25519') fail('signing key must be Ed25519');
const signature = sign(null, data, privateKey);
mkdirSync(outputDir, { recursive: true });
writeFileSync(join(outputDir, 'release-artifact-manifest.json'), data, { mode: 0o644 });
writeFileSync(join(outputDir, 'release-artifact-manifest.json.ed25519'), `${signature.toString('base64')}\n`, { mode: 0o644 });
console.log(`Created signed custom release ${release}, upstream ${upstream}, commit ${sourceCommit}`);
