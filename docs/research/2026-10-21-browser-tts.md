# PWA 文档朗读：浏览器原生 TTS 调研

> 日期：2026-10-21
> 范围：md-reader（Android 为主、中文技术笔记、离线优先、内容不出本机）
> 结论先行：浏览器原生只有 Web Speech API 一条路。它够做「能听」的 MVP，但不够做「听书级」体验；后台/锁屏、暂停、逐词高亮都有硬限制。建议先用 `speechSynthesis` + 句级队列落地，把「锁屏继续听」当作需要真机验证的加分项，而不是 v1 的承诺。

---

## 1. 结论

1. **唯一零依赖、零服务端、可离线的方案是 `window.speechSynthesis`（Web Speech API）**。Android Chrome 会把朗读委托给系统 TTS 引擎（通常是 Google 语音服务），中文可用，语音包下载后可离线。
2. **它的能力边界很硬**：
   - Android Chrome 的 `pause()` 实际表现为停止/取消，不是暂停；
   - 没有锁屏/通知栏控件（Media Session 不接管 `speechSynthesis`）；
   - 页面进入后台/息屏后，JS 可能被冻结，队列能否续播取决于浏览器与 ROM，**没有规范保证**；
   - `onboundary`（逐词边界）在 Android 的网络语音上经常不触发，不能作为高亮的基础；
   - Chrome 桌面端的长句约 14–15 秒会被截断（主要影响网络语音），必须分句。
3. **对 md-reader 的合理定位**：v1 做「前台可见时的舒适朗读」——句级队列、当前句高亮、自动滚动、速度/音色、断点续读、跳过代码块、保持屏幕常亮。
   - **追加（2026-10-21）**：原判断「锁屏/后台作为二期验证项；若必须保证，只有 WASM + `<audio>` + Media Session 或原生壳能解决」**已不再适用**——已明确不做锁屏，且允许下载本地模型。新的建议是「系统 TTS 打底 + 可选本地语音包（Matcha zh-en / Piper）」，详见 §8。
4. **隐私红线**：`speechSynthesis` 也可能调用云端语音（`voice.localService === false`）。默认只允许本地语音，网络语音必须显式 opt-in 并提示「文本会发给语音提供方」，否则违背产品原则 1。
5. **不建议 v1 接云 TTS**。音质最好，但与「内容不出本机」冲突；如未来要做，应沿用「用户自备模型地址」的模式，作为可选能力。

---

## 2. 浏览器能力地图

### 2.1 Web Speech API：`speechSynthesis`

**基本用法**

```ts
const u = new SpeechSynthesisUtterance('要朗读的文本');
u.lang = 'zh-CN';
u.rate = 1;      // 0.1–10，实际范围受引擎限制
u.pitch = 1;     // 0–2
u.volume = 1;    // 0–1
speechSynthesis.speak(u);
```

- `speechSynthesis.speak(u)`：入队，按顺序播放；`cancel()` 清空队列；`pause()`/`resume()` 语义在实现间不一致。
- `getVoices()`：返回 `SpeechSynthesisVoice[]`；Chrome/Firefox 首次可能为空，需要等 `voiceschanged`。
- 事件：`start`、`end`、`error`、`boundary`、`pause`、`resume`、`mark`。
- `SpeechSynthesisUtterance` 没有 SSML 支持；浏览器会忽略/剥离 SSML 标签。停顿只能靠标点、分句和句间延时。

**兼容性**

- 桌面与 Android 的主流浏览器均已支持多年（Chrome 33+、Safari 7+、Firefox 49+、Edge 14+）。
- 规范仍是草案（Web Speech API Editor's Draft），实现差异大，不能按「标准行为」假设。
- `boundary` 事件 MDN 标注为 **Limited availability**；Chrome 为部分支持。

**自动播放限制**

- Chrome M71+：`speechSynthesis.speak()` 需要文档至少获得一次用户激活（点击/触摸），否则直接报 `not-allowed`。Android 同样适用。
- iOS Safari 更严格：首次 `speak()` 最好在用户手势的同步调用栈里；否则可能静默失败。
- 结论：**不要页面加载后自动朗读**；播放按钮的 click 处理器里直接启动第一句。

**长文本截断**

- Chromium issue 40747712：Chrome 桌面使用 Google 网络语音时，单条 utterance 超过约 14–15 秒会中途停止。
- Readium 的实测：Chrome 桌面的 Google 语音全部需要联网，且超过 14 秒会被截断、不返回 boundary。
- Android 使用系统 TTS，通常没有这个 15 秒限制，但仍建议按「一句/一小段」入队：便于高亮、暂停恢复、错误隔离。

**暂停在 Android 上不可用**

- 多个实现报告与 MDN BCD issue #4500 指出：Chrome for Android 的 `pause()` 会把当前 utterance 结束掉，`resume()` 无法从原位置继续。
- 跨平台稳妥做法：**pause = cancel + 记住当前句索引；resume = 从该句重新 speak**。代价是句内位置丢失，所以 chunk 要短（一句或半句）。

**语音列表的坑**

- `getVoices()` 是异步填充的；首次调用可能是空数组。监听 `voiceschanged`，并做 2–3 秒轮询兜底。
- `localService` 是判断「是否离线可用」最可靠的字段（Readium 实测）。
- Android Chrome 返回的是「语言/地区列表」，不等于已安装的语音包；选择未安装的语言时，Chrome 可能静默回退到英语。必须引导用户安装中文语音数据。
- Android 的 `lang` 可能用下划线（`zh_cn`），需要 `replace('_', '-')` 归一化。
- `voiceURI` 不保证唯一；`default` 在 Chrome Android 上全是 false，Safari 上全是 true，不能依赖。
- 没有音质、性别、年龄等元数据；只能按名称/语言猜，或让用户试听。

**边界事件（逐词高亮）**

- 桌面 Chrome + 本地语音可以正常触发，`charIndex`/`charLength` 可用（本次在 macOS Chrome 上实测：180 个语音、18 个中文语音，boundary 正常）。
- Android + 网络语音经常不触发；Readium 也记录 Google 桌面语音不返回 boundary。
- 结论：**不要以 boundary 为架构前提**。以「句」为高亮单位；boundary 只作为增强，检测到就用，检测不到就退回句级。

**没有的能力**

- 不能把 TTS 输出接到 Web Audio 图里（不能录音、不能做均衡/压缩、不能可视化）。
- 不能指定输出设备，不能控制音频焦点。
- 没有 Media Session 集成：锁屏、通知栏、蓝牙耳机按键都拿不到。
- 不能后台常驻：Service Worker 里没有 DOM/音频，不能代替页面朗读。
- 不能保证息屏继续播放；页面被杀/被冻结就结束。

### 2.2 可以配合的浏览器 API

| API | 用途 | 备注 |
|---|---|---|
| `Intl.Segmenter` | 中文/英文分句、分词 | Chrome 87+、Safari 14.1+；`granularity: 'sentence'` 很适合中文 |
| CSS Custom Highlight API | 高亮当前句，不改 DOM | Baseline 2025；Chrome 105+、Safari 17.2+；只支持颜色/背景/下划线等文本样式 |
| Screen Wake Lock | 朗读时保持屏幕常亮 | Baseline 2025；`navigator.wakeLock.request('screen')`，页面隐藏会自动释放，需在 `visibilitychange` 里重取 |
| Page Visibility | 前后台切换时校准 UI/队列 | 不能阻止后台冻结，只能感知 |
| Media Session | 锁屏/通知栏控制 | **只对真正在播放的媒体生效**；`speechSynthesis` 不触发。需要用 `<audio>` 播放真实音频 |
| Web Audio | 句间提示音、睡眠定时淡出 | 不能处理 TTS 输出 |
| `navigator.languages` | 选默认语音 | 与 `voice.lang` 做匹配 |

### 2.3 Chrome 自带的「收听此页」

- Chrome Android 的「⋮ → 收听此页」支持中文，官方说明明确「锁屏后仍可继续听」，并有 Standard / AI playback 两种模式。
- 优点：零代码、后台/锁屏体验由 Chrome 保证、音质通常好于网页 TTS。
- 局限：
  - 不是应用内能力，PWA 里未必有这个菜单项，无法控制进度、音色、断点；
  - AI playback 需要联网，会把页面内容发给 Google，与「内容不出本机」冲突；
  - 无法和 md-reader 的高亮、笔记、进度联动。
- 定位：**竞品基线/兜底说明**，不是实现方案。可以写在帮助里：「只想听、不在乎联动时，可用 Chrome 的收听此页」。

---

## 3. Android 现实（主场景）

### 3.1 语音从哪来

- Chrome Android 不自己合成语音，而是调用系统 `TextToSpeech` 引擎（通常是「Google 语音服务」，部分 ROM 是厂商引擎）。
- 语音质量取决于引擎和是否安装了中文语音包；Google 的中文语音质量中等偏上，但不是 ElevenLabs/Kokoro 级别。
- 国产 ROM 可能没有 Google 语音服务，或默认引擎被换成厂商 TTS；此时 `getVoices()` 可能为空，功能直接不可用。
- 离线：只有 `localService === true` 且语音包已下载才离线可用；网络语音在飞行模式下会失败。

### 3.2 已知行为

| 行为 | Android Chrome | 影响 |
|---|---|---|
| `pause()` / `resume()` | 表现为停止，不能从原位置恢复 | 必须自己实现「停止 + 从当前句重播」 |
| `onboundary` | 网络语音经常不触发 | 高亮以句为单位 |
| 长句截断 | 系统 TTS 通常没有 15 秒限制 | 仍建议分句，便于恢复与高亮 |
| 首次发声延迟 | 可能几百毫秒到数秒；Readium 记录过极端 1 分钟 | 需要「准备中」状态与超时提示 |
| 息屏/后台 | 无规范保证；已入队的句子可能继续，JS 可能被冻结 | 用「预入队」窗口提高续播概率，但必须真机验证 |
| 锁屏控件 | 无 | 不能承诺蓝牙/锁屏暂停 |
| 音频焦点 | 电话/其他媒体可能打断，无事件 | 回到前台时检查 `speaking`，提示继续 |
| 语音包缺失 | 可能静默回退英语 | 提供试听与系统设置引导 |

### 3.3 隐私

- `voice.localService === false` 意味着文本会离开设备（发给 Google/Microsoft 等）。
- 即使 `localService === true`，引擎本身可能有遥测；这一点应用无法控制，但至少文本合成在本机。
- 建议：
  - 默认只列出 `localService === true` 的语音；
  - 网络语音放在「更多语音」里，首次选择时明确提示「该语音需要联网，文本会发送给语音提供方」；
  - 记住用户选择，但在离线时自动回退到本地语音并提示。

---

## 4. 对 md-reader 的落地方案

### 4.1 总体结构

```
Markdown 源 → 渲染 DOM → 句子切分/清洗 → 句级队列 → speechSynthesis
                                      ↓
                               当前句 Range → 高亮 + 自动滚动
                                      ↓
                               进度（句索引/字符偏移）→ IndexedDB
```

建议新增 `src/tts/`：

- `voices.ts`：加载、归一化、筛选、持久化、试听。
- `segment.ts`：DOM/文本 → 句子列表；清洗代码、链接、表格、mermaid。
- `queue.ts`：播放状态机、预入队、错误处理、取消代际。
- `useTts.ts`：React 绑定（当前句、状态、控制方法）。
- `TtsBar.tsx` / `TtsSheet.tsx`：播放器 UI。

### 4.2 内容流水线

**从渲染后的 DOM 取文本，而不是重新解析 Markdown**：这样链接、行内代码、`==高亮==`、笔记标记都与用户看到的一致。

跳过/特殊处理：

| 内容 | 默认 | 说明 |
|---|---|---|
| `pre > code`、`.mermaid`、`svg` | 跳过，播报「代码块，略」或「图表，略」 | 技术笔记里代码比例高，逐字读体验差；可给开关 |
| 表格 | 跳过，或只读表头 + 每行首列 | 逐格朗读很吵；给开关 |
| 图片 | 读 alt；无 alt 跳过 | 不读 URL |
| 链接 | 只读链接文字 | 不读 href |
| 行内代码 | 原样读，或降速读 | 标识符可能被逐字母拼读，给开关 |
| 脚注引用、锚点符号 | 跳过 | 避免「上标 1」之类噪音 |
| URL、文件路径、十六进制 | 替换为「链接」/跳过 | 避免逐字符朗读 |
| 标题 | 正常读，前后加短停顿 | 可用句间 `setTimeout` 或标点实现 |
| 列表 | 读内容，不读 markdown 符号 | 有序列表可读「第一点」；默认不读 |

**分句**

```ts
const seg = new Intl.Segmenter('zh', { granularity: 'sentence' });

function toChunks(text: string): string[] {
  const raw = [...seg.segment(text)].map(s => s.segment.trim()).filter(Boolean);
  const merged: string[] = [];
  for (const s of raw) {
    // 太短的句子（如「好。」）与下一句合并，避免频繁起停
    if (merged.length && (merged.at(-1)!.length + s.length) <= 36) {
      merged[merged.length - 1] += s;
    } else {
      merged.push(s);
    }
  }
  return merged.flatMap(s => s.length > 80 ? splitAtPunctuation(s, 60) : [s]);
}
```

经验值（可按真机校准）：

- 中文 1x 约 4–5 字/秒；英文约 14–15 字符/秒。
- 单句目标 8–15 秒；中文约 40–70 字，英文约 120–200 字符。
- 超过 15 秒的句子在逗号/分号处再切；低于 3 秒的句子与相邻句合并。
- 句间会有 100–300ms 的天然间隙，正好当停顿；不要额外加太长延时，否则像机器人。

**中英混排**

- 技术笔记里英文术语多。两种策略：
  1. 统一用中文语音读（简单，英文会带口音，但通常可懂）；
  2. 按句检测语言，英文占比高的句子切到 `en-US` 语音（更准，但换声、换语速，且增加延迟）。
- v1 建议方案 1，设置里留「中英混读时切换语音」开关（默认关）。

### 4.3 播放状态机

```ts
type TtsState = 'idle' | 'preparing' | 'playing' | 'paused' | 'ended' | 'blocked' | 'unsupported';
```

核心规则：

- **代际 token**：每次 stop/seek/换文档 `gen++`；所有事件回调先比对 `gen`，丢弃过期事件。
- **不要依赖 `speechSynthesis.speaking` 判断启动成功**：`speak()` 后它可能短暂为 false；用 `onstart` + 1–2 秒超时判断「没起来」。
- **cancel 后不要立刻 speak**：Chrome/Safari 都有「cancel 后紧跟 speak 被吞」的报告；等 50–100ms 或 `requestAnimationFrame` 再入队。
- **保留 utterance 引用**：Chrome 有 utterance 被 GC 后事件不触发的历史问题；用 `Map<number, SpeechSynthesisUtterance>` 持有当前窗口。
- **错误处理**：
  - `canceled` / `interrupted`：自己的 cancel 引起，忽略；
  - `not-allowed`：需要用户手势，切到 `blocked`，显示「点按继续」；
  - `voice-unavailable` / `language-unavailable`：回退到默认中文语音；
  - `network`：离线或网络语音失败，回退本地语音；
  - `synthesis-failed` / `audio-busy`：跳过当前句，连续失败则停止并提示。
- **暂停**：`cancel()` + 记录 `currentIndex`；恢复从该句重播。
- **上一句/下一句**：`cancel()` + 从目标句重播。
- **改语速/音色**：从当前句重播（句内位置丢失，可接受）。
- **睡眠定时**：到点在下一句结束后停止；不要在句中被 cancel 打断。

**预入队（后台续播的关键）**

```ts
const LOOKAHEAD = 20; // 约 3–5 分钟
let queuedUpTo = 0;

function fill(from: number) {
  const end = Math.min(from + LOOKAHEAD, chunks.length);
  for (let i = Math.max(queuedUpTo, from); i < end; i++) {
    synth.speak(makeUtterance(i));
  }
  queuedUpTo = Math.max(queuedUpTo, end);
}
```

- 一次入队 20 句，让浏览器/系统 TTS 的队列自己往下播；即使页面 JS 被冻结，已入队的句子仍可能继续。
- `onstart` 更新当前句、高亮、进度；`onend` 补充队列尾部。
- 用户暂停时 `cancel()` 会清空整个队列，所以恢复必须从 `currentIndex` 重建。
- 预入队太大会导致「暂停后队列里还有几十句」的错觉；`cancel()` 能清掉，但要确认 Android 上确实立即静音（真机验证）。

### 4.4 高亮与滚动

**方案 A（推荐）：CSS Custom Highlight API**

- 播放前用 TreeWalker 把正文文本节点建成「字符偏移 → DOM Range」映射；每句一个 Range。
- 当前句：

```ts
CSS.highlights.set('tts-current', new Highlight(range));
```

```css
::highlight(tts-current) {
  background: color-mix(in srgb, var(--accent) 16%, transparent);
  text-decoration: underline;
  text-decoration-thickness: 1px;
}
```

- 优点：不改 DOM，不会和现有的 `<mark>` 高亮/笔记冲突；重建成本低。
- 注意：`::highlight` 只支持文本样式，不能加 border/box-shadow；如果和黄色高亮叠加，用下划线或降低透明度区分。
- 自动滚动：`range.getBoundingClientRect()`；当前句在视口上半区之外时 `scrollBy` 到视口 35% 位置，`behavior: 'smooth'`，尊重 `prefers-reduced-motion`。

**方案 B：渲染时包 `<span data-tts="i">`**

- 高亮最稳，点击定位也简单；但会改 DOM 结构，可能影响 `applyHighlights`/`applyNotes` 的 Range 包装和选区锚点，需要回归测试。
- 适合作为方案 A 的降级（不支持 Custom Highlight 时）。

**用户手动滚动**

- 检测 `wheel`/`touchmove`/`scroll`（区分程序滚动），用户主动滚动后暂停自动跟随 5–10 秒。
- 播放器上给「回到当前句」按钮；下次换句时恢复跟随。

### 4.5 进度与设置

- 单独的 TTS 进度键：`tts.pos.<path> = { index, char, updatedAt }`，不要复用滚动比例（两者会互相打架）。
- 打开文档时，如果存在 TTS 进度，显示「继续朗读」chip；不自动播放（自动播放也会被浏览器拦）。
- 设置项（`kv`）：
  - `tts.voice`：`lang|name`，启动时重新解析；找不到则回退默认中文本地语音；
  - `tts.rate`：0.8–2.0，默认 1.0；
  - `tts.skipCode`：默认 true；
  - `tts.readTable`：默认 false；
  - `tts.keepAwake`：默认 true（仅播放时持有 wake lock）；
  - `tts.localOnly`：默认 true。
- 若未来做同步，TTS 进度可以作为独立 collection；v1 先本机，避免扩大同步面。

### 4.6 UI

- **入口**：
  - `DocHeader` 加一个扬声器图标（和现有操作并列，注意移动端宽度）；
  - `SelectionMenu` 加「从这里朗读」（用户已经有选中即菜单的交互，天然入口）；
  - 可选：首页「继续阅读」卡片上显示「继续朗读」。
- **播放器**：底部浮动条（在 safe-area 之上），不遮挡正文；展开为 sheet：
  - 播放/暂停、上一句/下一句；
  - 语速（0.8/1.0/1.25/1.5/2.0）；
  - 音色（按语言分组，本地/网络标签）；
  - 睡眠定时（15/30/45/60 分钟）；
  - 「保持屏幕常亮」开关；
  - 关闭。
- **状态文案**：
  - 无语音：「系统没有可用的中文语音。请到 设置 → 文字转语音 安装中文语音数据。」（Android 上可尝试 deep link 到 TTS 设置，但不保证）；
  - 网络语音离线：「当前语音需要联网，已切换到本地语音」；
  - 被浏览器拦截：「点按继续朗读」；
  - 首次准备：「正在准备语音…」。
- **无障碍**：播放器按钮有 `aria-label`；状态变化用 `aria-live="polite"` 播报「开始朗读/已暂停」；不要每句都播报，否则读屏会吵。

### 4.7 代码骨架

```ts
// src/tts/queue.ts（示意）
export class TtsQueue {
  private gen = 0;
  private current = 0;
  private queuedUpTo = 0;
  private utterances = new Map<number, SpeechSynthesisUtterance>();

  constructor(
    private chunks: Chunk[],
    private voice: SpeechSynthesisVoice | null,
    private rate: number,
  ) {}

  play(from = this.current) {
    const gen = ++this.gen;
    speechSynthesis.cancel();
    setTimeout(() => {
      if (gen !== this.gen) return;
      this.current = from;
      this.queuedUpTo = from;
      this.fill(from, gen);
    }, 60);
  }

  pause() {
    this.gen++;
    speechSynthesis.cancel();
  }

  private fill(from: number, gen: number) {
    const end = Math.min(from + 20, this.chunks.length);
    for (let i = Math.max(this.queuedUpTo, from); i < end; i++) {
      const u = new SpeechSynthesisUtterance(this.chunks[i].text);
      u.lang = this.chunks[i].lang;
      if (this.voice) u.voice = this.voice;
      u.rate = this.rate;
      u.onstart = () => { if (gen === this.gen) this.onStart(i); };
      u.onend = () => { if (gen === this.gen) this.onEnd(i, gen); };
      u.onerror = e => { if (gen === this.gen) this.onError(i, e); };
      this.utterances.set(i, u);
      speechSynthesis.speak(u);
    }
    this.queuedUpTo = Math.max(this.queuedUpTo, end);
  }

  private onStart(i: number) {
    this.current = i;
    this.onCurrent?.(i);
    // 补充尾部，保持窗口
    if (this.queuedUpTo < i + 20) this.fill(this.queuedUpTo, this.gen);
  }

  private onEnd(i: number, gen: number) {
    this.utterances.delete(i);
    if (i === this.chunks.length - 1) this.onEnded?.();
  }

  private onError(i: number, e: SpeechSynthesisErrorEvent) {
    if (e.error === 'canceled' || e.error === 'interrupted') return;
    if (e.error === 'not-allowed') { this.onBlocked?.(); return; }
    // 其余错误：跳过，连续失败则停止
    this.onChunkError?.(i, e);
  }

  onCurrent?: (i: number) => void;
  onEnded?: () => void;
  onBlocked?: () => void;
  onChunkError?: (i: number, e: SpeechSynthesisErrorEvent) => void;
}
```

> 注意：上面的 `fill` 在 `onStart` 里补队尾，但后台 JS 冻结时不会执行；这正是「预入队 20 句」的意义——冻结前已经排好 3–5 分钟。

---

## 5. 备选方案对比

> 追加说明：在不要求锁屏、允许下载本地模型的前提下，本节的结论已被 §8 修订。WASM 从「后台唯一解」变成「可选的本地高质量引擎」。

| 方案 | 离线 | 隐私 | 中文音质 | 锁屏/后台 | 开发成本 | 包体/内存 |
|---|---|---|---|---|---|---|
| **Web Speech API** | ✅ 本地语音 | ✅ 文本不出机（本地语音） | 中（系统引擎） | ⚠️ 不可控 | 低 | 0 |
| Chrome「收听此页」 | ⚠️ | ⚠️ AI 模式会上传 | 好 | ✅ | 0（非应用内） | 0 |
| **Piper WASM** | ✅ | ✅ | 中 | ✅（`<audio>` + Media Session） | 中高 | 约 60–90MB |
| **Kokoro WASM** | ✅ | ✅ | 好 | ✅ | 高 | fp32 300MB+；量化后约 160MB 量级 |
| **sherpa-onnx WASM** | ✅ | ✅ | 好 | ✅ | 高 | 模型 30–120MB |
| 云 TTS | ❌ | ❌ | 最好 | ✅ | 中 | 0 |
| 原生壳（Capacitor/Tauri） | ✅ | ✅ | 好 | ✅ | 最高 | 原生包 |

### 5.1 WASM TTS 的现实

- **Piper**：`zh_CN-huayan-medium`（中文女声，medium 档），ONNX Runtime Web/WASM，模型约 60–90MB；可缓存到 OPFS，离线可用；CPU 上接近实时；社区有 `piper-tts-web` 这类封装。音质比系统 TTS 略机械，但可接受。
- **Kokoro**：82M 参数，中文 v1.1-zh 有 ONNX 版本（fp32 约 339MB；量化后约 160MB 量级，以实际导出为准）。WebGPU 下很快，WASM 下中端手机可能吃力；适合作为「高音质可选包」。
- **sherpa-onnx**：支持 VITS/Matcha/Kokoro 的中文模型，WASM 构建成熟，模型 30–120MB；集成工作量比 Piper 大，但选择多。
- **共同代价**：
  - 首次下载 60–311MB，必须让用户显式确认；
  - 首次加载/编译数十秒（低端机更久）；
  - 持续合成耗电、发热；
  - 模型要进 PWA 缓存策略（OPFS/Cache Storage），升级/清理要设计；
  - 生成的是 PCM/WAV，要自己接 `<audio>` 或 Web Audio，才能拿到 Media Session 和真正的后台播放；
  - iOS 对 WASM 内存限制更严，长文要分块合成。

**结论**：WASM 是「锁屏听书」的唯一纯 Web 解，但不是 v1 的合理起点。先用系统 TTS 验证需求；如果真机测试发现息屏必停、且这是刚需，再做 Piper spike。

### 5.2 云 TTS

- 音质、韵律、中文自然度最好；支持 SSML、词级时间戳。
- 与产品原则冲突：正文会离开设备。即使「用户自备 key」，也仍然是第三方处理。
- 如果未来做，建议：
  - 独立开关，默认关；
  - 明确告知上传范围（仅当前段/整篇）；
  - 用户自备 endpoint/key，沿用现有 LLM 配置模式；
  - 音频缓存进 IndexedDB，避免重复计费；
  - 不作为离线路径。

---

## 6. 风险与真机验证清单

在写 spec 前，先用一个隐藏的 `/tts-probe` 页面（不进导航）在目标手机上测：

### 6.1 语音与基础

- [ ] `getVoices()` 数量；中文语音列表；哪些 `localService === true`。
- [ ] 选择中文语音，朗读 3 句，确认不是英文口音（验证语音包是否真的装了）。
- [ ] 飞行模式下朗读，确认本地语音可用。
- [ ] 删除中文语音包后，观察是否静默回退英语（记录表现，用于文案）。
- [ ] 首次发声延迟；连续 20 句的句间间隔。

### 6.2 控制

- [ ] `pause()` 后 `resume()` 的实际行为（预期：不能原位恢复）。
- [ ] 快速连点播放/暂停/下一句，是否出现双声、吞句、卡死。
- [ ] 改语速/音色后从当前句重播是否正常。
- [ ] `cancel()` 后 60ms 再 `speak()` 是否稳定；必要时调到 100–150ms。

### 6.3 后台/锁屏（关键）

- [ ] 播放中按电源键息屏 2 分钟：声音是否继续？下一句是否继续？
- [ ] 息屏 10 分钟：是否继续？`onend` 是否还在触发？
- [ ] 切换到其他 App 5 分钟：是否继续？
- [ ] 从最近任务划掉 Chrome/PWA：是否停止（预期停止）。
- [ ] 安装版 PWA 与浏览器标签分别测（WebAPK 可能不同）。
- [ ] 蓝牙耳机播放/暂停键：预期无效（无 Media Session）。
- [ ] 来电/微信语音打断后：是否自动恢复？回前台是否提示继续？

### 6.4 内容与 UI

- [ ] 含代码块、mermaid、表格、长链接的笔记：是否跳过正确、无乱读。
- [ ] 5 万字长文：切句耗时、内存、滚动是否卡。
- [ ] 播放中切换文档/标签/仓库：是否立即停止，无残留声音。
- [ ] 播放中新增高亮/笔记：高亮 Range 是否错位（若用方案 A）。
- [ ] 横屏/字号切换：当前句是否仍能滚到可见区域。

### 6.5 测试策略

- 单测：分句器、清洗规则、队列状态机、错误分支（用 fake `speechSynthesis`）。
- Playwright：不要试图验证真实音频；注入 fake，断言 UI 状态、进度写入、取消代际。
- 真机：上述清单，作为验收门（符合项目「真机验收为门」的原则）。
- 开发环境提示：macOS Chrome 无头模式也有语音（本次实测 180 个、18 个中文），`volume=0` 时仍会触发 `start`/`boundary`/`end`，可用于本地手动探测；CI Linux 通常没有语音，必须 fake。

---

## 7. 分阶段建议

> 追加说明：不做锁屏、允许本地模型后，路线以 §8.9 为准；下面的 Phase 0/2 主要保留作为「后台能力验证」的历史记录。

### Phase 0：真机探针（0.5–1 天）

- 隐藏路由 `/tts-probe`：语音列表、localService、朗读测试、暂停测试、60 秒息屏测试、事件日志。
- 产出：目标手机上的「能不能后台播」结论；决定后续架构。

### Phase 1：前台 MVP（2–4 天）

- 句级队列 + 预入队 20 句；
- 当前句高亮（Custom Highlight）+ 自动滚动；
- 播放器：播放/暂停/上一句/下一句/语速/音色；
- 断点续读（句索引）；
- 跳过代码/表格/mermaid；
- Wake Lock；
- 错误与空语音引导；
- 单测 + 真机验收。

### Phase 2：后台与体验加固（2–3 天）

- 根据 Phase 0 结果决定：
  - 若预入队能撑住息屏：加「锁屏继续听」说明与恢复逻辑；
  - 若不行：明确标注「息屏会停」，或评估 Piper + `<audio>` + Media Session spike（3–5 天）。
- 睡眠定时、选中即读、设置项、跨文档记忆；
- 长文性能与滚动跟随优化。

### Phase 3：可选增强

- 逐词高亮（boundary 可用时）；
- 中英混读切换语音；
- WASM 高音质语音包（用户显式下载）；
- 与阅读进度/同步的整合。

---

## 8. 追加调研（2026-10-21）：不做锁屏、允许本地模型后的重排

> 前提变更：**不要求锁屏/后台播放**；**允许把 TTS 模型下载到本机**。
> 这一节覆盖前文的阶段性结论；前文 §5 的「WASM 只适合做后台」判断在这里被修订。

### 8.1 需求变化改变了什么

- 锁屏不再是选型驱动，Web Speech API 最大的短板（后台/锁屏不可控）退出主舞台。
- 本地模型的价值变成：
  1. **音质与一致性**：不依赖手机 ROM 是否有 Google TTS、是否装了中文语音包；
  2. **精确控制**：音频缓冲区可以句内暂停/恢复、精确显示剩余时间；
  3. **完全离线**：模型下载一次后，不依赖系统语音包；
  4. **可复现**：换手机、换 ROM，声音不变。
- 本地模型的代价没变：下载体积、冷启动、CPU/耗电、模型托管与维护。
- 因为不做后台，**本地模型不需要 `<audio>` + Media Session**；用 Web Audio 直接播 `AudioBuffer` 即可。这去掉了一大块复杂度。

### 8.2 候选模型对比

RTF = 合成耗时 / 音频时长，**小于 1 才能快于实时**。下表 RTF 来自 sherpa-onnx 官方在 Raspberry Pi 4（低端 ARM）上的 1/4 线程数据；现代手机通常快 2–4 倍，因此只适合做相对比较，不能直接当手机结论。

| 方案 | 体积 | 采样率 | 语言 | RTF（Pi 4，1/4 线程） | 中文听感（主观预估） | 中英混读 | 备注 |
|---|---|---|---|---|---|---|---|
| **系统 TTS** | 0 | 设备 | 中/英 | — | 3/5，因机而异 | 3/5 | 零下载、最省电；语音包/引擎因 ROM 而异 |
| **Piper `zh_CN-huayan-medium`** | 63MB | 22.05k | 中 | 未列；15M 参数，预计 <0.5 | 3.5/5，清晰偏平 | 2/5，英文口音重 | 最小最快；数据集许可证 Unknown |
| **Matcha `zh-en`** | 72MB + 51MB vocoder + 词典/espeak ≈ **135MB** | 16k | 中+英 | 同架构 zh-baker：0.89 / 0.39；zh-en 待测 | 3.5–4/5，待试听 | **4.5/5** | 官方有 WASM demo；16k 是音质短板 |
| **VITS `zh-hf-fanchen-C`** | 116MB | 16k | 中 | 4.31 / 1.60 | 4/5 | 2.5/5 | 中文好，但慢；英文弱 |
| **MeloTTS `zh_en`** | 约 170–180MB（模型 163MB + 词表） | 44.1k | 中+英 | 6.73 / 2.52 | 4.5/5 | **5/5** | 音质好，但 RTF 不适合手机默认 |
| **Kokoro multi-lang v1.1** | 311MB（fp32） | 24k | 中+英 | 7.64 / 3.19 | 4.5/5 | 4.5/5 | 音质最好；CPU 太慢，WebGPU 可试 |

补充说明：

- 表中「体积」只算模型文件；还要加 **ONNX Runtime / sherpa-onnx WASM + espeak 数据**，大约 10–20MB（可懒加载并在首次使用后缓存）。
- **Matcha zh-en** 是 2025-10 的新模型，支持中英 code-mixed，正好匹配技术笔记里「中文句子夹 `useEffect`、`side effect`」的写法；16kHz 输出是电话音质，清晰但不够 Hi-Fi。
- **Piper** 只有中文；遇到英文术语会用中文口音读，或者需要按句切到英文语音（换声、增加延迟）。
- **MeloTTS** 的中英混读最自然，但模型 + 词表约 170–180MB，且 RTF 高；适合桌面，不适合作为手机默认。
- **Kokoro** 音质好，但 311MB + CPU RTF 3+；只有在旗舰机 + WebGPU 下才值得试验，不能作为通用默认。
- 以上「听感」是资料与社区反馈的主观预估，**必须用你自己的笔记做试听**。

### 8.3 三种产品方案

| | A. 系统 TTS only | B. 本地模型 only | C. Hybrid（推荐） |
|---|---|---|---|
| 首启 | 即时 | 下载 60–311MB | 即时；下载可选 |
| 音质 | 因机而异 | 一致 | 系统默认，本地可选 |
| 暂停/进度 | 句级，暂停=重启 | 句内精确 | 各自引擎能力 |
| 省电 | 最好 | 较差（持续推理） | 默认最好 |
| 维护 | 最低 | 高（模型/托管/版本） | 中高 |
| 适合 | 系统中文语音可用、偶尔听 | 系统语音差/缺失、每天长听 | 大多数情况 |

**A 的问题**：如果手机没有 Google 语音服务、没装中文包，或者系统音色你不满意，功能直接废掉；且暂停只能重启句子。
**B 的问题**：第一次使用要等 135MB 下载；低端机可能内存吃紧；长时间推理耗电/发热；模型/托管/升级都要自己维护。
**C 的做法**：系统 TTS 作为零成本默认；设置里提供「离线语音包」下载，下载后默认用本地引擎，初始化/合成失败自动回退系统。

### 8.4 推荐：Hybrid，Matcha 作为第一个离线包

**我的建议**：

1. **v1 先做系统 TTS**，把句级队列、高亮、暂停/继续、断点续读、Wake Lock 做好。这部分与引擎无关，后面可以直接复用。
2. **v1.1 加本地引擎**，第一个包选 **Matcha zh-en（约 135MB）**：
   - 候选里唯一同时满足「中英混读 + RTF 可接受 + 体积中等 + 官方 WASM」的模型；
   - 16kHz 是妥协，但技术笔记的英文术语能读对，比 Piper 的中式英语更重要；
   - 官方有 WASM demo 和 sherpa-onnx API，集成风险可控；
   - RTF 目前是按同架构 zh-baker 推算的，必须用真机复测后再决定是否默认。
3. **备选包 Piper 63MB**：给「纯中文为主、想省流量/存储」的场景；英文多的笔记不推荐。
4. **Kokoro / MeloTTS 不作为默认**：体积和 RTF 都不适合手机连续朗读；如果要追求音质，作为「实验性高音质包」放在设置里，明确标注需要旗舰机/WebGPU，并且要先过真机测试。

**决策规则**（用你自己的手机和笔记试听 12 句）：

- 系统中文语音「能听、不别扭」→ 系统 TTS 默认，本地包可以延后甚至不做；
- 系统语音缺失、明显机械、英文术语读得很差 → 直接把 Matcha 设为默认，系统作为回退；
- 你更在意音质且手机是旗舰 → 再测 Kokoro/WebGPU，但不要把它当唯一路径。

### 8.5 双引擎架构

UI/队列/高亮/进度只写一份，引擎实现两份：

```ts
interface SpeechSource {
  kind: 'system' | 'local';
  init(): Promise<void>;
  /** 合成并播放一句；resolve 表示这句播完（或被 stop） */
  speak(text: string, opts: { rate: number }): Promise<void>;
  /** 预取下一句（本地引擎用；系统引擎可以是 no-op） */
  prefetch(text: string, opts: { rate: number }): void;
  pause(): void;
  resume(): void;
  stop(): void;
  readonly supportsMidSentencePause: boolean;
}
```

- **SystemSource**：
  - `speak` 内部 `speechSynthesis.speak()` + `onend` resolve；
  - `pause` = `cancel()` + 记住当前句，`resume` 从该句重播；
  - `prefetch` = no-op（浏览器自己排队）；
  - 进度只能到句。
- **LocalSource**：
  - Worker 里跑 sherpa-onnx WASM；`speak` 先合成 `Float32Array`，转 `AudioBuffer` 播放；
  - `prefetch` 在播放当前句时合成下一句，保证无缝；
  - `pause` 用 `AudioContext.suspend()` + 记录 buffer offset，`resume` 从 offset 继续，**句内精确**；
  - 语速通过模型的 `length_scale`（或重新合成）实现，避免 `playbackRate` 变调；
  - 进度用 buffer 时长 + offset，可显示「剩余 12 分钟」。
- **Player**：持有句子列表、当前索引、状态机；根据 `source.kind` 决定暂停语义；高亮/滚动/进度写入完全共用。
- **回退**：本地 `init` 失败、合成抛错、内存不足 → 自动切 `SystemSource`，提示一次「已切回系统语音」。

### 8.6 运行时约束：GitHub Pages 上没有 COOP/COEP

- ONNX Runtime Web / sherpa-onnx 的多线程 WASM 需要 `SharedArrayBuffer`，而 SAB 需要 `crossOriginIsolated`（由 COOP/COEP 响应头开启）。
- GitHub Pages 不能自定义响应头，所以默认只能跑**单线程 WASM**。单线程 RTF 大约是表里 4 线程数据的 2–3 倍：
  - Matcha 在 Pi 4 单线程约 0.9，手机上可能 0.3–0.6，仍有机会实时；
  - MeloTTS / Kokoro 更慢，基本可以排除；
  - Piper 15M 参数，单线程大概率仍快于实时，但必须实测。
- 三条路：
  1. **接受单线程，先测 Matcha/Piper**（推荐）；
  2. 用 `coi-serviceworker` 在客户端注入 COOP/COEP：能让 SAB 生效，但 `COEP: require-corp` 可能阻断跨域图片/字体；本应用会加载 GitHub 图片，风险要实测；
  3. 改用支持 WebGPU 的模型/运行时（如 Kokoro via transformers.js），WebGPU 不需要 SAB；但 sherpa-onnx 的 WebGPU 支持有限，且低端机不一定有可用的 WebGPU。
- 因此 §8.2 的 RTF 是 4 线程数据，**实际部署要按单线程重新评估**；bake-off 必须记录 `crossOriginIsolated` 和 `numThreads`。
- **CSP 约束**：当前 `index.html` 是 `script-src 'self'`，会阻止 `WebAssembly.instantiate`。上 WASM 引擎必须加 `'wasm-unsafe-eval'`（只放行 WASM 编译，不放行 JS eval）；如果库用 Blob Worker，还要 `worker-src 'self' blob:`。这会改动现有 CSP 与 `tests/e2e/pwa.spec.ts` 的断言，属于安全面变更，需要单独评审。
- 如果以后愿意换托管（Cloudflare Pages / Netlify），可以设置 COOP/COEP，多线程 WASM 才可用；但那是部署层变更，不在本次范围。

### 8.7 模型分发与缓存

- **不要**把模型放进 Service Worker 预缓存（安装体积爆炸）。按需下载，存 OPFS：
  - `navigator.storage.getDirectory()` → `/tts/matcha-zh-en/v1/...`；
  - 下载前 `navigator.storage.estimate()` 检查空间，`navigator.storage.persist()` 防驱逐；
  - 每个文件校验 SHA-256，失败可重试/删除。
- **manifest**：`{ id, version, files: [{ path, size, sha256 }], sampleRate, languages, license }`；模型升级时整包替换或按文件差量。
- **托管**：
  - Matcha 的 72MB + 51MB 两个文件都 <100MB，可以放同源 GitHub Pages 的 `public/models/`（站点总量 1GB 内没问题）；放在独立 repo 也行，只要是 `vaddenz.github.io` 同源，就没有 CORS 问题。
  - MeloTTS 的 163MB 单文件超过 GitHub 100MB 限制，需要 Releases/LFS 或 HF；不建议为它增加这套复杂度。
  - 备选镜像：Hugging Face `resolve/main` 支持 CORS/Range；但国内网络可能不稳，最好同源优先。
- **更新/删除**：设置页显示包大小、版本、最后使用时间；支持删除，删除后回退系统语音。
- **下载体验**：显示大小、进度、可取消；蜂窝网络先警告；下载完成前不阻塞用户用系统语音。

### 8.8 真机 bake-off 清单

用真实笔记挑 12 句，覆盖：

1. 纯中文长句；
2. 中英混排（`useEffect`、`side effect`、`TypeScript`）；
3. 代码标识符（`getVoices()`、`speechSynthesis`）；
4. 数字/日期/版本号（`v1.8.0`、`2026-10-21`、`120ms`）；
5. 引号/括号/破折号；
6. 英文整句；
7. 含 URL/文件路径的句子（应跳过或替换）；
8. 多音字（「重」「行」「长」「还」）；
9. 表格行；
10. 代码块前后的过渡句；
11. 标题；
12. 含 `==高亮==`/行内代码的句子。

每个候选（系统 / Matcha / Piper，旗舰机加 Kokoro）记录：

- 冷启动到第一声（秒）；
- 预热后首音延迟（秒）；
- RTF（合成耗时 / 音频时长），并注明 `crossOriginIsolated` 与 `numThreads`；
- 连续 10 分钟的耗电百分比与机身温度（主观）；
- 主观自然度 1–5、误读次数；
- 内存是否触发页面重载/OOM。

建议门槛（可按实际放宽）：

- 预热后首音 < 2s；
- RTF < 0.5（能稳定预取下一句）；
- 冷启动 < 10s；
- 连续 10 分钟无明显烫手/耗电异常；
- 主观不差于系统语音，或明显更好。

### 8.9 修订后的路线

- **Phase 1（不变）**：系统 TTS 前台 MVP：句级队列、高亮、暂停/继续、断点、Wake Lock、跳过代码、错误提示。
- **Phase 2（新增）**：本地引擎 spike，`?tts=local` 或设置开关；先接 Matcha，Worker + Web Audio + OPFS；跑 §8.8。
- **Phase 3（按结果）**：
  - 指标过关 → 做成可选离线包，下载后默认本地，系统回退；
  - 指标不过关 → 只保留系统 TTS，不发布模型包；
  - 不再需要 Media Session / 后台音频 / 锁屏控制相关开发。

---

## 9. 待验证的假设（不要写进 spec 当事实）

- **「预入队 20 句就能息屏续播」**：机制上说得通（语音队列在浏览器/系统 TTS 进程里，页面 JS 冻结不影响已入队条目），但没有规范保证，必须用目标手机实测。不同 ROM、不同 TTS 引擎、安装版 PWA 与浏览器标签都可能不同。
- **「Android Chrome 的 pause 一定是停止」**：多数报告如此，但不同 TTS 引擎/版本可能不同。实现上按「不可靠」设计，真机再确认。
- **「本地语音一定不出网」**：`localService === true` 只表示合成在本机；引擎自身的遥测不在应用控制范围内。文案不要承诺「绝对不上传」，只说「朗读文本在本机合成」。
- **「boundary 完全不能用」**：桌面本地语音可用，Android 网络语音多不可用；应做运行时探测，而不是编译期一刀切。
- **「Chrome 的收听此页在安装版 PWA 里可用」**：未验证；它本质上是 Chrome 浏览器功能，WebAPK 菜单可能没有。

### Phase 0 真机探测记录（2026-10-21，Edge Android 10）

- 设备：Android 10、Edge 139、8 核、浏览器标签、局域网 HTTP。
- `getVoices()` 始终 0；但 `speak()` 用系统默认语音正常朗读，首音 0.32s。
- 148 字长句 29.5s 完成，无 15s 截断；3 句队列句间 10–30ms。
- `pause()` 后 `speaking=true`、`paused=false`，未触发 `onpause`；暂停不可靠。
- 16 字句子 0 次 `boundary`；句级高亮是唯一稳妥方案。
- 锁屏约 21s 后 JS 冻结；只推进 2–3 句；60s 定时器晚 18s；后台续播不可靠。
- 主观 3/5：中文尚可，`useEffect` 连读不自然。

> 注意：这是 Edge 的结果，Chrome 通常会返回语音列表，pause/boundary 也可能不同；Phase 1 前需用 Chrome + HTTPS + 安装版复测。详见 [TTS spec §15](../specs/2026-10-21-tts-design.md#15-phase-0-实测结果2026-10-21)。

### 本次本机探测记录（仅供参考）

- 环境：macOS Chrome（Playwright headless，`--autoplay-policy=no-user-gesture-required`），页面内点击后 `speak()`。
- `getVoices()`：180 个语音，其中 18 个 `zh`。
- 本地中文语音朗读英文句子，`volume = 0` 时仍触发 `start`、`boundary`（`charIndex`/`charLength` 正常）、`end`。
- 说明：这只能证明桌面 Chrome + 本地语音的 API 行为；**不能外推到 Android**。CI Linux 通常没有语音，自动化测试必须 fake。

---

## 10. 参考

- MDN: `SpeechSynthesis` — https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesis
- MDN: `SpeechSynthesisUtterance` boundary event（Limited availability）— https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesisUtterance/boundary_event
- MDN: Screen Wake Lock API（Baseline 2025）— https://developer.mozilla.org/en-US/docs/Web/API/Screen_Wake_Lock_API
- MDN: CSS Custom Highlight API（Baseline 2025）— https://developer.mozilla.org/en-US/docs/Web/API/CSS_Custom_Highlight_API
- Chromium issue 40747712: 长语音约 15 秒截断 — https://issues.chromium.org/issues/40747712
- Chromium issue 41195426: Android/网络语音不触发 boundary — https://issues.chromium.org/issues/41195426
- MDN BCD issue 4500: Chrome Android `pause()`/`resume()` 异常 — https://github.com/mdn/browser-compat-data/issues/4500
- Readium: SpeechSynthesis in browsers and OSes — https://readium.org/speech/docs/WebSpeech.html
- Readium: Read Aloud best practices — https://github.com/HadrienGardeur/read-aloud-best-practices
- Chrome autoplay 限制 `speechSynthesis.speak()` — https://chromestatus.com/feature/5687444770914304
- Chrome Help: Listen to this page（Android，支持中文、锁屏播放）— https://support.google.com/chrome/answer/14768725
- Piper 中文语音 `zh_CN-huayan-medium` — https://huggingface.co/Trelis/piper-zh-cn-huayan-medium
- piper-tts-web（浏览器 WASM 封装，OPFS 缓存）— https://www.npmjs.com/package/@mintplex-labs/piper-tts-web
- Kokoro-82M-v1.1-zh ONNX — https://huggingface.co/onnx-community/Kokoro-82M-v1.1-zh-ONNX
- sherpa-onnx WASM 中文 TTS 示例 — https://k2-fsa.github.io/sherpa/onnx/javascript-api/examples/index.html
- Chrome 后台标签节流（播放音频的页面通常不被节流）— https://developer.chrome.com/blog/background_tabs
