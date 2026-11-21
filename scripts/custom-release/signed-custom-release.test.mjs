import assert from 'node:assert/strict';
import { generateKeyPairSync, createHash, verify } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const here = dirname(fileURLToPath(import.meta.url));
const generator = join(here, 'create-manifest.mjs');
const list = join(here, 'list-verified-images.sh');
const comparator = join(here, 'verify-image-set.sh');
const names = ['api','binaries','m365-communications-executor','m365-graph-actions-executor','m365-graph-read-executor','portal','web'];
const digest = (char) => `sha256:${char.repeat(64)}`;
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'breeze-custom-release-'));
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const source = 'a'.repeat(40);
  const official = {
    assets: [],
    images: names.map((name, i) => ({ digest: digest(String(i + 1)), name, repository: `ghcr.io/lanternops/breeze/${name}` })),
    release: 'v0.130.0', repository: 'LanternOps/breeze', schemaVersion: 1, sourceCommit: source,
  };
  writeFileSync(join(dir, 'official.json'), `${JSON.stringify(official, null, 2)}\n`);
  writeFileSync(join(dir, 'private.pem'), privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  const args = ['--release','v0.130.0-custom.1','--upstream','v0.130.0',
    '--repository','robert-audat/breeze','--source-commit',source,
    '--official-manifest',join(dir,'official.json'),
    '--signing-key-file',join(dir,'private.pem'),
    '--output-dir',join(dir,'assets'),
    '--api-ref',`ghcr.io/robert-audat/breeze/api@${digest('8')}`,
    '--web-ref',`ghcr.io/robert-audat/breeze/web@${digest('9')}`];
  return { dir, publicKey, args };
}
function run(command, args) { return spawnSync(command, args, { encoding: 'utf8' }); }

test('custom inventory binds upstream and verifies with dedicated Ed25519 key', (t) => {
  const f = fixture();
  t.after(() => rmSync(f.dir, { recursive:true, force:true }));
  const g = run(process.execPath, [generator, ...f.args]);
  assert.equal(g.status,0,g.stderr);
  const manifestBytes=readFileSync(join(f.dir,'assets','release-artifact-manifest.json'));
  const signature=Buffer.from(readFileSync(join(f.dir,'assets','release-artifact-manifest.json.ed25519'),'utf8').trim(),'base64');
  assert.ok(verify(null,manifestBytes,f.publicKey,signature));
  const manifest=JSON.parse(manifestBytes.toString('utf8'));
  assert.equal(manifest.upstreamRelease,'v0.130.0');
  assert.equal(manifest.upstreamManifestSha256,createHash('sha256').update(readFileSync(join(f.dir,'official.json'))).digest('hex'));
  assert.equal(manifest.images.find(x=>x.name==='binaries').repository,'ghcr.io/lanternops/breeze/binaries');
  const officialList=run('bash',[list,join(f.dir,'official.json')]);
  const customList=run('bash',[list,join(f.dir,'assets','release-artifact-manifest.json')]);
  assert.equal(officialList.status,0,officialList.stderr);
  assert.equal(customList.status,0,customList.stderr);
  writeFileSync(join(f.dir,'official.tsv'),officialList.stdout);
  writeFileSync(join(f.dir,'custom.tsv'),customList.stdout);
  const verified=run('bash',[comparator,join(f.dir,'official.tsv'),join(f.dir,'custom.tsv'),'robert-audat/breeze']);
  assert.equal(verified.status,0,verified.stderr);
  assert.match(verified.stdout,/2 custom server image override/);
  const bad=customList.stdout.replace(/ghcr.io\/lanternops\/breeze\/binaries/, 'ghcr.io/robert-audat/breeze/binaries');
  writeFileSync(join(f.dir,'bad.tsv'),bad);
  const blocked=run('bash',[comparator,join(f.dir,'official.tsv'),join(f.dir,'bad.tsv'),'robert-audat/breeze']);
  assert.notEqual(blocked.status,0);
  assert.match(blocked.stderr,/protected upstream binaries/);
  const tampered=Buffer.from(manifestBytes);
  tampered[35] ^= 1;
  assert.equal(verify(null,tampered,f.publicKey,signature),false);
});

test('manifest creator fails on different baseline or wrong image registry', (t) => {
  const f=fixture();
  t.after(() => rmSync(f.dir,{recursive:true,force:true}));
  const wrongVersion=run(process.execPath,[generator,...f.args.slice(0,1),'v0.129.0-custom.1',...f.args.slice(2)]);
  assert.notEqual(wrongVersion.status,0);
  const i=f.args.indexOf('--api-ref');
  const badArgs=[...f.args];
  badArgs[i+1]=`ghcr.io/other/repo/api@${digest('8')}`;
  const wrongRepository=run(process.execPath,[generator,...badArgs]);
  assert.notEqual(wrongRepository.status,0);
});
