// @vitest-environment node
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

let dir = '';
afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

function run(args: string[]) {
  return spawnSync(process.execPath, ['scripts/sync-jwt.mjs', ...args], { encoding: 'utf8' });
}

describe('sync-jwt script', () => {
  it('生成三段式 JWT 与 RS256 JWKS', () => {
    dir = mkdtempSync(join(tmpdir(), 'sync-jwt-'));
    const out = execFileSync(process.execPath, [
      'scripts/sync-jwt.mjs',
      '--sub', 'test-user',
      '--days', '1',
      '--out-dir', join(dir, 'keys'),
      '--jwks', join(dir, 'jwks.json'),
    ], { encoding: 'utf8' });
    const token = out.trim().split('\n').pop()!;
    expect(token.split('.')).toHaveLength(3);
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
    expect(payload.sub).toBe('test-user');
    const jwks = JSON.parse(readFileSync(join(dir, 'jwks.json'), 'utf8'));
    expect(jwks.keys[0]).toMatchObject({ alg: 'RS256', use: 'sig' });
    expect(jwks.keys[0].kid).toBeTruthy();
  });

  it.each(['abc', '0', '-1', '1.5'])('拒绝非法 --days=%s 且不创建密钥', (value) => {
    dir = mkdtempSync(join(tmpdir(), 'sync-jwt-'));
    const keyDir = join(dir, 'keys');
    const jwksPath = join(dir, 'jwks.json');
    const res = run(['--days', value, '--out-dir', keyDir, '--jwks', jwksPath]);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain('--days 需要正整数');
    expect(res.stdout).toBe('');
    expect(existsSync(join(keyDir, 'private.pem'))).toBe(false);
    expect(existsSync(jwksPath)).toBe(false);
  });

  it('拒绝裸 --days（缺少值）且不创建密钥', () => {
    dir = mkdtempSync(join(tmpdir(), 'sync-jwt-'));
    const keyDir = join(dir, 'keys');
    const jwksPath = join(dir, 'jwks.json');
    const res = run(['--days', '--out-dir', keyDir, '--jwks', jwksPath]);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain('--days 需要正整数');
    expect(existsSync(join(keyDir, 'private.pem'))).toBe(false);
    expect(existsSync(jwksPath)).toBe(false);
  });

  it('拒绝裸 --sub（缺少值）且不创建密钥', () => {
    dir = mkdtempSync(join(tmpdir(), 'sync-jwt-'));
    const keyDir = join(dir, 'keys');
    const jwksPath = join(dir, 'jwks.json');
    const res = run(['--sub', '--out-dir', keyDir, '--jwks', jwksPath]);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain('--sub 需要非空字符串');
    expect(res.stdout).toBe('');
    expect(existsSync(join(keyDir, 'private.pem'))).toBe(false);
    expect(existsSync(jwksPath)).toBe(false);
  });

  const itPosix = process.platform === 'win32' ? it.skip : it;
  itPosix('复用已有私钥时收紧权限到 0600', () => {
    dir = mkdtempSync(join(tmpdir(), 'sync-jwt-'));
    const keyDir = join(dir, 'keys');
    const jwksPath = join(dir, 'jwks.json');
    const privatePath = join(keyDir, 'private.pem');
    const args = ['--sub', 'test-user', '--out-dir', keyDir, '--jwks', jwksPath];
    expect(run(args).status).toBe(0);
    chmodSync(privatePath, 0o644);
    expect(run(args).status).toBe(0);
    expect(statSync(privatePath).mode & 0o777).toBe(0o600);
  });
});
