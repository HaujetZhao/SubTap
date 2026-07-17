# 设计：词形还原（Lemmatize）查词

> 日期：2026-07-17
> 分支：feature/srt-audio-player
> 目标：让屈折变形（raises / running / studies / went 等）还原回原形后再查词库，避免被误归"超纲"。

## 背景与问题

当前 `word-lookup.js` 用 token 小写后直接查 `vocab` 大表。词库收录的是**原形**（raise / run / study / go），所以文中出现的变形（raises、running、studies、went）查不到 → 被误判为"超纲词"，丢失分级与释义。

`分级单词提取.py` 已实现成熟的 `lemmatize()`：不规则动词表（约 150 条）+ 后缀规则（-s/-es/-ed/-ing/-er/-est/-ly，含双写辅音分支），候选按长度降序以避免 `coding→cod(鳕鱼)` 抢先于 `code`。本设计把这套逻辑移植成 JS 纯逻辑模块。

## 目标

1. 变形还原后命中词库 → 按原形的级别高亮、显示原形释义。
2. 右栏命中词显示**原形**（如 `raise`），同原形的多个变形合并为一条。
3. 中栏 token 仍显示原文（`raises`），仅背景色按还原后级别着色。
4. 还原后仍未命中的词才归"超纲"，显示文中形式。
5. 纯逻辑层保持无 Vue/DOM 依赖、可独立单测。

## 非目标（YAGNI）

- 不移植 Python 里的**缩约形式**还原（`don't→do`、`she's→she`）。代词/助动词缩约不在分级词库目标里，命中概率极低。
- 不做 `buildVocab` 构建期反向展开（成本高、不规则动词无法靠后缀反推）。

## 方案：方案 A —— 独立模块 + 查询时按需还原

### 1. 新模块 `src/lemmatize.js`

纯 ES module，无依赖。导出：

```js
export function lemmatize(word) // -> string[]，候选原形，不含 word 自身，按长度降序
```

内部：
- 常量 `IRREGULAR_VERBS`（约 150 条，从 Python 1:1 搬运）。
- 常量 `LEMMATIZE_RULES`：`[suffix, repl]`，`repl` 为 `'' | 'e' | 'y' | 'ie' | null`（`null` = 双写辅音分支，运行时再去一个末字母）。
- **只处理纯字母词**：`/[^a-z]/` 命中（含撇号）直接返回 `[]`。
- 生成候选后：去重、过滤 `len>=2`、按长度降序排序。

### 2. 统一 helper（`word-lookup.js` 内部）

```js
import { lemmatize } from './lemmatize.js';

function resolve(tok, vocab) {
  // 返回 { level, lemma } 或 null
  const direct = vocab[tok];
  if (direct) return { level: direct.level, lemma: tok };
  for (const cand of lemmatize(tok)) {
    const e = vocab[cand];
    if (e) return { level: e.level, lemma: cand };
  }
  return null;
}
```

### 3. `Word` 结构

新增 `lemma` 字段（命中原形；直接命中时 `lemma === tok`）：

```ts
{ word: string, level: string, def: string, lemma: string }
```

### 4. 三个函数改动

| 函数 | 改动 |
|------|------|
| `lookupWords(text, vocab)` | 用 `resolve`；命中 → `{word:tok, level, def, lemma}`；未命中（含还原失败）不返回 |
| `tokenizeForRender(text, vocab)` | 用 `resolve` 取命中级别；`resolve` 返回 null → `level='超纲'`；`text` 仍显示原文 token |
| `classifyWords(text, vocab)` | 去重 key 从 `tok` 改为 **`lemma`**：命中项显示 `lemma`、释义取原形；同原形多个变形合并一条；超纲项去重 key 用 `tok`、显示文中形式、`def=''` |

`vocab-store.js` 接口不变，**不动**。

### 5. UI 层体现

- **中栏**（`SentenceList.vue`）：渲染逻辑不变（`tokenizeForRender` 返回的 `level` 已是还原后级别），背景色自动跟着原形级别。
- **右栏**（`WordPanel.vue`）：命中项的显示字段从 `word` 切到 `lemma`。
- 顺序：按文中首次出现（首次遇到某原形时登记）。

### 6. 边界与不变量

- 含撇号 token（`don't`）：`lemmatize` 返回 `[]` → 不还原 → 原样查表 → 通常未命中归超纲，显示原文。不崩溃。
- 纯超纲生僻词：还原后仍查不到 → 归"超纲"，显示文中形式。
- 直接命中的词（如 `state` 本身在词库）：不触发还原，`lemma===tok`。
- 纯逻辑层无 Vue/DOM 依赖。

## 测试计划（追加到 `test.html`）

- `lemmatize('raises')` 含 `'raise'`
- `lemmatize('running')` 含 `'run'`（双写辅音分支）
- `lemmatize('studies')` 含 `'study'`（-ies→-y）
- `lemmatize('went')` 含 `'go'`（不规则动词表）
- `lemmatize('happily')` 含 `'happy'`（-ily→-y）
- `lemmatize("don't")` 返回 `[]`（撇号不处理）
- `classifyWords` 对含 `raises` 的句子 → 命中 `raise` 所在级、`word === 'raise'`
- `raises` 与 `raising` 同句 → 右栏合并为一条 `raise`
- 含撇号词不崩；纯超纲生僻词仍归超纲

## 风险

- **过度还原误命中**：靠"候选长度降序"缓解（`coding→code` 优先于 `cod`）。残留误命中概率低，且分级用途容错。
- **性能**：每句 token 少，每词生成约 10 候选、查表 O(1)，无影响。

## 涉及文件

- 新增：`src/lemmatize.js`
- 改：`src/word-lookup.js`（helper + 三函数）
- 改：`src/components/WordPanel.vue`（显示字段 `word`→`lemma`）
- 改：`test.html`（追加断言）
