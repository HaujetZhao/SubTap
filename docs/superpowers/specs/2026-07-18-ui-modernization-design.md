# UI 现代化重设计 (批次四)

> 日期:2026-07-18 · 主题:把三栏界面从「原生控件 + 灰白纯色」升级为 Notion/Stripe 风的柔和圆润现代界面,并将常驻状态条改为自动消失的 toast。

## 背景与动机

当前 UI 功能完整,但视觉上很「原始」:浏览器原生 checkbox、`#e5e7eb` 冷灰边框、`#fafafa` 中性背景、无圆角无投影,左栏尤其像未完成品。用户希望整体更现代化、更耐看,适合长时间主动点读。

## 设计方向(已对齐)

经视觉协作伴侣并排对比 3 个方向后,选定:

- **视觉风格:B · 柔和圆润(Notion / Stripe 风)**。暖白底、大圆角、柔和投影、药丸式开关与卡片。亲切温和,适合长时间阅读。
- **技术路线:手写现代 CSS**(设计 token + 圆角 + 柔影)。**不引入**任何 CSS 框架或组件库。
  - 理由:构建产物是单文件 `dist/index.html`(`vite-plugin-singlefile` 全内联),且 vocabulary.json 已含 ~34000 词;组件库会全量内联其 CSS+JS,文件显著膨胀,而界面控件很少,属杀鸡用牛刀。Notion 美学本就靠纯 CSS 表达,无现成库开箱提供。
- **色彩模式:仅浅色**。不做深色模式 / 切换开关(YAGNI,留待将来)。

## 视觉规格(设计 token)

集中在 `styles.css` 的 `:root` 定义,便于以后整体微调:

| Token | 值 | 用途 |
|---|---|---|
| `--canvas` | `#fbfaf9` | 中栏画布底(暖白) |
| `--panel` | `#ffffff` | 左/右栏面板底 |
| `--border` | `#f0eee9` | 常规分隔线(暖灰) |
| `--border-strong` | `#e3dfd7` | 输入框/悬停边框 |
| `--ink` | `#3b3934` | 主文字 |
| `--ink-2` | `#6b6862` | 次文字 |
| `--ink-3` | `#9b9a93` | 标签/占位文字 |
| `--accent` | `#5a8c6a` | 主强调色(开关/字幕按钮) |
| `--accent-2` | `#5b8fb9` | 次强调色(音视频按钮/选中句立柱) |
| `--r-sm` / `--r-md` / `--r-lg` | `5px` / `9px` / `14px` | 圆角档位 |
| `--shadow-soft` | `0 2px 6px rgba(60,50,40,.06)` | 轻投影 |
| `--shadow-toast` | `0 8px 24px -6px rgba(60,50,40,.25), 0 2px 6px rgba(60,50,40,.1)` | toast 投影 |

**分级配色** `LEVEL_COLORS`(初中/高中/四级/六级/考研/托福/SAT/超纲)**保持不变**,词背景仍用 `hex + '26'`(~15% 透明)。本批次不改配色逻辑。

## 各栏改动

### 左栏 `SettingsPanel.vue`

**顺序调整(从上到下):**
1. **文件**(原来在最底,现置顶)
2. **词库分级**
3. **字幕微调**

**文件区:**
- 两个按钮文字改为 **「打开字幕」「打开音/视频」**。
- 改为**主色实心按钮**:「打开字幕」用 `--accent`(绿),「打开音/视频」用 `--accent-2`(蓝),白字、圆角、轻投影,突出「入口」地位。`<input type="file">` 仍隐藏在 label 内,交互不变。

**词库分级:**
- 每个级别从「裸 checkbox + 圆点 + 文字」改为**药丸行**:整行 `--r-md` 圆角、`#f7f5f1` 底、悬停加深;圆点保留;右侧加**药丸式开关**(开=`--accent` 实心、关=灰)替代原生 checkbox。
- 实现仍用 `<input type="checkbox">`(隐藏,可访问性 + 现有事件不变),药丸开关是 `::before/::after` 或配套 span 的纯 CSS 表现,`@change` 事件保持不变。
- 「用背景色突出单词」开关挪到分级列表下方,沿用同样的开关样式。

**字幕微调:**
- 数字输入框(`offset` / `extend` / `linkNextOffset`)圆角化、暖灰边框、右对齐。
- 「句末连接(播到下一句开头)」**沿用现有 `linkNext` 开关**(功能本就存在),改为同样的药丸开关样式;其「句末连接偏移(秒)」在 `linkNext=false` 时隐藏(现有 `v-show` 行为保留)。

> 注:`SettingsPanel.vue` 仅改 template 结构顺序 + class,以及样式;**不改 emit/props 契约**,App 侧零改动。

### 中栏 `SentenceList.vue`(纯样式)

- 句子项圆角卡片化(`--r-md`),悬停 `#f3efe8`。
- **选中句**:`#eef4f8` 浅蓝底 + **左侧 3px `--accent-2` 立柱**(`box-shadow: inset 3px 0 0`)。
- 词高亮 span 圆角底色(`--r-sm`),逻辑(`tokStyle` + `LEVEL_COLORS+'26'`)不变。
- **移除右下角常驻 `.status` 状态条**(改用 toast)。
- 播放图标 / 时间戳配色随 token 微调。

### 右栏 `WordPanel.vue`(纯样式)

- 每个单词包成圆角卡片(`--r-md`、`#f7f5f1` 底)。
- 分级标题用 `LEVEL_COLORS` 着色(沿用 `titleColor`),右侧带数量小药丸(底色=级别色)。
- 占位文案(未选句 / 未勾选 / 无命中)配色用 `--ink-3`。

## Toast 系统(新增)

替换现有 `statusText` / `statusError` 的常驻状态条。

**行为:**
- 底部居中浮层,圆角 `--r-lg`、`--shadow-toast`、半透明白底(`rgba(255,255,255,.96)`)。
- **所有 toast(成功/错误)均 2.5 秒自动淡出**;淡出前底部有一条**进度条**倒数。
- 错误 toast 字色偏红(`#9a2b2b`)+ 红色图标圈;成功 toast 默认墨色 + 绿色 ✓ 圈。点击 toast(或右侧 ×)可**立即关闭**。
- **鼠标悬停暂停倒计时**,移开恢复(避免没看清)。
- 入场动画:从下 12px 上浮 + 淡入,~0.35s。

**状态:**
- `App.vue` 新增 `const toasts = reactive([])`,每项 `{ id, message, type }`。
- 新增 `notify(message, type = 'success')`:push 一条、设置 2500ms 定时器删除;hover 时清定时器、离开重建(剩余时间可简化为重置 2500ms)。
- 移除 `statusText` / `statusError` 两个 ref 及模板里的 `<span class="status">`。
- 所有原赋值点改为 `notify(...)`:
  - `onSrtFile` 成功 → `notify('已载入 N 句字幕', 'success')`;失败 → `notify('字幕解析失败:…', 'error')`。
  - `onMediaFile` 成功 → `notify('已载入:文件名', 'success')`。
  - `playSentence` 无媒体 → `notify('请先选择音/视频文件', 'error')`。
  - `<video>` error 事件 → `notify('音/视频无法播放(编码不支持),建议改用 mp4/mp3', 'error')`。

**渲染:** 在 `App.vue` 模板末尾加 `.toast-container`(fixed、bottom 居中、flex 列),遍历 `toasts` 渲染。进度条用 CSS 动画(`@keyframes` 缩放宽度 2.5s 线性)。hover 暂停用 `@mouseenter/@mouseleave` 控制 JS 定时器(CSS 动画随之 `animation-play-state: paused` 联动)。

> 不抽独立组件:toast 状态、定时器与渲染强耦合,放 App.vue 内(约 30 行)最直接,避免 prop/emit 往返。如实现时发现 App.vue 过臃肿,再抽 `components/ToastHost.vue`(接收 toasts、内部管定时器)。

## 不改动

- 纯逻辑层(`srt-parser` / `word-lookup` / `lemmatize` / `vocab-store` / `player` / `subtitle-tweak` / `level-colors`)完全不动。
- `vocab-store` 响应式镜像不变量、`renderedSentences` 缓存不变量、键盘播放控制、按需滚动、音视频收展逻辑——均不受影响。
- 分级配色 `LEVEL_COLORS` 不变。

## 验收

- `npm run build` 通过,`dist/index.html` 仍为可用单文件。
- 浏览器手动验收:三栏视觉符合 mockup;药丸开关勾选驱动中栏高亮 + 右栏显隐(回归不变量);文件按钮可载入字幕/音视频并弹 toast;字幕微调(含句末连接)生效;选中句左侧立柱;toast 2.5 秒消失、hover 暂停、错误也自动消失。
- 回归:键盘 ↑↓←→ 与空格播放控制、视频收展拖拽。
