---
name: md-reader
description: 中文移动阅读器——暖白纸面、软影分组卡、浅蓝 #1F3FD4 强调、底部工具条（微信读书一脉）
colors:
  page: "#FAF9F6"
  shell: "#F0EFEA"
  card: "#FFFFFF"
  ink: "#17181A"
  ink-secondary: "#5C6066"
  line: "#E4E1DA"
  accent-graphic: "#1F3FD4"
  accent-text: "#1F3FD4"
  accent-fill: "#1F3FD4"
  highlight-yellow: "#FFF1A8"
  highlight-red: "#FFD9D4"
  danger: "#C0392B"
typography:
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'PingFang SC', 'Noto Sans SC', 'Source Han Sans SC', 'Microsoft YaHei', sans-serif"
    fontSize: "17px"
    fontWeight: 400
    lineHeight: 1.9
  code:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
    fontSize: "13px"
    lineHeight: 1.6
  card-group-label:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'PingFang SC', 'Noto Sans SC', 'Source Han Sans SC', 'Microsoft YaHei', sans-serif"
    fontSize: "12.5px"
    fontWeight: 500
    letterSpacing: "0.04em"
rounded:
  card: "14px"
  ctl: "10px"
  pill: "22px"
spacing:
  page-gutter: "16px"
  card-padding: "16px"
  section-gap: "18px"
components:
  button-primary:
    backgroundColor: "{colors.accent-fill}"
    textColor: "#FFFFFF"
    rounded: "{rounded.ctl}"
    padding: "0 14px"
    height: "36px"
  button-ghost:
    backgroundColor: "{colors.shell}"
    textColor: "{colors.ink}"
    rounded: "{rounded.ctl}"
    padding: "0 14px"
    height: "36px"
  button-danger:
    backgroundColor: "transparent"
    textColor: "{colors.danger}"
    rounded: "{rounded.ctl}"
    padding: "0 14px"
    height: "36px"
  input:
    backgroundColor: "{colors.card}"
    textColor: "{colors.ink}"
    rounded: "{rounded.ctl}"
    padding: "0 10px"
    height: "40px"
  card-grouped:
    backgroundColor: "{colors.card}"
    rounded: "{rounded.card}"
    padding: "6px 16px 16px"
  chip-pill:
    backgroundColor: "{colors.ink}"
    textColor: "#FFFFFF"
    rounded: "{rounded.pill}"
    padding: "9px 16px"
---

# Design System: md-reader

## Overview

**Creative North Star: "中文阅读器"（微信读书一脉的移动阅读手感）**

md-reader 是一个把 GitHub 仓库当书读的移动端 PWA。本次样式焕新把全站从「把 Markdown 当网页文档打印」的线框默认，带进一个成熟的中文移动阅读器世界：暖白纸面（#FAF9F6）承载正文，暖灰壳底（#F0EFEA）承载结构，白卡以单层软影浮起，浅蓝 #1F3FD4 一色贯穿图形、文字与填充三档角色。密度上「组内紧、组间宽」——卡内行距 12–13px、组间距 18px，标题上间距大于下间距；图标按钮 ≥44px、表单按钮 ≥36px。

**浅色定案，由使用场景决定**：本世界的样张（样张⑤）为浅色世界，且目标场景是「夜间躺读」——被窝里单手翻书，屏幕是一页纸而不是一块黑玻璃；暖白纸面在夜间低亮度下比纯黑更接近真实书页的观感，也与系统中文衬线/无衬线字体的渲染习惯一致。暗色模式**明确不做**（spec §7 非目标），不是「以后再说」，是本次设计决策的一部分。

**Key Characteristics:**
- 单层海拔：卡片 = 圆角 14 + 软影，**不叠边框**；行与行之间只用 1px 分隔线
- 一色三档：#1F3FD4 同值分名（图形/文字/填充），保留角色语义以便日后分档
- 阅读页 chrome 极简：48px 顶栏（返回 · 标题 · ⋯）+ 底部五项工具条 + 续读胶囊
- 设置页 iOS 式分组卡：组标签在上、软影白卡承载行
- 深色只出现在两处：代码块 #1B1D21 与深墨胶囊（toast / 续读），作为纸面上的「墨块」

## Colors

调板策略：暖白纸面 + 暖灰壳底 + 一个浅蓝强调色。强调蓝极度节制——一屏之内只出现在进度、选中、链接、主按钮上；其稀有性就是它的力量。

以下令牌表为规范值（spec §2.1 逐字；同值定义于 `src/styles/base.css` 的 `:root`，为唯一事实源）：

| Token | 值 | 用途 |
| --- | --- | --- |
| `--page` | `#FAF9F6` | 阅读纸面 |
| `--shell` | `#F0EFEA` | 壳底（首页/设置/顶栏） |
| `--card` | `#FFFFFF` | 分组卡、面板 |
| `--ink` | `#17181A` | 主文字 |
| `--ink2` | `#5C6066` | 次文字（≥4.5:1 已核） |
| `--line` | `#E4E1DA` | 分隔线、描边 |
| `--acc` | `#1F3FD4`（浅蓝·图形） | 强调图形：进度、开关、Radio/Checkbox、焦点环（对白 ≥3:1 已核） |
| `--acc-text` | `#1F3FD4`（浅蓝·文字） | 强调文字/链接/百分比（纸面 7.3:1 已核） |
| `--acc-fill` | `#1F3FD4`（浅蓝·填充） | 实心按钮、选中底（白字 7.7:1 已核） |
| `--hl-yellow` | `#FFF1A8` | 持久高亮·黄 与 `==高亮==` |
| `--hl-red` | `#FFD9D4` | 持久高亮·红 |
| 搜索命中 | `rgba(31,63,212,.16)` + 1px `--acc` 下划线 | 与持久高亮区分 |
| `--danger` | `#C0392B` | 错误、危险区 |

### Primary
- **阅读器浅蓝** (#1F3FD4)：唯一强调色。进度条/蓝点、树中当前项底、Radio/Slider（`accent-color`）、主按钮实心填充、链接与百分比文字、焦点环、搜索命中染底。三档同值（`--acc` / `--acc-text` / `--acc-fill`），分名保留角色语义，便于日后分档调优；**新增强调色不得占用 `--acc`**（未来仓库标识色走独立变量，spec §5）。

### Neutral
- **纸面** (#FAF9F6)：阅读正文底、底部工具条毛玻璃底 `rgba(250,249,246,.96)`。
- **壳** (#F0EFEA)：首页/设置底、吸顶栏毛玻璃底 `rgba(240,239,234,.96)`、抽屉面板底、hover 微亮底。
- **白卡** (#FFFFFF)：分组卡、弹层、菜单、同步徽标、输入框。
- **墨** (#17181A) 与 **次墨** (#5C6066)：正文/次级文字；墨还用作深胶囊（toast、续读胶囊）底色。
- **线** (#E4E1DA)：卡内行分隔、卡片外围描边态、输入框描边、滚动条滑块。

### 语义色（保留现义）
- 状态点：idle `#8b949e`（白卡 3.1:1）、离线橙 `#b87200`（壳 3.35:1 / 白卡 3.9:1）、错误 `#d1242f`（5.2:1）；同步中为 `--acc` 旋转环。
- 危险/错误文字与危险区按钮 = `--danger` #C0392B。

### Named Rules
**The Single Elevation Rule.** 卡片只声明一次海拔：圆角 14 + `--shadow-card` 软影，**禁止再叠边框**；行间只用 1px `--line`。
**The One-Blue Rule.** 强调蓝只有一个值 #1F3FD4。搜索命中用它的 16% 染底 + 下划线表达「临时命中」，与持久高亮（黄/红实底）区分；不得引入第二个蓝。
**The Browser-Surface Rule.** 文本选区 `rgba(31,63,212,.22)`、光标、滚动条、`:focus-visible` 焦点环一律从令牌取色，浏览器表面不得出现未主题化的默认蓝。

## Typography

**Display/Body Font:** 系统中文无衬线栈 `-apple-system, BlinkMacSystemFont, "PingFang SC", "Noto Sans SC", "Source Han Sans SC", "Microsoft YaHei", sans-serif`（`--font-sans`）
**Selectable Stacks:** v1.1 三档可选字体（系统默认 / LXGW Neo XiHei Screen / Noto Serif SC），经 `--r-font-family` 由「阅读外观」设置注入
**Mono Font:** `ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`（`--font-mono`；代码块字号 = 正文字号 × 0.765，不随字体选择变化）

**Character:** 不用展示字体、不玩字距——排版的全部个性交给「中文正文的呼吸感」：17px 正文、宽行距、紧行内距。

### Hierarchy
- **页标题**（700, 24px, 默认行高）：设置页 `设置`；首页标题（700, 20px, letter-spacing 0.06em）。
- **文档标题**（600, 16px）：阅读页吸顶栏单行截断标题。
- **Markdown 正文**（400, `--r-font-size` 默认 17px, line-height 1.9）：`.doc-content`；h1–h4 行高 1.4、h1/h2 带 1px 下划线。
- **数字**：全站 `font-variant-numeric: tabular-nums`（在 `body` 声明并继承，列表计数、百分比、元信息一律等宽对齐；CJK 不受影响）。
- **卡组标签**（500, 12.5–13px, letter-spacing 0.04em, `--ink2`）：设置九区块标签、首页分组标签（「篇数」等计数沿用同一灰）。
- **行内标签**（400, 11–14px）：底部工具条项 11px、树徽标 11px、toast 13–14px。
- **代码**（mono, 0.765× 正文, line-height 1.6）。

### Named Rules
**The No-Display-Face Rule.** 系统栈是唯一正文面孔；内置的 LXGW / Noto Serif SC 只作为用户可选档位存在，不得用作界面标题的装饰面孔。

## Layout

移动优先，单列居中，两侧 16px 页槽（`--page-gutter`）；内容列上限 46rem（阅读页）/ 640px（首页、搜索、设置）。触控目标一律 ≥44×44px。

### 首页（壳子）
52px 顶栏：「知识库」标题（20/700、微字距）**真居中**，右侧 ⚙ 44px 图标以绝对定位固定右缘、直达设置（样张的左 ☰ 无对应功能，不保留——诚实适配）。其下灰底搜索胶囊行（#e8e6e0，圆角 10，44px）；「继续阅读」区 = 组标签 + 软影卡（首行内嵌 3px 进度条：`--line` 轨 + `--acc` 填充）；文件树为分组卡列表（行：标题 + 状态/chevron，未缓存/陈旧行文字退 `--ink2`）；同步徽标为搜索同排/组标签行末端的白卡小控件簇。收藏区与继续阅读共用卡皮。

### 阅读页
吸顶 48px 变量高导航（`--header-h`；返回 · 标题 · ⋯）：毛玻璃壳底 + 1px 底线；⋯ 弹层 = 白卡圆角 12 + 软影（文件 / 横屏 / 旋转）。正文纸面，底部预留 108px + 安全区防遮挡。固定底部工具条五项（目录 / 搜索 / Aa / 收藏 / 设置）：56px + 安全区、毛玻璃纸面底、顶线；Aa 直接跳设置「阅读外观」，不新增浮层。「回到上次位置」胶囊：深墨底白字 + `--acc` 蓝点，悬浮于工具条上方 72px 处，仅当存在已保存进度且 > 首屏时出现（点击跳转，替代 v1.0 的打开即自动落位）。目录/文件树共用底部抽屉：壳底、顶圆角 16、遮罩 `rgba(23,24,26,.44)`。

### 设置
640px 列。返回链接（`--acc-text` 14px）+ 大标题 24px。九个区块（访问 Token / 仓库配置 / 同步 / 存储 / 阅读外观 / 高亮数据 / 显示方向 / 危险区 / 关于）全部为 iOS 式分组卡：组标签在上、软影白卡承载行，顺序与文案不变。表单输入 40px 高、16px 字号（iOS 聚焦不缩放）。

## Elevation & Depth

混合策略：**结构永远单层**（卡片软影一次声明，`--shadow-card: 0 6px 18px rgba(40, 44, 52, .10)`），**深墨元素允许更强的落地影**（它们是纸面上悬浮的实物）。遮罩层用 ink 半透明，不用 blur 玻璃拟态（毛玻璃只给两条 chrome 带）。

### Shadow Vocabulary
- **Card**（`--shadow-card`: `0 6px 18px rgba(40,44,52,.10)`）：分组卡、弹层、菜单、同步徽标——一切白卡。
- **Lifted ink**（`0 8px 20px rgba(23,24,26,.32)`）：深墨胶囊（toast、续读胶囊），影更强、更近，表达「浮在纸面上方」。
- **Drawer up**（`0 -8px 24px rgba(23,24,26,.24)`）：底部抽屉向上的影。
- **Scrim**（`rgba(23,24,26,.44)`）：抽屉遮罩，纯色不用 blur。

### Named Rules
**The Flat-By-Default Rule.** 静止态没有阴影的东西不许浮起：有影必须是卡/弹层/深墨胶囊三者之一；hover 不加影、不加位移，只换底色。

## Shapes

三档圆角构成全部形态语言：**卡 14**（`--r-card`：分组卡、区块卡）、**控件 10**（`--r-ctl`：按钮、输入、搜索胶囊、徽标、代码块/图片/mermaid）、**药丸 22**（`--r-pill`：只给小控件——toast、续读胶囊、树徽标、相关文档 chip）。例外值只留三处且各有归属：弹层/菜单 12、抽屉顶 16、行内小件 6–8（菜单行、代码复制按钮、上下篇卡）。边框默认消失——需要边界时用 1px `--line`，不用深色描边。

## Components

按钮与控件是「安静的承载者」：形状克制、状态靠底色切换、浅蓝只给主操作。

### Buttons
- **Shape:** 圆角 10（`--r-ctl`），最小高度 36px（设置内）/ 44px（状态页主操作、同步刷新）。
- **Primary:** 实心浅蓝 `--acc-fill` + 白字（7.7:1）；hover 暗 20%（#1932aa）。用于：表单提交、同步刷新、状态页主操作。
- **Ghost:** 壳底 + 墨字（行内工具按钮：更换 Token、立即同步、导出/导入）；hover 退到 `--line`。
- **Danger:** 透明底 + `--danger` 文字与 1px 描边；hover `rgba(192,57,43,.07)`。只用于危险区。
- **Text link button:** `--acc-text` 文字（返回、搜索取消、设置返回）。

### Chips（墨胶囊与徽章）
- **Toast:** 深墨 `--ink` 底白字药丸（圆角 22），固定底部居中可叠放，44px 高、14px 字，`0 8px 20px rgba(23,24,26,.32)` 影，0.18s 上浮入场（`prefers-reduced-motion` 关闭）；错误态 = `--danger` 底白字。
- **续读胶囊:** 同族深墨药丸（13px），前置 7px `--acc` 蓝点；语义 =「上次读到 N%」。
- **树徽标 / 相关文档 chip:** 壳底/白底描边小药丸，11–13px，`--ink2`。

### Cards / Containers
- **Corner Style:** 14（`--r-card`）。
- **Background:** `--card` 白；所在表面为 `--shell`（首页/设置）或 `--page`（阅读页附属）。
- **Shadow Strategy:** 单层 `--shadow-card`，不叠边框。
- **Border:** 卡内行之间 1px `--line`（`:last-child` 去线）。
- **Internal Padding:** 6px 16px 16px（设置区块）；行高 ≥44px、左右 12px。

### Inputs / Fields
- **Style:** 1px `--line` 描边 + 白底 + 圆角 10、40px 高、16px 字号（防 iOS 聚焦缩放）；Token 输入为掩码 mono 小件（壳底、圆角 10）。
- **Focus:** `body :focus-visible` 全局 2px `--acc` 焦点环 + 2px offset（浅蓝对纸面/壳/白卡均 ≥3:1）。
- **Disabled:** 文字/边框退到 `#8b949e`（对白 ≈3:1）——禁用态按 WCAG 1.4.3 不参与对比度强制要求，作为明确的「不可用」信号保留弱化；同步刷新禁用为 `opacity: .55`。

### Navigation（阅读页 chrome）
- **顶栏:** 48px 变量高（`--header-h`）吸顶，毛玻璃壳底 `rgba(240,239,234,.96)` + blur 8，1px `--line` 底线；返回/按钮 44×44 圆角 8，按下吃壳底色；标题 16/600 单行截断居中。
- **底部工具条:** 固定 56px + `env(safe-area-inset-bottom)`，毛玻璃纸面 `rgba(250,249,246,.96)` + blur 8，顶线 1px `--line`；五项均 ≥56×44，图标 + 11px 标签，默认 `--ink2`，hover/选中 `--acc-text`；Aa 项为 17/700 墨字。
- **弹层与菜单:** ⋯ 菜单与右键/长按菜单同族——白卡圆角 12 + `--shadow-card` + 6px 内衬；行 15px、圆角 8，hover/焦点壳底；**每张菜单的首项（主操作）用 `--acc-text` + 600**（复制/清除高亮/全选各分支同规则）。
- **抽屉:** 壳底面板、顶圆角 16、上翻影、60vh 上限；内部滚动区带安全区 padding；动画 0.16s 淡入 / 0.2s 上滑（`no-preference` 才播）。

### Code Block（签名细节）
纸面上唯一的深色平面：`#1B1D21` 底 + `#E9EBEF` 文字（14.1:1），圆角 10，右上角白底小「复制」按钮。语法高亮全套为深底校准（注释 5.5:1、关键字 8.1:1、字符串 11.3:1、数字/符号 6.7:1、标题 6.7:1、类型 9.5:1、属性/变量 11.0:1、删除 6.7:1）。

### Highlights & Search Hits
- 持久高亮 = `--hl-yellow` / `--hl-red` 实底（数据 token 映射到变量，改色不动数据）；`==高亮==` 与黄同值。
- 搜索命中 = `rgba(31,63,212,.16)` 染底 + `--acc` 1px 下划线（offset 2）——临时命中与持久高亮一眼可分。

## Do's and Don'ts

### Do:
- **Do** 新表面一律用令牌表取色；选区、光标、滚动条、焦点环保持主题化（craft floor）。
- **Do** 卡片 = 圆角 14 + 单层软影，行间 1px `--line`；组内行距紧（12–13px）、组间距宽（≥18px）。
- **Do** 主操作用实心浅蓝（`--acc-fill` 白字），次操作用壳底幽灵，危险用 `--danger` 红字描边；触控目标 ≥44px。
- **Do** 深墨胶囊（toast/续读）保持同族：`--ink` 底、白字、药丸 22、`0 8px 20px rgba(23,24,26,.32)` 影。
- **Do** hover 只在 `@media (hover: hover)` 下生效，且只换底色（壳/线/暗 20%），不位移不加影。
- **Do** 输入框 16px 字号起步（iOS 聚焦防缩放），表单按钮 ≥36px、图标按钮 44px。

### Don't:
- **Don't** 在软影卡上再叠边框，或用深色描边分隔区块——分隔靠 `--line`，边界靠影。
- **Don't** 引入第二个强调蓝或占用 `--acc` 做非强调用途；搜索命中不许改用黄/红实底（会与持久高亮混淆）。
- **Don't** 用 emoji 当图标；图标一律手绘单线宽 SVG。
- **Don't** 用展示字体/大写英文/kicker 标签做区块标题；卡组标签只用 12.5–13px 灰字。
- **Don't** 在卡内用「同尺寸卡片网格」搭页面结构；卡是行的容器，不是布局积木。
- **Don't** 给禁用态做出「还能点」的样子（弱化即可），也不要把禁用态当装饰弱化用在可点元素上。

> 未纳入系统（建成态携带的旧账，不是可继承的规则）：markdown 家具（引用/表格/上下篇/相关文档 chip）与搜索页仍残留 v1.0 的 GitHub 灰阶（`#f6f8fa`/`#d0d7de`/`#d8dee4`/`#57606a`/`#8b949e`）与旧别名 `--c-*`；目录 scroll-spy 当前项底仍为旧蓝 `rgba(31,111,235,.08)`；首页搜索胶囊底 `#e8e6e0`（hover `#dedcd5`）是未入令牌的字面量。以上为待清偿项（已留终审分诊），新表面不得沿用。
