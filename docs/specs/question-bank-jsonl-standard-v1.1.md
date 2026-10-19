# 题库 JSONL 标准 v1.1

> 适用范围：记忆助手的题库数据格式。一个题库 = 一个 `.jsonl` 文件；仓库中所有 `.jsonl`（`archive/` 目录除外）都会被识别为题库。
> 本文件是 `docs/specs/2026-10-19-memory-assistant-design.md` 附录 A 的独立副本，便于直接放入内容仓库或作为编写规范引用。

## 1. 文件约定

- 文件编码 UTF-8、LF、无 BOM；**一行 = 一道题**，每行必须能独立解析为合法 JSON。
- 禁止多行 JSON / 美化换行；字符串内的换行一律用 `\n` 转义；空行忽略。
- 行的顺序 = 新题出题顺序（建议按章节顺序）。
- `.jsonl` 不进入阅读器的文档管线（不出现在文件树、搜索、最近阅读中），仅供记忆助手消费。

## 2. 字段

| 字段 | 必需 | 类型 | 说明 |
| --- | --- | --- | --- |
| `id` | ✅ | string | 题号，文件内唯一，如 `"Q2.6"`（仅用于显示与引用；学习进度不依赖它） |
| `question` | ✅ | string | 题干（单段；换行用 `\n`） |
| `type` | ✅ | string | 题型：概念 / 辨析 / 场景 / 故障 / 追问 / 手写 / 估算 / 开放 / 行为，允许组合 |
| `kind` | 可选 | string | 形态：`"qa"`（缺省）/ `"single"` / `"multiple"` |
| `answer` | 条件 | string | 参考答案 / 解析，markdown；`qa` 必填，选择题可选 |
| `options` | 条件 | object[] | 仅选择题必填：`[{"key":"A","text":"…"}]`；key 题内唯一、text 非空、≥ 2 项 |
| `correct` | 条件 | string[] | 仅选择题必填：正确项 key 列表；`single` 恰好 1 个，`multiple` ≥ 1 个，必须 ⊆ 选项 key |
| `followUpOf` | 可选 | string | 追问关系：本题为哪道题的追问（值 = 同文件另一题的 `id`） |
| `chapter` | 建议 | string | 章节，如 `"2. 事件循环与异步模型"` |
| `section` | 可选 | string | 小节，如 `"2.2 补充题目"` |
| `prompt` | 可选 | string | 题面附件（示例代码、表格），markdown；不参与评分对照 |
| `hint` | 可选 | string | 提示（建议一行）；缺省时助手按答案自动生成提示 |
| `tags` | 可选 | string[] | 标签，用于筛选 |
| `difficulty` | 可选 | string | 难度（如 基础 / 进阶 / 高难） |
| `source` | 可选 | string | 回链知识文档（相对路径#锚点） |

## 3. 示例（一道题一行；此处为便于阅读未折行）

问答（缺省形态）：

````json
{"id":"Q2.6","type":"概念","chapter":"2. 事件循环与异步模型","section":"2.2 补充题目","question":"poll 阶段什么时候会阻塞？阻塞多久？","hint":"关注活跃句柄与最近的定时器","answer":"- 当本轮没有待执行的 `setImmediate`、没有到期定时器、且仍有活跃句柄时，poll 会阻塞等待 I/O 事件。\n- 阻塞时长 = min(最近的定时器到期时间, 平台最大等待时间)；有 I/O 事件到达会被立即唤醒。\n- 关键点：这就是「服务空闲时 CPU 接近 0」的原因。","tags":["事件循环"]}
````

含代码的题面与答案（`\n` 转义）：

````json
{"id":"Q2.3","type":"手写/追问","chapter":"2. 事件循环与异步模型","question":"写出下面程序的输出顺序。","prompt":"```js\nsetTimeout(() => console.log('t'), 0);\nPromise.resolve().then(() => console.log('p'));\nprocess.nextTick(() => console.log('n'));\n```","hint":"先看同步代码与 nextTick，再看微任务","answer":"- 输出：`n → p → t（示例）`。\n- 解释：nextTick 先于 Promise 微任务；定时器最后。"}
````

单选：

````json
{"id":"Q1.1","kind":"single","type":"概念","chapter":"1. 运行时架构","question":"负责事件循环与线程池的内置依赖库是？","options":[{"key":"A","text":"libuv"},{"key":"B","text":"V8"},{"key":"C","text":"OpenSSL"},{"key":"D","text":"zlib"}],"correct":["A"],"answer":"libuv 提供事件循环与线程池；V8 负责 JS 执行。"}
````

多选：

````json
{"id":"Q1.2","kind":"multiple","type":"辨析","chapter":"1. 运行时架构","question":"以下哪些属于运行时内置依赖库？","options":[{"key":"A","text":"V8"},{"key":"B","text":"libuv"},{"key":"C","text":"React"},{"key":"D","text":"OpenSSL"}],"correct":["A","B","D"],"hint":"与前端框架无关的依赖"}
````

追问（链到另一题）：

````json
{"id":"Q2.7","type":"追问","followUpOf":"Q2.6","chapter":"2. 事件循环与异步模型","question":"那 poll 阻塞时发生 I/O 事件会怎样？会立刻打断当前回调吗？","answer":"- 会唤醒 poll，但要等当前正在执行的回调结束后才处理……"}
````

## 4. 校验与运行时规则

- 逐行解析；坏行只跳过自身，并给出行号与原因：JSON 非法、必填字段缺失或为空、字段类型错误、`id` 重复、题干重复、选择题选项/答案非法、`followUpOf` 悬空（找不到目标）/ 自引用 / 成环。
- 学习进度以**规范化题干的内容哈希**为主键：换版本文件、题号重排、答案润色不会丢进度；题干实质改写视为新题。
- 追问关系只影响**出题顺序与展示**：追问题独立进入调度（有自己的进度与到期）；同一队列内，追问紧随其母题之后；训练界面显示「追问自 Q2.6」并可展开母题内容。`followUpOf` 指向不存在/自引用/成环时告警，仍按普通题出题。
- 选择题由助手本地判分（单选对 = 优秀、错 = 不会；多选全对 = 优秀、漏选 = 勉强、错选 = 不会），不调用模型。
- 未知字段一律忽略（向后兼容：以后新增 `points` 等字段不破坏旧客户端）。
- 建议单行 < 32KB。
