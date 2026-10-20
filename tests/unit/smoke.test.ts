import { describe, expect, it } from 'vitest';
import { APP_TITLE, DEFAULT_REPO } from '../../src/constants';

describe('常量', () => {
  it('标题与默认仓库配置就绪', () => {
    expect(APP_TITLE).toBe('知识库');
    expect(DEFAULT_REPO).toEqual({ owner: 'your-name', repo: 'your-notes', branch: 'main' });
  });
});
