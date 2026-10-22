# 文档朗读（TTS）设计（v1.9）

> 日期：2026-10-21 · 状态：Phase 1 已合并（v1.10.0）；Phase 2 已实现（待真机验收，目标 v1.11.0）
> 关联：[浏览器 TTS 调研](../research/2026-10-21-browser-tts.md)、[产品定义](../../PRODUCT.md)、[设计系统](../../DESIGN.md)
> 范围：阅读页前台朗读。系统 TTS 为默认引擎；Phase 2 增加可选的本地 Matcha zh-en 离线语音包。
> 目标版本：v1.9.0（Phase 1）/ v1.11.0（Phase 2；Phase 1 已占用 v1.10.0）。

## 1. 目标与非目标

### 1.1 目标

1. 在阅读页朗读当前文档，支持「从头朗读」和「从选中处朗读」。
2. 以「句」为单位播放，当前句高亮并自动滚动；用户手动滚动时暂停跟随。
3. 提供播放/暂停、上一句/下一句、语速、音色、睡眠定时。
4. 每篇文档独立记住朗读位置，重新打开时可「继续朗读」。
5. 默认跳过代码块、mermaid、表格、URL 等不适合朗读的内容；可配置。
6. 系统语音缺失、离线语音不可用、自动播放被拦截时，有明确可恢复的提示。
7. Phase 2：可选下载 Matcha zh-en 本地语音包（约 135MB），离线推理，音色一致，句内精确暂停；失败自动回退系统 TTS。

### 1.2 非目标

- 锁屏/后台播放、Media Session、通知栏/蓝牙控制；
- 云 TTS、把正文发给任何第三方；
- 逐词高亮（只在 `boundary` 可用时做增强，不作为架构前提）；
- 音频导出/下载、录音、音效处理；
- 跨设备同步朗读进度；
- 朗读 UI、搜索命中、记忆题、代码块等非正文内容；
- 中英自动切换系统语音（v1 用中文语音读英文术语；Phase 2 本地包天然支持中英混读）。

## 2. 已确认决策

| # | 决策 |
|---|---|
| 1 | 页面隐藏（`visibilitychange`）时让**当前句播完**再暂停并保存；回前台若隐藏前是播放态且平台允许，则自动继续，否则提示「继续朗读」 |
| 2 | 系统 TTS 是默认引擎；不要求用户下载任何模型即可使用 |
| 3 | 不接云 TTS；网络语音默认关闭，只列 `localService === true` 的语音 |
| 4 | Phase 1 不引入 WASM；Phase 2 的本地包仅在真机 bake-off 通过后发布 |
| 5 | 本地包首选 Matcha zh-en（约 135MB，16kHz，中英混读）；Piper 63MB 作为「纯中文、省体积」备选 |
| 6 | 暂停语义：系统 TTS 优先调用原生 `pause()` / `resume()`（Edge Android 实测听感可用）；若平台表现为停止（`speaking` 变 false / `onend` 提前触发），回退为「取消 + 记住句索引，恢复时整句重播」。本地引擎为「AudioContext.suspend + buffer offset，句内精确恢复」 |
| 7 | 模型存 OPFS，按需下载，不进 Service Worker 预缓存；下载前检查空间、`persist()`、校验 SHA-256 |
| 8 | Phase 2 才修改 CSP：`script-src 'self'` 增加 `'wasm-unsafe-eval'`；不引入 `'unsafe-eval'` |
| 9 | 朗读位置只存本机，不参与跨设备同步 |
| 10 | 播放期间持有 Screen Wake Lock；页面隐藏/暂停/结束时释放 |
| 11 | 默认跳过：代码块、mermaid、表格、URL/文件路径；图片读 alt；链接只读文字 |
| 12 | **`getVoices()` 为空不阻断朗读**：仍用 `lang='zh-CN'` 调 `speak()`，以 `onstart` / `onerror` 判定是否可用。Edge Android 实测语音列表为 0，但系统默认语音能正常朗读（详见 §15） |
| 13 | Phase 1 按「保守 + 可回退」设计：原生 pause 优先、失败回退重播；`boundary` 与语音列表不可靠，不能作为架构前提 |

## 3. 用户流程

### 3.1 入口

1. **阅读页顶栏 `⋯` 菜单**：新增「朗读」项（播放中为「暂停朗读」，暂停时为「继续朗读」，读完为「重新朗读」）。点击后打开播放器，优先从上次位置开始；没有位置时从当前视口第一句开始。顶栏不新增独立图标，避免过度突出。
2. **选区菜单**：有选区且不在排除区时，新增「从这里朗读」；点击后从选区所在句开始。
3. **入口只保留这两处**，不并存顶栏图标。

### 3.2 首次使用

1. 点击入口 → 状态 `preparing`：
   - 检查 `'speechSynthesis' in window`；
   - **提前**加载语音列表（`getVoices()` + `voiceschanged` + 轮询），但**不把空列表当失败**；
   - 有中文语音则按 `localService` / `zh-CN` 优先级选默认；没有则使用系统默认语音（`lang='zh-CN'`）。
2. 从目标句开始播放；第一句的 `speak()` 必须在入口 click handler 的调用栈里发起。若列表未就绪，先用 `lang: 'zh-CN'` 直接 `speak()`，后续句再套用选中的 voice。
3. 没有 `speechSynthesis` → `unsupported`，显示「当前浏览器不支持朗读」。
4. 列表为空或没有中文语音 → **仍先尝试一次默认语音**：
   - `onstart` 触发 → 视为可用，继续播放；语音面板显示「系统默认语音（列表不可用）」；
   - `onerror` 为 `language-unavailable` / `synthesis-failed` / `not-allowed`（重试一次后）→ 进入 `no-voice` 或 `blocked`；
   - `no-voice` 文案：Android「系统没有可用的中文语音。请到 设置 → 文字转语音 → Google 语音服务 安装中文语音数据。」；Phase 2 额外显示「下载离线语音包」。
5. 自动播放被拦截 → `blocked`，播放器显示「点按继续朗读」；再次点击即可。

### 3.3 播放中

- 当前句用强调色下划线/浅底高亮；滚动到视口 35% 位置。
- 用户手动滚动（wheel/touchmove/翻页键）后，自动跟随暂停 8 秒；播放器出现「回到当前」。
- 点击播放/暂停：优先原生 `pause()`/`resume()`；平台把 pause 当停止时回退为「停止 + 从当前句重播」。
- 上一句/下一句：从目标句重新开始。
- 改语速/音色：从当前句重新开始（系统）；本地引擎重新合成当前句。
- 页面隐藏、切换文档、切换标签、路由离开、组件卸载：停止播放并保存位置。
- 睡眠定时到点：在当前句结束后停止，不句中打断。

### 3.4 再次打开

- 若该文档有朗读位置且不在开头，`⋯` 菜单项显示「继续朗读」；点击后从记录句开始。
- 不自动播放（浏览器也会拦截）。

## 4. 架构

### 4.1 模块

```
src/tts/
  types.ts            // TtsPrefs / TtsPosition / Chunk / PlayerState / SpeechSource
  segment.ts          // DOM → Chunk[]（清洗、分句、范围映射）
  voices.ts           // 语音加载、归一化、筛选、默认选择
  player.ts           // 状态机、队列、代际 token、错误处理；引擎无关
  system-source.ts    // speechSynthesis 实现
  local-source.ts     // Phase 2：Worker + Web Audio，句内精确暂停
  model-store.ts      // Phase 2：OPFS 下载/校验/解压/删除
  model-manifest.ts   // Phase 2：Matcha zh-en 文件清单（ModelScope CDN URL + SHA-256）
  tar.ts / opfs.ts    // Phase 2：tar.gz 解析、OPFS 读写
  prefs.ts / useTts.ts
public/tts/
  tts-worker.js       // sherpa-onnx WASM + 从 OPFS 挂载模型
  runtime/            // sherpa-onnx 预构建 WASM（Apache-2.0，已提交）
components/
  TtsBar.tsx          // 底部播放条
  TtsSheet.tsx        // 展开面板（引擎/离线包/音色/语速/睡眠定时）
```

- `DocPage` 只负责把 `contentRef`、`path`、`ready` 传给 `useTts`，并渲染 `<TtsBar>`；不把播放逻辑塞进 2000 行的页面组件。
- `DocHeader` 新增 `onOpenTts` / `ttsActive` 两个 props。
- `selection-menu.ts` 新增 `read-aloud` action；`DocPage` 的 `onAction` 里把选区映射到句索引。
- `prefs.ts` 复用 `kvGet/kvSet`；不需要 IndexedDB schema 升级。

### 4.2 状态机

```ts
type PlayerState =
  | 'idle'        // 未开始
  | 'preparing'   // 加载语音/模型、准备第一句
  | 'playing'
  | 'paused'
  | 'ended'
  | 'blocked'     // 需要用户手势
  | 'no-voice'    // 没有可用中文语音
  | 'unsupported' // 没有 speechSynthesis / 本地引擎不可用
  | 'error';
```

状态迁移：

```
idle → preparing → playing ⇄ paused → ended
                 ↘ blocked / no-voice / unsupported / error
playing/paused → idle（关闭、换文档、卸载）
```

- `ended` 表示全文读完；保存位置为末尾。
- `error` 保存可恢复原因；UI 提供「重试」「切回系统语音」（Phase 2）。

### 4.3 队列

- Phase 1 实现采用**逐句顺序播放**：一次 `speak()` 一句，`await` 结束后再下一句。理由：
  - 锁屏/隐藏时天然是「当前句播完再停」；
  - 暂停/跳转/取消的清理简单，不会有一串已排队句子在后台继续；
  - 长句无截断（Edge 实测 148 字/29.5s 正常结束），句间 100–300ms 间隙可接受。
- 预排队列（8 句）只作为优化项：若真机句间间隙明显（>300ms）或需要更平滑的连读，再改为预排 2–3 句；不采用 20 句后台预排。
- 本地引擎 Phase 2 仍用 2 句预取（当前 + 下一句）。
- `chunkIndex` 是唯一位置标识。
- 每次 `stop/seek/rate/voice/文档切换` 都 `gen++`；事件回调先比对代际，丢弃过期事件。
- Edge 实测 `cancel()` 后立即 `speak()` 可用（12ms 后 start）；不强制延时。若其它浏览器出现吞句，再加 60–100ms 守卫。
- 保留当前 utterance 引用，避免 Chrome 上 GC 导致事件丢失。

### 4.4 引擎接口

```ts
interface SpeakOptions {
  rate: number;
  /** 这一句真正开始播放时触发；Player 用它更新当前句/高亮/进度 */
  onStart?: () => void;
}

interface SpeechSource {
  readonly kind: 'system' | 'local';
  readonly supportsMidSentencePause: boolean;

  init(): Promise<void>;
  /** 播放一句；resolve 表示这句正常播完，或被 stop/seek 取消 */
  speak(chunk: Chunk, opts: SpeakOptions): Promise<void>;
  /** 预取下一句（本地引擎用；系统引擎 no-op） */
  prefetch?(chunk: Chunk, opts: SpeakOptions): void;
  pause(): void;
  resume(): void;
  stop(): void;
  setRate(rate: number): void;
  setVoice(voiceKey: string | null): void;
}
```

- `Player` 持有 `SpeechSource`，不关心底层是 `speechSynthesis` 还是 AudioBuffer。
- `SystemSource.speak` 在 `onend` resolve；`stop()` 触发 `cancel()`，当前 Promise resolve（不 reject），由 `gen` 区分取消。
- `LocalSource.speak` 在音频 buffer 播完 resolve；`pause()` 用 `AudioContext.suspend()`；`stop()` 停止 source 并丢弃队列。
- Phase 2 切换引擎时保持 `chunkIndex`，从同一句继续。

## 5. 内容流水线

### 5.1 取文本

从 `contentRef` 的渲染 DOM 取文本，不重新解析 Markdown。用 `TreeWalker` 遍历文本节点，按最近的块级祖先分组。

跳过规则（祖先匹配任一即跳过）：

| 选择器 | 处理 |
|---|---|
| `pre` | 跳过整个代码块；>5 行时可选播报「代码块」；默认静默 |
| `.mermaid`、`svg` | 跳过；默认静默 |
| `script`、`style`、`button`、`.note-mark` | 跳过 |
| `.tts-ignore` | 跳过（预留给未来 UI） |

### 5.2 清洗

- 链接：只保留链接文字，丢弃 `href`；`<a>` 内文本正常读。
- 图片：有 `alt` 读 alt；无 alt 跳过。
- 行内代码：保留文本；默认原样读，设置项「行内代码降速」默认关。
- **代码标识符拆词**：camelCase / PascalCase / snake_case / kebab-case 在朗读前拆成普通词：
  - `useEffect` → `use Effect`；`getVoices` → `get Voices`；`use_reading_progress` → `use reading progress`；
  - 默认只拆词、不加逗号；Phase 0 反馈 `useEffect` 连读不自然，拆词后需再试听「是否要加逗号」；
  - 纯大写缩写（`API`、`URL`、`HTTP`）不拆，避免逐字母。
- 脚注引用、锚点符号：跳过。
- URL、文件路径、十六进制、长数字串：替换为「链接」或跳过（正则 + 长度阈值）。
- Markdown 残留符号：`**`、`__`、`~~`、`==`、反引号、表格竖线；渲染后通常已消失，清洗仍兜底。
- 连续空白/换行折叠为一个空格；中文标点统一（`……` → `…`）。

### 5.3 分句

```ts
const seg = new Intl.Segmenter('zh', { granularity: 'sentence' });
```

规则：

1. 按 `Intl.Segmenter` 分句；保留句末标点。
2. 过短句（<12 字）与下一句合并，避免频繁起停。
3. 过长句（中文 >60 字 / 英文 >180 字符，或预估 >12 秒）在 `，、；：,;` 处再切；仍过长则硬切。实测该语音约 5–6 字/秒，60 字中文约 10–12 秒，正好在目标区间。
4. 标题单独成块，前后加 150ms 停顿（由队列在块边界插入短静音/延时，不改文本）。
5. 列表项逐项成句；有序列表不读序号（读内容即可）。
6. 表格默认跳过；开启后按行读，单元格之间用「，」分隔，读表头一次。
7. 代码块/图表默认跳过；不把代码标识符送进 TTS。

### 5.4 中英混排

- 系统 TTS：默认统一用中文语音；英文术语会带口音，但可懂。设置项「英文句子切换英文语音」默认关（换声很突兀）。
- 本地 Matcha：模型原生支持中英混读，不切换语音。
- 每个 chunk 设置 `lang`：拉丁字符占比 >60% 记为 `en-US`，否则 `zh-CN`；仅作为 `utterance.lang` 的提示，不强制切 voice。

### 5.5 范围映射

- 每个 chunk 记录 `{ text, lang, blockEl, startOffset, endOffset }`，用 `Range` 映射回 DOM。
- 文本节点跨多个 chunk 时，按字符偏移拆分 Range；不要包裹 DOM。
- 文档因高亮/笔记重渲染后，用 `MutationObserver` 防抖重建；优先按「当前句文本」重新定位，失败则退回块级高亮。

## 6. 高亮与滚动

### 6.1 当前句高亮

优先 CSS Custom Highlight API：

```ts
CSS.highlights.set('tts-current', new Highlight(range));
```

```css
::highlight(tts-current) {
  background: color-mix(in srgb, var(--acc) 14%, transparent);
  text-decoration: underline;
  text-decoration-thickness: 1px;
  text-underline-offset: 3px;
}
```

- 用 `--acc` 的浅色底 + 下划线，和 `--hl-yellow` / `--hl-red` 的持久高亮区分。
- 不支持 `CSS.highlights` 时，降级为当前块元素加 `.tts-current-block`（左侧 2px 强调线 + 浅底），不包裹文本。
- `::highlight` 只支持文本样式，不要用 border/box-shadow。

### 6.2 自动滚动

- 当前句 `range.getBoundingClientRect()`：
  - `top < 80` 或 `bottom > innerHeight - 120` 时滚动；
  - 目标位置：`rect.top - innerHeight * 0.35`；
  - `behavior: 'smooth'`；`prefers-reduced-motion: reduce` 时用 `auto`。
- 用户手动滚动后 8 秒内不跟随；显示「回到当前」按钮。
- 播放器出现时给正文容器加底部 padding（`56px + env(safe-area-inset-bottom)`），避免最后一段被遮住。

## 7. 数据模型

```ts
interface TtsPrefs {
  engine: 'system' | 'local';      // 默认 system
  systemVoiceKey: string | null;   // `${normalizedLang}|${name}`
  rate: number;                   // 0.75–2.0，默认 1.0
  skipCode: boolean;              // 默认 true
  readTable: boolean;             // 默认 false
  keepAwake: boolean;             // 默认 true
  localOnly: boolean;             // 默认 true：只列 localService 语音
  cueSkippedBlocks: boolean;      // 默认 false：跳过长代码块时播报「代码块」
}

interface TtsPosition {
  index: number;      // chunk 索引
  char: number;       // 句内字符偏移，系统 TTS 恒为 0
  updatedAt: number;
}
```

- 存储键：
  - `tts.prefs` → `TtsPrefs`；
  - `tts.pos.<docPath>` → `TtsPosition`；
  - `tts.model` → Phase 2 的模型元数据。
- 默认值集中在 `DEFAULT_TTS_PREFS`，读取时做 `sanitize`（未知字段丢弃、rate 钳制）。
- 语音选择存 `lang|name`，启动时重新解析；找不到就回退默认中文语音，不报错。
- 不新增 IndexedDB schema；`kv` 已够用。Phase 2 的模型文件存 OPFS，元数据存 `kv`。

## 8. 系统引擎细节

### 8.1 语音加载

```ts
const norm = (lang: string) => lang.replace('_', '-').toLowerCase();
const zh = voices
  .filter(v => norm(v.lang).startsWith('zh'))
  .sort((a, b) => Number(b.localService) - Number(a.localService));
```

- `getVoices()` 可能为空：监听 `voiceschanged`，并每 250ms 轮询一次，最多 10s。空列表不是错误——**先尝试默认语音**。
- Edge Android 实测：`getVoices()` 始终返回 `[]`，但 `speak()` 仍能正常朗读。Chrome Android 通常能返回语音列表；两者都要兼容。
- Android Chrome 的 `lang` 可能是 `zh_cn`，必须归一化。
- Chrome Android 的 `default` 全为 false，不依赖；`voiceURI` 不唯一，不存 URI。
- 选择顺序：本地中文 > 中文 > 系统默认（voice 为 null）；**没有中文时不要直接 `no-voice`**，先 `speak()` 验证。
- 网络语音（`localService === false`）默认不展示；设置里「更多语音」可打开，首次选择时提示「需要联网，文本会发送给语音提供方」。
- 语音面板在列表为空时显示「系统默认语音（列表不可用）」，不要显示空下拉框或错误态。

### 8.2 播放

- 第一句在入口的 click handler 内 `speak()`；语音列表提前在页面挂载时加载，避免点击时还在等 `voiceschanged`。后续由 `onend` 驱动。
- 没有可用 `voice` 时，`utterance.voice` 不设置、`utterance.lang = 'zh-CN'`，让系统默认引擎选择；`onstart` 成功即可继续。
- `utterance.onstart = opts.onStart`；Player 在回调里把 `currentIndex` 设为该句。
- `utterance.lang` 显式设置为语音的 `lang`；Android 上不设置可能行为不确定。
- `rate` 钳制 0.75–2.0；`volume = 1`；`pitch` 不暴露（保持 1）。
- `onstart`：更新当前句、写进度、启动高亮/滚动。
- `onend`：补队尾；最后一句时 `ended`。
- `onerror`：
  - `canceled` / `interrupted`：自己的取消，忽略；
  - `not-allowed`：`blocked`；
  - `voice-unavailable` / `language-unavailable`：换默认中文语音重试一次；
  - `network`：如果当前是网络语音，回退本地语音；否则提示离线不可用；
  - 其他：跳过当前句；连续 3 句失败则停止并显示错误。
- 启动超时：`speak()` 后 1.5s 内没有 `onstart` 且没有 `onerror`，视为 `blocked`/`error`，提示用户重试；不要根据 `speechSynthesis.speaking` 立即判定失败（实测 `speak` 后即为 true）。

### 8.3 暂停与跳转

- `pause()`：先调原生 `speechSynthesis.pause()`，状态置 `paused`；**不要**立刻 `cancel()`（会丢掉句内位置）。
- 判定原生 pause 是否生效：
  - 150ms 后若 `speechSynthesis.speaking` 仍为 true，按「原生暂停」处理；
  - 若 `speaking` 变 false 或收到 `onend`，说明该平台把 pause 当停止：记住 `currentIndex`，恢复时整句重播。
- `resume()`：优先 `speechSynthesis.resume()`；若恢复后 500ms 内没有任何进度（无 `onstart` / `onend`，且 `speaking` 为 false），从 `currentIndex` 重新 `speak()`。
- 上一句/下一句：`gen++`、`cancel()`、从目标句重建队列。
- 改语速/音色：同上一句/下一句，从当前句重播。
- 关闭：`stop()`、取消定时器、释放 wake lock、保存位置。

### 8.4 页面隐藏

```ts
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden' && state === 'playing') {
    pauseAfterCurrentChunk(); // 不立刻 cancel，让当前句播完
  } else if (document.visibilityState === 'visible' && wasPlayingBeforeHidden) {
    resume(); // 平台允许则继续；失败时提示「继续朗读」
  }
});
```

- 锁屏时让当前句播完再暂停，保存位置；不做后台续播。
- 回前台且隐藏前是播放态 → 自动 `resume()`；如果浏览器拦截或没有恢复，播放器显示「继续朗读」，不静默失败。
- 页面隐藏时 `wakeLock` 会自动释放；回前台且仍在播放时重新申请。

### 8.5 Wake Lock

- 播放时 `navigator.wakeLock.request('screen')`；不支持则静默跳过。
- `wakeLock.addEventListener('release', ...)` 把引用置空；`visibilitychange` 可见且状态为 playing 时重新申请。
- 暂停/结束/卸载时 `release()`。
- UI 设置「播放时保持屏幕常亮」默认开。

## 9. 本地引擎（Phase 2）

### 9.1 模型：Matcha zh-en（唯一发布）

Phase 2 bake-off 后只保留 **Matcha zh-en**：

| 文件 | 大小 | 说明 |
|---|---|---|
| `model-steps-3.onnx` | 75.7MB | 声学模型 |
| `vocos-16khz-univ.onnx` | 53.9MB | vocoder |
| `lexicon.txt` / `tokens.txt` / `*.fst` | 约 1.6MB | 文本前端 |
| `espeak-ng-data.tar.gz` | 9.0MB | 英文 espeak 数据，下载后解压 |
| WASM runtime | 13.5MB + JS | 随 app 发布（`public/tts/runtime`），懒加载并缓存 |

- 采样率 16kHz；单说话人；中英混读；RTF 在 Mac 上约 0.14。
- 被评估并淘汰的模型（2026-10-22 结论）：
  - **Matcha zh-baker 22k**：中文更自然，但直接跳过英文，中英混排不可用；
  - **MeloTTS zh-en 44k**：中文尚可，英文差，RTF≈1.5，手机更慢；
  - **VITS zh-ll**：仅中文，RTF≈1.07；
  - **Kokoro v1.1 int8/fp32**：官方 int8 在 Android 上无法合成，fp32 音质不优于 Matcha 且 RTF≈1.9。
- 模型文件来自 ModelScope CDN（`bujidc/matcha-icefall-zh-en`），浏览器直接 `fetch` 下载，不经过应用服务器。

### 9.2 运行时

- `sherpa-onnx` WASM 预构建（Apache-2.0）提交在 `public/tts/runtime`；`scripts/tts-runtime-setup.mjs` 可重新生成（会去掉内置 `.data` 模型包）。
- 跑在 Web Worker（`public/tts/tts-worker.js`）；主线程只做 UI/音频调度。
- **单线程**：GitHub Pages 无 COOP/COEP，`SharedArrayBuffer` 不可用；`numThreads = 1`。
- 若未来换托管（Cloudflare Pages/Netlify）并能设置 COOP/COEP，再评估多线程。
- 不默认使用 `coi-serviceworker`：`COEP: require-corp` 可能阻断跨域图片/字体；如要尝试，单独评审并做全站回归。

### 9.3 音频

- 用户手势内创建 `AudioContext`；`resume()` 后开始。
- 一句一个 `AudioBuffer`；`AudioBufferSourceNode` 调度播放。
- 预取下一句：当前句播放时 `LocalSource.prefetch()` 让 Worker 合成下一句并缓存。
- 暂停：`AudioContext.suspend()`；恢复：`resume()`；位置由音频时钟保留，句内精确。
- 停止：`source.stop()`、清空队列、`ctx.resume()` 以保持后续可用。
- 语速：传 `speed = rate` 重新合成；不用 `playbackRate`（会变调）。
- 内存：缓存当前 + 下一句的 buffer；`stop()` 时清空。

### 9.4 模型下载

- `src/tts/model-manifest.ts` 内置清单：文件路径、大小、SHA-256、ModelScope URL；`espeak-ng-data.tar.gz` 标记 `archive`。
- 下载到 OPFS：`tts/matcha-zh-en/v1/...`；用 `fetch` + `ReadableStream` 显示进度；`AbortController` 支持取消。
- 下载前：
  - `navigator.storage.estimate()`，剩余空间 < 1.5× 模型大小则拒绝并提示；
  - `navigator.storage.persist()`。
- 下载后逐文件 SHA-256 校验；`tar.gz` 用 `DecompressionStream('gzip')` + `parseTar` 解压到 OPFS；失败删除整个目录并重试。
- TtsSheet「引擎 › 离线语音包」显示：包大小、版本、下载/删除按钮；删除后 `engine` 回退 `system`。
- **不要**把模型放进 Workbox 预缓存；WASM runtime 用 `runtimeCaching` CacheFirst 缓存。

### 9.5 分发

- 模型文件不进主仓；运行时从 ModelScope CDN 按需下载到 OPFS。
- WASM runtime 进主仓 `public/tts/runtime`（约 13.6MB），Service Worker 运行时缓存，首次使用后离线可用。
- 模型下载后完全离线；飞行模式下本地引擎仍可合成。

### 9.6 CSP

Phase 2 必须修改 `index.html`：

```
script-src 'self' 'wasm-unsafe-eval';
```

- 只放行 WASM 编译，不放行 JS `eval`。
- 如果库使用 Blob Worker，再加 `worker-src 'self' blob:`；优先用 Vite 打包的同源 Worker，避免放宽。
- 同步更新 `tests/e2e/pwa.spec.ts` 的 CSP 断言，并在验收里记录这次安全面变更。

## 10. UI

### 10.1 ⋯ 菜单入口

- 在顶栏 `⋯` 菜单中新增「朗读」项（搜索之后），图标为扬声器。
- 文案随状态变化：`朗读` / `暂停朗读` / `继续朗读` / `重新朗读`。
- 不在顶栏新增独立图标；阅读页顶栏保持「返回 · 标题 · ⋯」。
- 菜单项与选区菜单共用同一个 `tts.start / toggle` 处理器。

### 10.2 播放条

- 固定在底部，`padding-bottom: env(safe-area-inset-bottom)`；背景 `--card`，上边框 `--line`，阴影 `--shadow-card`。
- 高度 56px；内容：
  - 播放/暂停（44px 主按钮）；
  - 上一句/下一句（36px）；
  - 当前状态文案：「第 12/86 句 · 约剩 18 分钟」；
  - 语速 `1.0x`；
  - 「展开」打开 sheet；
  - 关闭。
- 窄屏（<380px）只保留：播放/暂停、状态、语速、展开、关闭；上一句/下一句收进 sheet。
- 播放条出现时：
  - 正文底部加 padding，`PrevNext` 自然上移，不被遮挡；
  - 播放条出现时隐藏 TOC FAB；目录入口移入朗读设置面板（「目录」按钮），避免浮动按钮遮挡正文；
  - 播放条不覆盖正文最后一段。
- `role="region" aria-label="朗读控制"`；状态变化用 `aria-live="polite"`，不要每句播报。

### 10.3 展开面板

底部 sheet（复用 `Drawer` 外壳）：

- 语音：系统语音列表（中文优先，本地/网络标签）；Phase 2 增加「离线语音包」卡片。
- 语速：0.75 / 1.0 / 1.25 / 1.5 / 2.0。
- 睡眠定时：关 / 15 / 30 / 45 / 60 分钟；显示剩余。
- 开关：跳过代码块（默认开）、朗读表格（默认关）、保持屏幕常亮（默认开）、跳过长块时提示（默认关）。
- Phase 2 模型卡片：大小、版本、下载/删除、试听、许可说明。
- 面板打开时锁背景滚动；Esc/遮罩/关闭按钮关闭；不停止播放（除非点「停止」）。

### 10.4 空态与错误

| 状态 | 文案/操作 |
|---|---|
| `unsupported` | 「当前浏览器不支持朗读。」 |
| `no-voice` | 系统中文语音引导 + Phase 2「下载离线语音包」 |
| `blocked` | 「点按继续朗读」 |
| `error` | 原因 + 「重试」；Phase 2「切回系统语音」 |
| 模型下载失败 | 「下载失败，请重试」；保留系统引擎 |
| 存储不足 | 「空间不足，至少需要 X MB」；提供删除旧包 |
| 离线 + 网络语音 | 「当前语音需要联网，已切换到本地语音」 |
| 页面隐藏后回来 | 「已暂停，点按继续」 |

## 11. 边界与错误

| 场景 | 行为 |
|---|---|
| 切换文档/标签/仓库 | `stop()`、保存旧文档位置、清空 UI；不得串音 |
| 路由离开/组件卸载 | `stop()`、取消定时器、释放 wake lock |
| 页面隐藏 | 暂停并保存；回前台不自动播 |
| 电话/其他媒体打断 | 系统可能触发 `interrupted`；忽略错误，状态置 `paused`，提示继续 |
| 快速连点播放/暂停/下一句 | 代际 token 丢弃旧事件；`cancel()` 后 60–100ms 再 `speak()` |
| 语音被系统删除 | 启动时重新解析 voiceKey；找不到回退默认中文；仍无则 `no-voice` |
| 朗读中含 mermaid/代码 | 跳过；不把 SVG/代码文本送进 TTS |
| 长文档（>5 万字） | 懒分句：先分当前块与后续 20 块，滚动/播放时继续；不一次性建全部 Range |
| 高亮/笔记导致 DOM 变化 | 防抖重建 Range；失败退块级高亮，不中断播放 |
| 本地模型 OOM | 停止本地引擎、释放 buffer、回退系统 TTS，提示一次 |
| CSP 阻止 WASM | 本地引擎初始化失败，回退系统；控制台记录明确错误 |
| 模型文件校验失败 | 删除损坏文件，提示重试；不进入本地引擎 |

## 12. 测试

### 12.1 单元测试

- `tests/unit/tts-segment.test.ts`：
  - 跳过 `pre`/`.mermaid`/`svg`/按钮；
  - 链接只读文字、图片 alt、URL 替换；
  - 分句合并/切分、最大长度、块边界；
  - chunk 与文本偏移映射。
- `tests/unit/tts-player.test.ts`（fake `SpeechSource`）：
  - play/pause/resume/seek/rate/voice；
  - 预入队与补队；
  - 代际 token 丢弃过期事件；
  - `not-allowed` → blocked；`voice-unavailable` → fallback；连续失败 → error；
  - 结束、空文档、单句文档。
- `tests/unit/tts-prefs.test.ts`：默认值、sanitize、rate 钳制、voiceKey 解析、engine 枚举。
- `tests/unit/tts-model-manifest.test.ts`：清单路径唯一、SHA-256 格式、归档标记、总量范围。
- `tests/unit/tts-model-store.test.ts`：下载写入、SHA 校验失败清理、元数据非法值、删除。
- `tests/unit/tts-tar.test.ts`：tar 解析、目录项忽略。
- `tests/unit/tts-player.test.ts`：系统/本地两种 pause 语义、顺序播放、错误分支。
- `tests/unit/selection-menu.test.ts`：新增 `read-aloud` 项及排除区不出现。

### 12.2 e2e

- 注入 fake `speechSynthesis`（`addInitScript`），避免真实音频：
  - `⋯` 菜单「朗读」→ 播放条出现、状态「播放中」、当前句高亮；
  - 暂停 → 「已暂停」；继续 → 从当前句重播；
  - 上一句/下一句、语速；
  - 选区菜单「从这里朗读」；
  - 切换文档 → 播放停止、位置保存；
  - `visibilitychange` hidden → 暂停；
  - 无 `speechSynthesis` → `unsupported`；
  - `getVoices()` 为空但 fake `speak()` 能触发 `start` → 正常播放，不进入 `no-voice`；
  - `speak()` 报 `language-unavailable` → `no-voice` 引导；
  - 刷新后「继续朗读」恢复索引。
- CSP 回归：Phase 1 保持 `script-src 'self'`；Phase 2 断言包含 `'wasm-unsafe-eval'`。

### 12.3 真机验收（Phase 1）

- [ ] 系统默认语音可用时，点击后 2s 内出声；
- [ ] `getVoices()` 为 0 时仍能朗读（Edge Android 实测），不显示错误态；
- [ ] 当前句高亮、自动滚动；手动滚动后 8s 内不抢滚动；
- [ ] 暂停/继续、上一句/下一句、语速切换正常；原生 pause 可用时句内继续，不可用时从当前句重播；
- [ ] `boundary` 为 0 时句级高亮正常，不报错；
- [ ] 刷新/重开文档可继续；
- [ ] 代码/图表/表格默认跳过，无乱读；`useEffect` 拆词后听感可接受；
- [ ] 无语音/离线/被拦截时有可恢复提示；
- [ ] 切文档/切标签/锁屏/回桌面后无残留声音；
- [ ] 播放时屏幕不自动熄灭（支持 wake lock 的机型）；
- [ ] 连续 20 分钟无卡死/明显发热。

### 12.4 真机 bake-off（Phase 2 门槛）

用真实笔记 12 句（纯中文、中英混排、代码标识符、数字/日期、多音字、英文整句、表格、URL、标题、行内代码）：

- 冷启动到第一声 <10s；
- 预热后首音 <2s；
- 单线程 RTF <0.5；
- 连续 10 分钟无 OOM/明显烫手；
- 主观不差于系统语音，或明显更好；
- 句内暂停/恢复位置准确；
- 模型下载/校验/删除/离线可用。

不达标就不发布本地包，保留系统 TTS；Phase 2 代码可以留在分支，不合并。

## 13. 分阶段

### Phase 0：探针（0.5 天，可选）

- 隐藏路由 `/tts-probe`（不进入导航；Phase 0 期间保留在生产构建，方便手机直接打开；验证完删除）：
  - dump `getVoices()`（name/lang/localService/default）；
  - 朗读 3 句、pause/resume、事件日志；
  - 60 秒息屏/切后台测试（用于确认「不做后台」的边界）。
- 目的：确认目标手机的系统语音可用性与暂停行为；不阻塞 Phase 1。

### Phase 1：系统 TTS（v1.9，约 3–4 天）

- `src/tts/` 基础模块 + `useTts`；
- `⋯` 菜单入口、选区菜单、播放条、展开面板；
- 分句/清洗/高亮/滚动/进度/wake lock；
- 空态/错误/可见性处理；
- 单测 + e2e + 真机验收。

### Phase 2：本地引擎（v1.11，已实现，待真机验收）

- Spike：Matcha + sherpa-onnx WASM + Worker + Web Audio，隐藏探针页；bake-off 通过后进入正式实现。
- 正式实现：`SpeechSource` 双引擎、OPFS 下载/校验/解压/删除、TtsSheet 离线包卡片、失败回退系统 TTS、CSP/WASM 运行时缓存、单测 + e2e。
- 结论：只发布 Matcha zh-en；Kokoro/MeloTTS/VITS/zh-baker 均因音质、语言或 RTF 被淘汰。

### Phase 3：打磨（可选）

- 睡眠定时淡出；
- `boundary` 可用时逐词高亮；
- 朗读位置与阅读进度联动；
- 键盘快捷键（不劫持输入框）；
- 模型包自动更新。

## 14. 待确认

1. **安装版 PWA 复测（可选）**：目标浏览器已确认是 Edge Android；第二轮 HTTPS 测试通过。安装版 PWA 与浏览器标签的 TTS 行为可能略有差异，Phase 1 真机验收时顺手确认即可，不再阻塞开工。
2. **本地包版本**：v1.9 只做系统 TTS，还是同版本一起做 Matcha？按当前调研，建议分两版；如果安装版 PWA 实测系统语音仍不可用，则把 Matcha 提前到 v1.9。
3. **模型托管**：`public/models/` 还是独立 `md-reader-models` 仓？默认前者，仓库变大后再拆。
4. **代码块提示**：默认静默跳过，还是每个代码块播报「代码块」？当前默认静默，设置项可开。
5. **睡眠定时默认值**：默认关闭；是否要默认 30 分钟？

## 15. Phase 0 实测结果（2026-10-21）

设备/环境：Android 10、Edge 139（`EdgA/139`）、8 核、浏览器标签（非 standalone）、局域网 HTTP。报告由探针「下载 JSON」导出。

| 项目 | 结果 | 对 Phase 1 的含义 |
|---|---|---|
| 语音列表 | `getVoices()` 始终 0；`localService` 无法判断 | **空列表不等于不可用**；必须用默认语音 `speak()` 试读，不能直接 `no-voice` |
| 首音延迟 | 首句 0.32s；后续句约 10–100ms | 2s 目标安全；不需要复杂预热 |
| 长句 | 148 字一条，29.5s 完成，无 15s 截断 | 分句是为了暂停/高亮，不是为了绕过截断 |
| 3 句队列 | 句间 10–30ms | 预排 2–8 句足够；句级切分不会明显卡顿 |
| 暂停 | 首轮日志：`paused=false`、未触发 `onpause`；**第二轮听感：暂停/继续正常** | 原生 `pause()` 优先；不要依赖 `paused`/`speaking` 属性判断 |
| 取消后立即读 | 首轮：12ms 后 `start`；100ms 版本也正常；**第二轮听感：OK** | 保留 60–100ms 守卫即可，不必强制更长 |
| boundary | 16 字句子，0 次 boundary | 句级高亮；boundary 只做可选增强 |
| 后台/锁屏 | 首轮日志：JS 冻结、队列停住；**第二轮听感：锁屏读完当前句后暂停，亮屏继续** | 页面隐藏 → 当前句播完再暂停；回前台自动继续，失败则提示 |
| 主观 | 3/5，「中文尚可」；`useEffect` 读成 use effect，中间无自然停顿 | 保留系统 TTS；加 camelCase 拆词；Phase 2 重点试听中英混排 |

**结论**：系统 TTS 在目标设备（Edge Android）上可用，Phase 1 继续以系统 TTS 为默认；没有证据需要把本地 Matcha 提前。主要质量缺口是音色与英文术语读法：先用 camelCase 拆词与试听解决，Phase 2 再用 Matcha 做对照。

**两轮测试的差异**：

- 首轮日志里 `pause()` 没改变 `paused`/`speaking`，像是 no-op；第二轮实际听感是「暂停/继续正常」。说明 **Edge 的 pause 是有效的，但状态属性不可信**；Phase 1 以听感 + `onend` 是否提前触发作判定，不能只看属性。
- 首轮「暂停/继续」被重复点击导致两轮测试的 timer 互相干扰；探针已修复为「开始新测试时清空旧 timer」。第二轮不受影响。
- 首轮是 HTTP 局域网、浏览器标签；第二轮是 HTTPS tunnel、Edge Android。目标浏览器就是 Edge，Chrome/安装版 PWA 的复测变为可选，不再是 Phase 1 的门槛。

## 16. Phase 1 实现记录（2026-10-21）

- 分支：`tts-read-aloud`；提交 `0928095 feat(tts): 阅读页系统 TTS 朗读（v1.9 Phase 1）`。
- 结构：`src/tts/{types,segment,voices,system-source,player,prefs,useTts}.ts` + `TtsBar` / `TtsSheet` + `styles/tts.css`。
- 播放：逐句顺序播放（见 §4.3）；`SystemSource` 持有 utterance 引用、3s 启动兜底；`TtsPlayer` 原生 pause 优先、失败回退重播。
- 可见性：隐藏时让当前句播完再暂停；回前台仅在「因可见性暂停」时自动继续。
- 内容：DOM 文本节点按最近块级祖先 + 连续区间分组；跳过代码/表格/mermaid；camelCase/snake_case 拆词。
- 高亮：CSS Custom Highlight（`tts-current`），Range 失效时退回块级 `.tts-current-block`。
- 验收：`npm run typecheck`、`npm test`（56 文件 / 446 测试）、`npx playwright test tests/e2e/tts.spec.ts`、`npm run build` 均通过；真机清单见 §12.3。

## 17. Phase 2 实现记录（2026-10-22）

- 分支：`tts-phase2`。
- 结构：
  - 引擎接口：`SpeechSource`（`src/tts/types.ts`）；`SystemSource` 与 `LocalSource` 双实现；`TtsPlayer` 不再依赖 `speechSynthesis`。
  - 本地引擎：`public/tts/tts-worker.js` 在 Worker 内跑 sherpa-onnx WASM，从 OPFS 把模型文件挂到 MEMFS，再 `createOfflineTts`。
  - 模型存储：`src/tts/{model-manifest,model-store,opfs,tar}.ts`；清单 8 个文件，共约 140MB，全部从 ModelScope CDN 下载；`espeak-ng-data.tar.gz` 用 `DecompressionStream` + `parseTar` 解压。
  - 运行时：`public/tts/runtime/{sherpa-onnx-tts.js,sherpa-onnx-wasm-main-tts.js,sherpa-onnx-wasm-main-tts.wasm}`（13.6MB，Apache-2.0）；`scripts/tts-runtime-setup.mjs` 负责重新生成。
  - UI：TtsSheet 增加「引擎 / 离线语音包」区块；TtsBar 显示「系统语音 / 离线包」。
- 决策：模型只保留 Matcha zh-en；模型文件走 ModelScope CDN，不进主仓；WASM runtime 进主仓并按需缓存。
- 验证：
  - 单元测试：475 通过（含 model-store / tar / manifest / player 双引擎）。
  - e2e：96 通过（新增 `tests/e2e/tts-local.spec.ts` 离线包入口；`TTS_LOCAL_MANUAL=1` 的手动用例真实下载 ModelScope 模型并切本地引擎）。
  - 手动 e2e：ModelScope 下载约 140MB → OPFS → Worker 挂载 → 本地播放、暂停/继续、下一句均通过（桌面 Chromium，18.4s）。
  - 真机验收清单见 §12.4；Edge Android 结果待补。
