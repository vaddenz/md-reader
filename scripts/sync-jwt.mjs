#!/usr/bin/env node
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

function usage() {
  console.error(`用法: node scripts/sync-jwt.mjs [options]

  --sub <id>         JWT sub，默认 md-reader
  --days <n>         有效期天数，默认 3650
  --aud <value>      可选 aud
  --out-dir <dir>    私钥目录，默认 .sync-jwt
  --jwks <file>      公钥 JWKS 输出，默认 public/sync-jwks.json
  --help             显示帮助`);
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help') { usage(); process.exit(0); }
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const value = argv[i + 1];
    if (!value || value.startsWith('--')) { out[key] = true; continue; }
    out[key] = value;
    i += 1;
  }
  return out;
}

function b64url(input) {
  return Buffer.from(input).toString('base64url');
}

const args = parseArgs(process.argv.slice(2));
const sub = String(args.sub ?? 'md-reader');
const days = Number(args.days ?? 3650);
const aud = typeof args.aud === 'string' ? args.aud : '';
const keyDir = resolve(String(args['out-dir'] ?? '.sync-jwt'));
const jwksPath = resolve(String(args.jwks ?? 'public/sync-jwks.json'));
const privatePath = resolve(keyDir, 'private.pem');

mkdirSync(keyDir, { recursive: true });
if (!existsSync(privatePath)) {
  const pair = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  writeFileSync(privatePath, pair.privateKey, { mode: 0o600 });
}

const privatePem = readFileSync(privatePath, 'utf8');
const publicKey = createPublicKey(createPrivateKey(privatePem));
const jwk = publicKey.export({ format: 'jwk' });
const kid = createHash('sha256').update(`${jwk.kty}.${jwk.n}.${jwk.e}`).digest('base64url');
const jwks = { keys: [{ ...jwk, kid, alg: 'RS256', use: 'sig' }] };
mkdirSync(dirname(jwksPath), { recursive: true });
writeFileSync(jwksPath, `${JSON.stringify(jwks, null, 2)}\n`);

const now = Math.floor(Date.now() / 1000);
const header = { alg: 'RS256', typ: 'JWT', kid };
const payload = {
  sub,
  iat: now,
  exp: now + Math.max(1, days) * 86400,
  iss: 'md-reader',
  ...(aud ? { aud } : {}),
};
const input = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
const signature = sign('RSA-SHA256', Buffer.from(input), privatePem).toString('base64url');

console.error(`JWKS: ${jwksPath}`);
console.error(`sub: ${sub} · 有效 ${days} 天`);
console.error('把下面的 JWT 粘贴到 md-reader 的「设置 › 跨设备同步」：');
console.log(`${input}.${signature}`);
