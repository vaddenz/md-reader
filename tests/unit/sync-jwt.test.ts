// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

let dir = '';
afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

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
});
