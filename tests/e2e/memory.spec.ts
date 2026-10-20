import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { BANK_PATH, BANK_TEXT, configureAndSync, readKv, readStore, writeKv } from './fixtures';

test('记忆助手：入口可见、题库拉取体检、选择持久化', async ({ page }) => {
  await configureAndSync(page);

  await page.getByRole('link', { name: '记忆助手' }).click();
  await expect(page.getByRole('heading', { name: '记忆助手', level: 1 })).toBeVisible();
  await expect(page.getByText('未配置模型，将使用「对照参考答案 + 自评」模式。')).toBeVisible();

  const bank = page.locator('.memory-bank').filter({ hasText: '示例题库' });
  await expect(bank).toContainText('未获取');

  await bank.getByRole('checkbox').check();
  await expect(bank).toContainText('5 题');
  await expect(bank).toContainText('1 处问题');

  // 选择落库
  await expect.poll(async () => (await readKv(page, 'memSelection') as { banks?: string[] } | undefined)?.banks)
    .toEqual(['题库/示例题库.jsonl']);

  // 筛选选项来自已加载题库
  await expect(page.getByRole('group', { name: '题型' })).toContainText('概念');

  // 刷新后仍勾选、题量仍在（缓存命中，无需再拉取）
  await page.reload();
  await expect(bank.getByRole('checkbox')).toBeChecked();
  await expect(bank).toContainText('5 题');
});

/** 只选示例题库的选择配置（T7/T9 用例同样先预置选择，再直接进概览页）。 */
const BANK_ONLY_SELECTION = {
  banks: [BANK_PATH],
  filters: { kinds: [], chapters: [], types: [], tags: [], difficulty: [] },
  sessionSize: 20, newPerDay: 10,
};

test('记忆助手：预选题库自动加载', async ({ page }) => {
  await configureAndSync(page);
  await writeKv(page, 'memSelection', BANK_ONLY_SELECTION);

  await page.goto('./#/memory');

  const bank = page.locator('.memory-bank').filter({ hasText: '示例题库' });
  await expect(bank.getByRole('checkbox')).toBeChecked();
  await expect(bank).toContainText('5 题');
  await expect(bank).toContainText('1 处问题');
  // 自动加载结果同样进入筛选数据源
  await expect(page.getByRole('group', { name: '题型' })).toContainText('概念');
});

test('记忆助手：同步后 sha 变化使解析缓存失效并自动重载', async ({ page }) => {
  const mock = await configureAndSync(page);

  // 先手动加载一次（memSelection 落库 + mem_banks 存下旧 sha 的解析结果）
  await page.getByRole('link', { name: '记忆助手' }).click();
  const bank = page.locator('.memory-bank').filter({ hasText: '示例题库' });
  await bank.getByRole('checkbox').check();
  await expect(bank).toContainText('5 题');

  // 题库更新（换 sha + 多一题 → 6 题）并同步：旧解析结果必须立即失效
  const updated = BANK_TEXT + JSON.stringify({ id: 'Q3.1', type: '概念', chapter: '3. 补充', question: '什么是宏任务？', answer: '- 宏任务队列。' }) + '\n';
  mock.updateDoc(BANK_PATH, updated);
  await page.goto('./#/settings');
  await page.getByRole('button', { name: '立即同步' }).click();
  await expect(page.getByText('上次同步：刚刚')).toBeVisible();

  // 回到概览页：sha 不一致 → 不沿用旧解析，自动重载新版本
  await page.goto('./#/memory');
  await expect(page.locator('.memory-bank').filter({ hasText: '示例题库' })).toContainText('6 题');
});

test('记忆助手：自动加载失败静默保留「未获取」，连网后手动重试可加载', async ({ page }) => {
  const mock = await configureAndSync(page);
  await writeKv(page, 'memSelection', BANK_ONLY_SELECTION);
  mock.setFailNetwork(true);

  await page.goto('./#/memory');
  const bank = page.locator('.memory-bank').filter({ hasText: '示例题库' });
  await expect(bank).toContainText('未获取');
  // 失败静默：不弹 toast
  await expect(page.locator('.toast')).toHaveCount(0);

  // 手动重试（取消 / 重勾）在恢复网络后加载成功
  mock.setFailNetwork(false);
  await bank.getByRole('checkbox').uncheck();
  await bank.getByRole('checkbox').check();
  await expect(bank).toContainText('5 题');
});

/** 只练问答「概念」题：队列被限定为 [Q1.1, Q1.2]（追问题型被筛掉，不受链排序影响）。 */
const QA_ONLY_SELECTION = {
  banks: ['题库/示例题库.jsonl'],
  filters: { kinds: ['qa'], chapters: [], types: ['概念'], tags: [], difficulty: [] },
  sessionSize: 20, newPerDay: 10,
};

test('问答训练：AI 评分 → 命中/遗漏与参考答案 → 记录落库 → 下一题', async ({ page }) => {
  await configureAndSync(page);
  await writeKv(page, 'memSelection', QA_ONLY_SELECTION);
  await writeKv(page, 'llmConfig', { baseUrl: 'https://llm.example/v1', apiKey: 'k', model: 'm' });
  await page.route('https://llm.example/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ choices: [{ message: { content: JSON.stringify({ score: 82, hit: ['事件循环调度'], missed: ['libuv'], comment: '基本正确' }) } }] }),
    }),
  );

  await page.goto('./#/memory');
  await page.locator('.memory-bank').filter({ hasText: '示例题库' }).getByRole('checkbox').check();
  await expect(page.locator('.memory-bank').filter({ hasText: '示例题库' })).toContainText('5 题');
  await page.getByRole('button', { name: '开始训练' }).click();

  await expect(page).toHaveURL(/#\/memory\/train$/);
  await expect(page.locator('.memory-question')).toContainText('什么是事件循环？');

  await page.getByLabel('作答').fill('事件循环负责调度异步回调，由 libuv 支持。');
  await page.getByRole('button', { name: '提交' }).click();

  await expect(page.locator('.memory-score')).toContainText('82');
  await expect(page.getByText('基本正确')).toBeVisible();
  await expect(page.locator('.memory-answer')).toContainText('事件循环负责调度异步回调');

  expect(await readStore(page, 'mem_srs')).toMatchObject([{ qid: expect.any(String), stage: 1 }]);
  expect(await readStore(page, 'mem_attempts')).toMatchObject([{ mode: 'ai', score: 82, verdict: 'good' }]);

  await page.getByRole('button', { name: '下一题' }).click();
  await expect(page.locator('.memory-question')).toContainText('什么是微任务？');
});

test('自评降级与提示：hint 优先、刷新恢复、查看答案后自评落库', async ({ page }) => {
  await configureAndSync(page);
  await writeKv(page, 'memSelection', QA_ONLY_SELECTION);

  await page.goto('./#/memory');
  await page.locator('.memory-bank').filter({ hasText: '示例题库' }).getByRole('checkbox').check();
  await expect(page.locator('.memory-bank').filter({ hasText: '示例题库' })).toContainText('5 题');
  await page.getByRole('button', { name: '开始训练' }).click();
  await expect(page.locator('.memory-question')).toContainText('什么是事件循环？');

  await page.getByRole('button', { name: '提示' }).click();
  await expect(page.getByText('想 libuv')).toBeVisible();

  await page.reload();
  await expect(page.locator('.memory-question')).toContainText('什么是事件循环？');

  await page.getByRole('button', { name: '查看参考答案' }).click();
  await expect(page.locator('.memory-answer')).toContainText('事件循环负责调度异步回调');
  await page.getByRole('button', { name: '会', exact: true }).click();
  await expect(page.getByText('已记录（自评）')).toBeVisible();

  expect(await readStore(page, 'mem_attempts')).toMatchObject([{ mode: 'self', verdict: 'good', revealed: true }]);
  expect(await readStore(page, 'mem_srs')).toMatchObject([{ stage: 1 }]);
});

test('评分中点查看参考答案：取消在途评分，直接进入自评视图且不落记录', async ({ page }) => {
  await configureAndSync(page);
  await writeKv(page, 'memSelection', QA_ONLY_SELECTION);
  await writeKv(page, 'llmConfig', { baseUrl: 'https://llm.example/v1', apiKey: 'k', model: 'm' });
  // 延迟 1.5s 才返回：留出「评分中」窗口，用于在途评分被取消的场景。
  await page.route('https://llm.example/**', async (route) => {
    await new Promise((r) => setTimeout(r, 1500));
    try {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ choices: [{ message: { content: JSON.stringify({ score: 82, hit: [], missed: [], comment: '迟到结果' }) } }] }),
      });
    } catch {
      // 请求已被页面取消，mock 的迟到响应无处投递，忽略。
    }
  });

  await page.goto('./#/memory');
  await page.locator('.memory-bank').filter({ hasText: '示例题库' }).getByRole('checkbox').check();
  await expect(page.locator('.memory-bank').filter({ hasText: '示例题库' })).toContainText('5 题');
  await page.getByRole('button', { name: '开始训练' }).click();
  await expect(page.locator('.memory-question')).toContainText('什么是事件循环？');

  await page.getByLabel('作答').fill('事件循环负责调度异步回调，由 libuv 支持。');
  await page.getByRole('button', { name: '提交' }).click();
  await expect(page.getByRole('button', { name: '评分中…' })).toBeVisible();

  // 评分进行中点「查看参考答案」：取消请求 → 进入自评视图（而非退回作答视图）
  await page.getByRole('button', { name: '查看参考答案' }).click();
  await expect(page.locator('.memory-answer')).toBeVisible();
  await expect(page.getByRole('button', { name: '会', exact: true })).toBeVisible();
  await expect(page.locator('.memory-input')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '评分中…' })).toHaveCount(0);

  // 被取消的评分不写入记录与进度
  expect(await readStore(page, 'mem_attempts')).toEqual([]);
  expect(await readStore(page, 'mem_srs')).toEqual([]);
});

test('结束训练清理会话：尾部题目已不在题库时，点「下一题」结束并删除 memSession', async ({ page }) => {
  await configureAndSync(page);
  await writeKv(page, 'memSelection', QA_ONLY_SELECTION);
  await page.goto('./#/memory');
  await page.locator('.memory-bank').filter({ hasText: '示例题库' }).getByRole('checkbox').check();
  await expect(page.locator('.memory-bank').filter({ hasText: '示例题库' })).toContainText('5 题');

  // 用真实 qid 拼一个「首题可作答 + 尾题已从题库消失」的会话：答完首题后无下一题可作答。
  const bank = await readStore(page, 'mem_banks', BANK_PATH) as { questions: { qid: string; id: string }[] };
  const qid = bank.questions.find((q) => q.id === 'Q1.1')?.qid;
  expect(qid).toBeTruthy();
  await writeKv(page, 'memSession', {
    createdAt: Date.now(), startedAt: Date.now(), index: 0, answered: 0, scores: [],
    items: [
      { qid, bankPath: BANK_PATH, id: 'Q1.1' },
      { qid: 'q_missing_from_bank', bankPath: BANK_PATH, id: 'QX' },
    ],
  });

  await page.goto('./#/memory/train');
  await expect(page.locator('.memory-question')).toContainText('什么是事件循环？');
  await page.getByRole('button', { name: '查看参考答案' }).click();
  await page.getByRole('button', { name: '会', exact: true }).click();
  await expect(page.getByText('已记录（自评）')).toBeVisible();

  await page.getByRole('button', { name: '下一题' }).click();
  await expect(page.getByRole('heading', { name: '本次训练完成' })).toBeVisible();
  expect(await readKv(page, 'memSession')).toBeUndefined();
});

const ALL_KINDS_SELECTION = {
  banks: ['题库/示例题库.jsonl'],
  filters: { kinds: [], chapters: [], types: [], tags: [], difficulty: [] },
  sessionSize: 20, newPerDay: 10,
};

test('选择题提交前查看参考答案：按不会记录且档位不推进', async ({ page }) => {
  await configureAndSync(page);
  await writeKv(page, 'memSelection', ALL_KINDS_SELECTION);
  await page.goto('./#/memory');
  await page.locator('.memory-bank').filter({ hasText: '示例题库' }).getByRole('checkbox').check();
  await expect(page.locator('.memory-bank').filter({ hasText: '示例题库' })).toContainText('5 题');

  // 直接预置一个只含单选 Q2.1 的会话，免去前几题的作答。
  const bank = await readStore(page, 'mem_banks', BANK_PATH) as { questions: { qid: string; id: string }[] };
  const q = bank.questions.find((item) => item.id === 'Q2.1');
  expect(q).toBeTruthy();
  await writeKv(page, 'memSession', {
    createdAt: Date.now(), startedAt: Date.now(), index: 0, answered: 0, scores: [],
    items: [{ qid: q!.qid, bankPath: BANK_PATH, id: 'Q2.1' }],
  });

  await page.goto('./#/memory/train');
  await expect(page.locator('.memory-question')).toContainText('负责事件循环的内置依赖库是？');

  // 不选任何项，直接查看参考答案
  await page.getByRole('button', { name: '查看参考答案' }).click();
  await expect(page.locator('.memory-answer')).toContainText('libuv 提供事件循环与线程池');
  await expect(page.getByText('已记录（本地判分）')).toBeVisible();
  // 判定文案采用中性色（不使用红绿琥珀语义色）
  await expect(page.locator('.memory-verdict')).toHaveCSS('color', 'rgb(92, 96, 102)');

  const attempts = await readStore(page, 'mem_attempts') as { mode: string; verdict: string; revealed: boolean }[];
  expect(attempts).toHaveLength(1);
  expect(attempts[attempts.length - 1]).toMatchObject({ mode: 'choice', verdict: 'again', revealed: true });
  const srs = await readStore(page, 'mem_srs') as { qid: string; stage: number }[];
  expect(srs.find((s) => s.qid === q!.qid)).toMatchObject({ stage: 0 });
});

test('选择题本地判分与追问链：链排序、母题展开、单选错选、多选漏选', async ({ page }) => {
  await configureAndSync(page);
  await writeKv(page, 'memSelection', ALL_KINDS_SELECTION);

  await page.goto('./#/memory');
  await page.locator('.memory-bank').filter({ hasText: '示例题库' }).getByRole('checkbox').check();
  await expect(page.locator('.memory-bank').filter({ hasText: '示例题库' })).toContainText('5 题');
  await page.getByRole('button', { name: '开始训练' }).click();

  // 第 1 题：问答题（Q1.1）
  await expect(page.locator('.memory-question')).toContainText('什么是事件循环？');
  await page.getByRole('button', { name: '查看参考答案' }).click();
  await page.getByRole('button', { name: '会', exact: true }).click();
  await page.getByRole('button', { name: '下一题' }).click();

  // 第 2 题：追问链排序——母题 Q1.1 在队列中，追问紧随其后
  await expect(page.locator('.memory-question')).toContainText('poll 阻塞时来了 I/O');
  await expect(page.getByText('追问自 Q1.1')).toBeVisible();
  await page.getByRole('button', { name: '查看母题 Q1.1' }).click();
  await expect(page.getByText('母题上下文，不计入本次记录。')).toBeVisible();
  await expect(page.locator('.memory-parent-body')).toContainText('什么是事件循环？');
  await page.getByRole('button', { name: '查看参考答案' }).click();
  await page.getByRole('button', { name: '会', exact: true }).click();
  await page.getByRole('button', { name: '下一题' }).click();

  // 第 3 题：Q1.2（问答），快速跳过
  await expect(page.locator('.memory-question')).toContainText('什么是微任务？');
  await page.getByRole('button', { name: '查看参考答案' }).click();
  await page.getByRole('button', { name: '会', exact: true }).click();
  await page.getByRole('button', { name: '下一题' }).click();

  // 第 4 题：单选（Q2.1）——提示 L2 排除一个错误项，选剩下的错误项 → 错选、选项着色
  await expect(page.locator('.memory-question')).toContainText('负责事件循环的内置依赖库是？');
  await expect(page.locator('.memory-option')).toHaveCount(3);
  await page.getByRole('button', { name: '提示' }).click();
  await page.getByRole('button', { name: '提示' }).click();
  await expect(page.getByRole('button', { name: '已给足提示' })).toBeVisible();
  await expect(page.getByText('已排除选项')).toBeVisible();
  const eliminatedKey = (await page.locator('.memory-option-eliminated .memory-option-key').innerText()).trim();
  const pickedKey = eliminatedKey === 'B' ? 'C' : 'B';
  const pickedText = pickedKey === 'B' ? 'V8' : 'zlib';
  const eliminatedText = eliminatedKey === 'B' ? 'V8' : 'zlib';
  await page.locator('.memory-option').filter({ hasText: pickedText }).click();
  // 双击提交：防重复写记录（点击期间按钮禁用）
  await page.getByRole('button', { name: '提交' }).click({ clickCount: 2, delay: 0 });
  await expect(page.locator('.memory-score')).toContainText('错选');
  await expect(page.locator('.memory-option-correct')).toContainText('libuv');
  await expect(page.locator('.memory-option-wrong')).toContainText(pickedText);
  await expect(page.locator('.memory-option-eliminated')).toContainText(eliminatedText);
  await page.getByRole('button', { name: '下一题' }).click();

  // 第 5 题：多选（Q2.2）——只选 A → 漏选
  await expect(page.locator('.memory-question')).toContainText('以下哪些是内置依赖库？');
  await page.locator('.memory-option').filter({ hasText: 'V8' }).click();
  await page.getByRole('button', { name: '提交' }).click();
  await expect(page.locator('.memory-score')).toContainText('漏选');

  const attempts = await readStore(page, 'mem_attempts') as { mode: string; verdict: string; picked?: string[]; correct?: string[] }[];
  const choiceAttempts = attempts.filter((a) => a.mode === 'choice');
  expect(choiceAttempts).toHaveLength(2); // 双击提交未产生重复记录
  expect(choiceAttempts[0]).toMatchObject({ verdict: 'again', picked: [pickedKey], correct: ['A'] });
  const last = attempts.find((a) => a.mode === 'choice' && a.picked?.includes('A') && (a.correct?.length ?? 0) === 2);
  expect(last).toMatchObject({ verdict: 'hard', correct: ['A', 'B'] });
});

test('记录页：统计与明细、清除训练数据', async ({ page }) => {
  await configureAndSync(page);
  await writeKv(page, 'memSelection', QA_ONLY_SELECTION);
  await writeKv(page, 'llmConfig', { baseUrl: 'https://llm.example/v1', apiKey: 'k', model: 'm' });
  await page.route('https://llm.example/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ choices: [{ message: { content: JSON.stringify({ score: 82, hit: ['要点'], missed: [], comment: '不错' }) } }] }),
    }),
  );

  await page.goto('./#/memory');
  await page.locator('.memory-bank').filter({ hasText: '示例题库' }).getByRole('checkbox').check();
  await expect(page.locator('.memory-bank').filter({ hasText: '示例题库' })).toContainText('5 题');
  await page.getByRole('button', { name: '开始训练' }).click();
  await page.getByLabel('作答').fill('我的回答');
  await page.getByRole('button', { name: '提交' }).click();
  await expect(page.locator('.memory-score')).toContainText('82');

  await page.goto('./#/memory/records');
  await expect(page.locator('.memory-stat').filter({ hasText: '总题数' }).locator('b')).toHaveText('5');
  await expect(page.locator('.memory-stat').filter({ hasText: '平均分' }).locator('b')).toHaveText('82');
  await expect(page.locator('.memory-record')).toContainText('Q1.1');
  await expect(page.locator('.memory-record')).toContainText('82 分');

  // 展开明细
  await page.locator('.memory-record').first().click();
  await expect(page.getByText('作答：我的回答')).toBeVisible();

  // 清除（确认框接受）
  page.on('dialog', (d) => void d.accept());
  await page.getByRole('button', { name: '清除训练数据' }).click();
  await expect(page.getByText('还没有训练记录。')).toBeVisible();
});

test('记录页：导出 JSON 可下载，导入同一文件幂等且统计不变', async ({ page }) => {
  await configureAndSync(page);
  await writeKv(page, 'memSelection', QA_ONLY_SELECTION);
  await writeKv(page, 'llmConfig', { baseUrl: 'https://llm.example/v1', apiKey: 'k', model: 'm' });
  await page.route('https://llm.example/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ choices: [{ message: { content: JSON.stringify({ score: 82, hit: ['要点'], missed: [], comment: '不错' }) } }] }),
    }),
  );

  // 先完成一次 AI 评分训练，产生可导出的记录
  await page.goto('./#/memory');
  await page.locator('.memory-bank').filter({ hasText: '示例题库' }).getByRole('checkbox').check();
  await expect(page.locator('.memory-bank').filter({ hasText: '示例题库' })).toContainText('5 题');
  await page.getByRole('button', { name: '开始训练' }).click();
  await page.getByLabel('作答').fill('我的回答');
  await page.getByRole('button', { name: '提交' }).click();
  await expect(page.locator('.memory-score')).toContainText('82');

  await page.goto('./#/memory/records');
  // 等异步读库完成再取基准（初次渲染为空统计）
  await expect(page.locator('.memory-stat').filter({ hasText: '已练' }).locator('b')).toHaveText('1');
  const statsBefore = await page.locator('.memory-stats').first().innerText();

  // 导出：文件名带日期，内容为记忆训练数据文件
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 JSON' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^md-reader-memory-\d{8}\.json$/);
  const filePath = await download.path();
  expect(filePath).toBeTruthy();
  const json = await readFile(filePath!, 'utf8');
  expect(json).toMatch(/"kind":\s*"memory"/);

  // 导入同一文件：toast 提示、记录不重复、统计不变（幂等）
  await page.getByLabel('导入训练数据文件').setInputFiles(filePath!);
  await expect(page.locator('.toast').filter({ hasText: '导入进度' })).toBeVisible();
  expect(await page.locator('.memory-stats').first().innerText()).toBe(statsBefore);
  await expect.poll(async () => (await readStore(page, 'mem_attempts') as unknown[]).length).toBe(1);
});
