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

- 不做 `buildVocab` 构建期反向展开（成本高、不规则动词无法靠后缀反推）。

> **迭代追加（2026-07-18）：** 初版按 YAGNI 未移植缩约形式，导致 JS 超纲（98）比 Python（70）多出 28 个（21 缩约 + 6 单字母 + 1 所有格）。已补齐：
> - **缩约还原**（`don't→do`、`can't→can`、`it's→it`、`let's→let`…）：否定缩约走 `NEG_CONTRACTIONS` 完整映射，代词/指示词缩约走 `PRO_BASES` base 命中。
> - **撇号所有格**（`letters'→letters→letter`、`robot's→robot`）：取撇号前 base，再对 base 走一遍还原。比 Python 更彻底（Python 对所有格返回空→归超纲，JS 能命中原形）。
> - **单字母过滤**（`s/n/p/o/h/b`）：`word-lookup.js` 三函数跳过 `len<2` 的 token，不进超纲、中栏不着色。
>
> 补齐后实测 SRT 超纲降至 **65**（比 Python 70 还少 5，差额即 JS 额外正确还原的 5 个名词所有格 `robot's/student's/receiver's/symbol's/bar's`）。
>
> **迭代追加二（2026-07-18）：** 处理"-ing 复数 / 副词 / 比较级 / 最高级 / 不规则过去式"五类未还原词（用户举例 `encodings/inexorably/heard/surprisingly/easiest`）：
> - **双层还原**：`resolve` 对第一层候选未命中时，再对候选走一遍 `lemmatize`（`encodings→encoding→encode`、`surprisingly→surprising→surprise`）。
> - **补后缀规则**：`('iest','y')` 最高级、`('ier','y')` 比较级、`('ably','able')`/`('ibly','ible')` 副词、`('er',null)` 双写比较级（bigger→big）。
> - **补不规则动词**：`heard→hear`。
> - 经验证 `carrier/soldier/barrier/teacher` 等 -er/-ier 名词均直接命中词库（不走还原），故 `('ier','y')` 无误伤风险。
>
> 实测 SRT 超纲再降至 **58**。

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

### 3. `Word` 结构（不新增字段）

复用现有 `{ word, level, def }`。约定：**命中项的 `word` 字段直接存"原形"**（如 `raise`），不再存原文 token。这样 `WordPanel`（显示 `w.word`）零改动即可显示原形。超纲项 `word` 仍存文中形式。YAGNI——不引入冗余的 `lemma` 字段。

### 4. 三个函数改动

| 函数 | 改动 |
|------|------|
| `lookupWords(text, vocab)` | 用 `resolve`；命中 → `{word:lemma, level, def}`（按 `lemma` 去重）；未命中（含还原失败）不返回 |
| `tokenizeForRender(text, vocab)` | 用 `resolve` 取命中级别；`resolve` 返回 null → `level='超纲'`；`text` 仍显示原文 token |
| `classifyWords(text, vocab)` | 命中去重 key 从 `tok` 改为 **原形（lemma）**：命中项 `word=lemma`、释义取原形；同原形多个变形合并一条；超纲项去重 key 用 `tok`、`word=tok`、`def=''` |

`vocab-store.js` 接口不变，**不动**。

### 5. UI 层体现

- **中栏**（`SentenceList.vue`）：渲染逻辑不变（`tokenizeForRender` 返回的 `level` 已是还原后级别），背景色自动跟着原形级别。
- **右栏**（`WordPanel.vue`）：**零改动**——命中项 `word` 已是原形，现有 `w.word` 显示即为原形。
- 顺序：按文中首次出现（首次遇到某原形时登记）。

### 6. 边界与不变量

- 含撇号 token（`don't`）：`lemmatize` 返回 `[]` → 不还原 → 原样查表 → 通常未命中归超纲，显示原文。不崩溃。
- 纯超纲生僻词：还原后仍查不到 → 归"超纲"，显示文中形式。
- 直接命中的词（如 `state` 本身在词库）：不触发还原，`word===tok`。
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
- 改：`test.html`（追加断言；`WordPanel.vue` 无需改动）
