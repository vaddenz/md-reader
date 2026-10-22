import { describe, expect, it } from 'vitest';
import { MATCHA_ZH_EN_MANIFEST, MATCHA_ZH_EN_TOTAL_SIZE } from '../../src/tts/model-manifest';

describe('Matcha zh-en 模型清单', () => {
  it('文件路径唯一、SHA 为 64 位十六进制、总量约 140MB', () => {
    const paths = MATCHA_ZH_EN_MANIFEST.files.map((file) => file.path);
    expect(new Set(paths).size).toBe(paths.length);
    for (const file of MATCHA_ZH_EN_MANIFEST.files) {
      expect(file.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(file.url.startsWith('https://modelscope.cn/')).toBe(true);
      expect(file.size).toBeGreaterThan(0);
    }
    expect(MATCHA_ZH_EN_TOTAL_SIZE).toBeGreaterThan(130 * 1024 * 1024);
    expect(MATCHA_ZH_EN_TOTAL_SIZE).toBeLessThan(150 * 1024 * 1024);
  });

  it('只有一个 tar.gz 归档且带 archive 标记', () => {
    const archives = MATCHA_ZH_EN_MANIFEST.files.filter((file) => file.archive);
    expect(archives).toHaveLength(1);
    expect(archives[0].path).toBe('espeak-ng-data.tar.gz');
  });
});
