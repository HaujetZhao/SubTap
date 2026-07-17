# -*- coding: utf-8 -*-
"""
分级单词提取脚本
=================
读取一个英文文本（如视频转录），将其中的单词按难度等级（初中/高中/四级/六级/考研/托福/SAT）
归类，输出为 Markdown 文件，每个等级一个两列表格（左列单词，右列释义）。

归类规则：每个单词只归入它所属的【最低】难度等级（基础词优先吸收），不重复。
未被任何等级词表收录的词归入"超纲/未收录词"区块，便于发现新词。

用法（PowerShell）：
    python "分级单词提取.py"                          # 处理当前目录下默认示例文本
    python "分级单词提取.py" "某个视频转录.txt"        # 处理指定文本
    python "分级单词提取.py" "输入.txt" "输出.md"      # 同时指定输入和输出
"""


import json
import os
import re
import sys

# ═════════════════════════════════════════════════════════════
#                          【用户配置区】
#
#   词库数据来源：根目录下的 vocabulary.json（由 merge_vocab_lite.py 从
#   各分级 txt 合并而成），结构为 {等级名: {单词(小写): 释义}}。
#
#   每个等级第二列 True/False 控制是否输出该等级区块：
#     True  = 正常输出该等级的单词表
#     False = 不输出该等级；其单词也不会被归入"超纲/未收录词"
#             （相当于这些词被视为"已掌握"，从结果中完全隐去）
#
#   顺序即难度由低到高（决定"归入最低等级"的去重优先级），请勿打乱。
#   直接修改下面的 True/False 即可，无需改动其它代码。
LEVELS = [
    ("初中", False),
    ("高中", True),
    ("四级", True),
    ("六级", True),
    ("考研", True),
    ("托福", True),
    ("SAT",  True),
]
# ═════════════════════════════════════════════════════════════





# 词形还原后缀规则（按优先级排列）：(后缀, 替换为)
# 用于把文本中的屈折变形（-s/-es/-ed/-ing/-er/-est 等）还原回原形再匹配词表。
# 设计为"试所有候选，命中即用"，所以宁可多生成几个候选词。
LEMMATIZE_RULES = [
    # -ies / -ied -> -y   如 studies -> study, applied->apply
    ("ies", "y"),
    ("ied", "y"),
    # -ying -> -ie / -y   如 dying -> die
    ("ying", "ie"),
    ("ying", "y"),
    # -ing 去掉：encoding -> encode(补e) / running -> run(去双写)
    ("ing", ""),   # 直接去 -ing
    ("ing", "e"),  # 去掉 -ing 补回 e：encod(ing) -> encode
    ("ing", None),  # 特殊：双写末辅音，如 running -> run（运行时再去一个字母）
    # -ed 去掉：encoded -> encode / stopped -> stop
    ("ed", ""),
    ("ed", "e"),
    ("ed", None),  # 双写：stopped -> stop
    # -es / -s 去掉：boxes -> box / makes -> make / cats -> cat
    ("es", ""),
    ("es", "e"),  # likes -> like？通常 -es 去掉留 e：但较罕见，留作候选
    ("s", ""),
    # 比较级 / 最高级
    ("est", ""),
    ("est", "e"),
    ("er", ""),
    ("er", "e"),
    # 副词 -ly（更具体的后缀放前面优先匹配）：happily -> happy, nicely -> nice, quickly -> quick
    ("ely", "e"),
    ("ily", "y"),
    ("ly", ""),
]

# 常见不规则动词变形 -> 原形（覆盖最高频的几十个，纯后缀规则无法处理这些）
IRREGULAR_VERBS = {
    # be
    "am": "be", "is": "be", "are": "be", "was": "be", "were": "be",
    "been": "be", "being": "be",
    # have / do / go
    "has": "have", "had": "have", "having": "have",
    "did": "do", "done": "do", "does": "do", "doing": "do",
    "went": "go", "gone": "go", "going": "go", "goes": "go",
    # 常见不规则过去式/过去分词
    "came": "come", "coming": "come", "comes": "come",
    "became": "become", "becoming": "become", "becomes": "become",
    "began": "begin", "begun": "begin", "beginning": "begin", "begins": "begin",
    "took": "take", "taken": "take", "taking": "take", "takes": "take",
    "gave": "give", "given": "give", "giving": "give", "gives": "give",
    "made": "make", "making": "make", "makes": "make",
    "got": "get", "gotten": "get", "getting": "get", "gets": "get",
    "found": "find", "finding": "find", "finds": "find",
    "said": "say", "saying": "say", "says": "say",
    "saw": "see", "seen": "see", "seeing": "see", "sees": "see",
    "knew": "know", "known": "know", "knowing": "know", "knows": "know",
    "thought": "think", "thinking": "think", "thinks": "think",
    "told": "tell", "telling": "tell", "tells": "tell",
    "put": "put", "puts": "put",
    "let": "let", "lets": "let",
    "ran": "run", "running": "run", "runs": "run",
    "sat": "sit", "sitting": "sit", "sits": "sit",
    "stood": "stand", "standing": "stand", "stands": "stand",
    "spoke": "speak", "spoken": "speak", "speaking": "speak", "speaks": "speak",
    "wrote": "write", "written": "write", "writing": "write", "writes": "write",
    "read": "read", "reading": "read", "reads": "read",
    "broke": "break", "broken": "break", "breaking": "break", "breaks": "break",
    "chose": "choose", "chosen": "choose", "choosing": "choose", "chooses": "choose",
    "drove": "drive", "driven": "drive", "driving": "drive", "drives": "drive",
    "fell": "fall", "fallen": "fall", "falling": "fall", "falls": "fall",
    "felt": "feel", "feeling": "feel", "feels": "feel",
    "held": "hold", "holding": "hold", "holds": "hold",
    "kept": "keep", "keeping": "keep", "keeps": "keep",
    "left": "leave", "leaving": "leave", "leaves": "leave",
    "lost": "lose", "losing": "lose", "loses": "lose",
    "met": "meet", "meeting": "meet", "meets": "meet",
    "paid": "pay", "paying": "pay", "pays": "pay",
    "sent": "send", "sending": "send", "sends": "send",
    "spent": "spend", "spending": "spend", "spends": "spend",
    "won": "win", "winning": "win", "wins": "win",
    "understood": "understand", "understanding": "understand", "understands": "understand",
    "meant": "mean", "meaning": "mean", "means": "mean",
    "showed": "show", "shown": "show", "showing": "show", "shows": "show",
    "grew": "grow", "grown": "grow", "growing": "grow", "grows": "grow",
    "threw": "throw", "thrown": "throw", "throwing": "throw", "throws": "throw",
    "flew": "fly", "flown": "fly", "flying": "fly", "flies": "fly",
    "drew": "draw", "drawn": "draw", "drawing": "draw", "draws": "draw",
    "blew": "blow", "blown": "blow", "blowing": "blow", "blows": "blow",
    "caught": "catch", "catching": "catch", "catches": "catch",
    "taught": "teach", "teaching": "teach", "teaches": "teach",
    "bought": "buy", "buying": "buy", "buys": "buy",
    "brought": "bring", "bringing": "bring", "brings": "bring",
    "fought": "fight", "fighting": "fight", "fights": "fight",
    "built": "build", "building": "build", "builds": "build",
    "burnt": "burn", "burned": "burn", "burning": "burn", "burns": "burn",
    "dealt": "deal", "dealing": "deal", "deals": "deal",
    "fed": "feed", "feeding": "feed", "feeds": "feed",
    "laid": "lay", "laying": "lay", "lays": "lay",
    "led": "lead", "leading": "lead", "leads": "lead",
    "rang": "ring", "rung": "ring", "ringing": "ring", "rings": "ring",
    "rose": "rise", "risen": "rise", "rising": "rise", "rises": "rise",
    "swam": "swim", "swum": "swim", "swimming": "swim", "swims": "swim",
    "wore": "wear", "worn": "wear", "wearing": "wear", "wears": "wear",
    "shook": "shake", "shaken": "shake", "shaking": "shake", "shakes": "shake",
    "shot": "shoot", "shooting": "shoot", "shoots": "shoot",
    "sang": "sing", "sung": "sing", "singing": "sing", "sings": "sing",
    "stole": "steal", "stolen": "steal", "stealing": "steal", "steals": "steal",
    "struck": "strike", "striking": "strike", "strikes": "strike",
    "tore": "tear", "torn": "tear", "tearing": "tear", "tears": "tear",
    "woke": "wake", "woken": "wake", "waking": "wake", "wakes": "wake",
    "forbid": "forbid", "forgave": "forgive", "forgiven": "forgive",
    "hid": "hide", "hidden": "hide", "hiding": "hide",
    "rode": "ride", "ridden": "ride", "riding": "ride", "rides": "ride",
}


def lemmatize(word):
    """
    对一个英文单词生成它的若干"可能原形"候选列表（小写）。
    不依赖第三方库：先用不规则动词表查，再用后缀规则。
    返回 list[str]，不含 word 自身（调用方已先试过 word 本身）。
    """
    # 1) 不规则动词变形（过去式/过去分词/现在分词/三单）-> 原形
    if word in IRREGULAR_VERBS:
        return [IRREGULAR_VERBS[word]]

    # 1.5) 缩约形式：don't -> do, i'm -> i, she's -> she, can't -> can ...
    #     （撇号已在切词时保留为单词字符，这里直接查表/拆解）
    if "'" in word:
        base = word.split("'", 1)[0]
        # 特殊否定缩约：can't / won't / shan't
        neg_map = {"can't": "can", "won't": "will", "shan't": "shall",
                   "cannot": "can"}
        if word in neg_map:
            return [neg_map[word]]
        if base in ("don", "doesn", "didn", "isn", "aren", "wasn", "weren",
                    "hasn", "haven", "hadn", "couldn", "shouldn", "wouldn",
                    "mustn", "mightn", "needn", "daren"):
            # don't -> do, doesn't -> do (还原成 do)，更精确地补 n 前的原形
            neg_back = {"don": "do", "doesn": "do", "didn": "do",
                        "isn": "be", "aren": "be", "wasn": "be", "weren": "be",
                        "hasn": "have", "haven": "have", "hadn": "have",
                        "couldn": "can", "shouldn": "should", "wouldn": "would",
                        "mustn": "must", "mightn": "might", "needn": "need",
                        "daren": "dare"}
            return [neg_back.get(base, base)]
        # 其余缩约：i'm -> i(am), you're -> you, he's -> he, we'll -> we ...
        pro = ("i", "you", "he", "she", "it", "we", "they", "there", "here",
               "that", "who", "what", "where", "let")
        if base in pro:
            return [base]

    cands = []
    n = len(word)
    for suffix, repl in LEMMATIZE_RULES:
        if not word.endswith(suffix) or n <= len(suffix):
            continue
        stem = word[: n - len(suffix)]
        if repl is None:
            # 双写末辅音的还原：running -> runn -> 再去一个末字母 -> run
            if len(stem) >= 1:
                cands.append(stem[:-1])
        else:
            cands.append(stem + repl)
    # 去重保序
    seen = set()
    out = []
    for c in cands:
        if c and c not in seen and len(c) >= 2:
            seen.add(c)
            out.append(c)
    # 候选按长度降序排列：更长的还原原形优先匹配。
    # 否则 coding -> cod(鳕鱼) 会抢先于 -> code(编码) 命中，导致释义错误。
    out.sort(key=len, reverse=True)
    return out

# 词库数据文件：根目录下的 vocabulary.json（由 merge_vocab_lite.py 合并生成）
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
VOCAB_PATH = os.path.join(SCRIPT_DIR, "vocabulary.json")



# 默认输入文本（当前目录下的视频转录）
DEFAULT_INPUT = os.path.join(
    SCRIPT_DIR, "【官方双语】压缩即智能：Part1，重新发明熵.txt"
)

# 用于切分单词的正则：匹配连续的英文字母（含撇号，如 don't），其余字符都当作分隔符
WORD_RE = re.compile(r"[A-Za-z']+")

# 英文常见缩写（其中的点不是句末）：分句时避免在这些点处误切
_ABBREV = {
    "mr", "mrs", "ms", "dr", "prof", "sr", "jr", "st", "vs", "etc",
    "fig", "no", "vol", "pp", "al", "inc", "ltd", "co", "u.s", "u.k",
    "e.g", "i.e", "a.m", "p.m",
}
# 单个大写字母（首字母缩写中的点），如 U. S. A. —— 用"点前是单个字母"判断
# 中文句末标点：。！？
_CN_SENT_END = "。！？"


def split_sentences(text):
    """
    把整段文本切成句子列表，不依赖"一行一句"的假设。
    处理三种情况：
      - 英文：在 . ! ? 之后切分，但排除小数(3.14)、常见缩写(Mr. / e.g.)、
        单字母缩写(U.S.A.)，且要求句末标点后跟空白/换行/结尾才算句界。
      - 中文：在 。！？ 处切分。
      - 其它换行：原样当作分隔符，避免把跨行的句子硬拼成一行。

    返回 list[str]，每个元素是一个去首尾空白后的句子（可能为空，调用方过滤）。
    """
    sentences = []
    buf = []          # 当前正在累积的字符
    i = 0
    n = len(text)

    def flush():
        s = "".join(buf).strip()
        if s:
            sentences.append(s)
        buf.clear()

    while i < n:
        ch = text[i]

        # 中文句末标点：直接成句
        if ch in _CN_SENT_END:
            buf.append(ch)
            flush()
            i += 1
            continue

        # 英文句末候选：. ! ?
        if ch in ".!?":
            buf.append(ch)
            # 判断这个点是不是真的句末：
            #   1) 看点前面的"词"是不是缩写/小数/单字母 —— 若是，则不是句末
            #   2) 看 ! ? 总是句末候选（但同样要看后面是否跟空白）
            #   3) 看点后面是否跟 空白/换行/中文/结尾
            is_sent_end = False
            if ch == ".":
                is_sent_end = _dot_is_sentence_end(text, i, buf)
            else:  # ! ?
                is_sent_end = True

            if is_sent_end:
                # 还要看点/!?后面是否真的接一个"新句子起点"：
                # 跳过空白与右引号/右括号，若遇到 大写字母/中文/数字/换行/结尾 则切
                j = i + 1
                while j < n and text[j] in " \t'\"\")”、":
                    j += 1
                nxt = text[j] if j < n else ""
                if nxt == "" or nxt == "\n" or nxt.isupper() or _is_cjk(nxt) or nxt.isdigit():
                    flush()
            i += 1
            continue

        buf.append(ch)
        i += 1

    flush()
    return sentences


def _dot_is_sentence_end(text, i, buf):
    """判断 text[i] 处的 '.' 是否为句末（而非小数/缩写的一部分）。"""
    # 回看 buf 里最后一个"词"（连续的字母数字和点）
    # 取点之前的连续 token
    word = []
    k = len(buf) - 2  # buf[-1] 是这个 '.' 本身
    while k >= 0 and (buf[k].isalnum() or buf[k] == "."):
        word.append(buf[k])
        k -= 1
    word_str = "".join(reversed(word)).lower()

    # 小数：3.14 / .5 —— 点两侧都是数字则不是句末
    left_is_digit = bool(word) and word[-1].isdigit()
    right_is_digit = (i + 1 < len(text)) and text[i + 1].isdigit()
    if left_is_digit or right_is_digit:
        return False

    # 单字母缩写：U. S. A. —— 点前只有一个字母，视为不是句末
    if len(word_str) == 1:
        return False

    # 常见缩写词：mr. / e.g. / etc.
    # word_str 可能含点（如 "e.g"），去掉点再比对
    compact = word_str.replace(".", "")
    if compact in _ABBREV or word_str in _ABBREV:
        return False

    return True


def _is_cjk(ch):
    """判断一个字符是否为 CJK（中日韩）字符。"""
    if not ch:
        return False
    code = ord(ch)
    return (
        0x4E00 <= code <= 0x9FFF      # CJK 统一汉字
        or 0x3000 <= code <= 0x303F   # CJK 标点
        or 0xFF00 <= code <= 0xFFEF   # 全角字符
    )


def enabled_levels():
    """返回当前启用（True）的等级名列表，顺序与 LEVELS 一致。"""
    return [name for name, on in LEVELS if on]


def is_level_enabled(level_name):
    """查询某等级是否启用（LEVELS 第二列开关）。"""
    for name, on in LEVELS:
        if name == level_name:
            return on
    return False


def load_levels():
    """
    从 vocabulary.json 加载各等级词表，返回两个结构：
      - level_defs: dict, {等级名: {单词(小写): 释义}}  （释义用于表格右列）
      - word_to_level: dict, {单词(小写): 最低难度等级名}
    归类规则：按 LEVELS 从低到高遍历，先到的等级"占据"该词，后续更高等级不再覆盖。

    vocabulary.json 结构：{等级名: {单词(小写): 释义}}，由 merge_vocab_lite.py 生成。
    只加载 LEVELS 中声明的等级；json 里多余的等级忽略。
    """
    if not os.path.exists(VOCAB_PATH):
        print(f"[错误] 词库文件不存在：{VOCAB_PATH}")
        print(f"        请先运行 merge_vocab_lite.py 生成它。")
        sys.exit(1)

    with open(VOCAB_PATH, "r", encoding="utf-8") as f:
        raw = json.load(f)

    level_defs = {}
    word_to_level = {}

    for level_name, _enabled in LEVELS:
        defs = raw.get(level_name)
        if defs is None:
            print(f"[警告] vocabulary.json 里没有等级「{level_name}」，跳过")
            continue
        # 防御：确保单词 key 是小写（与匹配逻辑一致）
        defs = {w.lower(): m for w, m in defs.items()}
        level_defs[level_name] = defs
        # 归到最低等级：若该词尚未被更低等级收录，则归入当前等级
        for word in defs:
            if word not in word_to_level:
                word_to_level[word] = level_name
        print(f"[加载] {level_name:<4} {len(defs):>6} 词  <- vocabulary.json[{level_name}]")

    return level_defs, word_to_level


def extract_word_sentences(text):
    """
    先对全文分句，再在【每个句子内】提取英文单词。
    返回：
      - tokens: list of (order, 原始形式, 小写形式, 所在句子)，按文中首次出现顺序，
                同一 (原始形式, 小写形式) 只保留第一次出现的那次及其句子。
      - sentences: list[str]，所有句子（按出现顺序），供调试/统计用。

    设计：因为先分句再提词，每个单词天然带着它所在的句子；同一单词取首次出现的那句。
    """
    sentences = split_sentences(text)
    tokens = []
    seen = set()  # (原始形式, 小写形式)
    order = 0
    for sent in sentences:
        for token in WORD_RE.findall(sent):
            lower = token.lower().strip("'")
            if not lower:
                continue
            key = (token, lower)
            if key in seen:
                continue
            seen.add(key)
            tokens.append((order, token, lower, sent))
            order += 1
    return tokens, sentences


def classify(tokens, word_to_level, level_defs):
    """
    将文本中的单词 token 按等级归类。
    归并规则：词形还原后归属同一原形的多个变形（如 answer / answering / answers）
    合并为一条，展示形式取文中【首次出现】的形式，释义取原形释义。
    排序规则：所有列表均按在文中【首次出现】的先后顺序，不按字母序。

    返回：
      - by_level: dict, {等级名: [(单词显示形式, 释义, 例句), ...]}  （按出现顺序）
      - unknown: list，未被词表收录的词（按出现顺序，已去重、去过短项）
    """
    by_level = {name: [] for name in enabled_levels()}
    unknown = []

    # 已收录的"原形" -> 已登记标记，避免同一原形的多个变形重复入列
    seen_lemma = set()
    # tokens 现在是 (order, token, lower, sentence) 四元组
    for order, token, lower, sentence in tokens:
        level = word_to_level.get(lower)
        matched = lower  # 实际命中词表的原形

        if level is None:
            # 未直接命中，尝试词形还原（-s/-ed/-ing 等）找回原形
            for cand in lemmatize(lower):
                lv = word_to_level.get(cand)
                if lv is not None:
                    level = lv
                    matched = cand
                    break

        if level is None:
            # 仍未命中：过滤掉单字母等噪声，归入超纲（同样按原形去重）
            if len(lower) <= 1:
                continue
            if matched in seen_lemma:
                continue
            seen_lemma.add(matched)
            unknown.append((order, lower))
            continue

        # 命中的等级若被关闭：视为已掌握，直接跳过，不进任何区块、也不进超纲
        if not is_level_enabled(level):
            seen_lemma.add(matched)  # 标记，避免后续变形再处理
            continue

        # 同一原形只保留首次出现的那一条
        if matched in seen_lemma:
            continue
        seen_lemma.add(matched)

        # 展示形式：统一用小写（去掉句首大写等原文大小写差异）
        display = token.lower()
        meaning = level_defs[level].get(matched, "")
        by_level[level].append((order, display, meaning, sentence))

    # 把 order 排序信息剥掉，转为 (display, meaning, sentence) 列表
    for level in by_level:
        by_level[level].sort(key=lambda x: x[0])
        by_level[level] = [(disp, mean, sent) for _, disp, mean, sent in by_level[level]]
    unknown.sort(key=lambda x: x[0])
    unknown = [w for _, w in unknown]

    return by_level, unknown


def level_anchor(level_name):
    """生成统计表链接与区块标题锚点共用的 HTML 锚点 ID（保持稳定、无空格）。"""
    return "level-" + level_name


def render_word_cell(meaning, sentence):
    """
    把(释义, 例句)渲染成表格右列的 <details> 单元格 HTML：
      <details><summary>释义</summary>例句</details>
    - 释义进 summary（默认可见），例句进 details（点击释义才展开）。
    - 转义 | 以免破坏 Markdown 表格；转义 HTML 特殊字符以免破坏标签。
    - 无例句时退化为纯释义文本（不再套折叠块，保持简洁）。
    """
    safe_meaning = _escape_cell(meaning) if meaning else "（无释义）"
    if not sentence:
        return safe_meaning
    safe_sentence = _escape_cell(sentence)
    return f'<details><summary>{safe_meaning}</summary>{safe_sentence}</details>'


def _escape_cell(s):
    """转义表格单元格里的特殊字符：| 会断列，< > & 会破坏 HTML 标签。"""
    if not s:
        return ""
    s = s.replace("&", "&amp;")
    s = s.replace("<", "&lt;")
    s = s.replace(">", "&gt;")
    s = s.replace("|", "\\|")
    # 换行在表格单元格里会破坏渲染，换成空格
    s = s.replace("\n", " ").replace("\r", " ")
    return s


def render_markdown(by_level, unknown, source_name):
    """渲染为 Markdown 字符串。"""
    lines = []
    lines.append(f"# 单词分级 —— {os.path.basename(source_name)}\n")
    lines.append(
        "说明：每个单词只归入它所属的**最低**难度等级（基础词优先吸收），不重复。\n"
    )

    # 提示被关闭（隐去）的等级
    disabled = [name for name, on in LEVELS if not on]
    if disabled:
        lines.append(
            "> 已关闭的等级（视为已掌握，不出现在结果中）：" + "、".join(disabled) + "\n"
        )

    # 汇总统计（等级名做成可跳转的锚点链接）
    lines.append("## 统计\n")
    lines.append("| 等级 | 词数 |")
    lines.append("| --- | ---: |")
    for level_name in enabled_levels():
        anchor = level_anchor(level_name)
        lines.append(f"| [{level_name}](#{anchor}) | {len(by_level[level_name])} |")
    lines.append(f"| [超纲 / 未收录](#{level_anchor('超纲')}) | {len(unknown)} |")
    lines.append("")

    # 各等级表格（仅输出启用的等级）
    for level_name in enabled_levels():
        items = by_level[level_name]
        anchor = level_anchor(level_name)
        # 标题前插入显式 HTML 锚点，兼容各 Markdown 预览器（VSCode/GitHub/Typora）
        lines.append(f'<a id="{anchor}"></a>')
        lines.append(f"## {level_name}（{len(items)} 词）\n")
        if not items:
            lines.append("_本等级无匹配单词_\n")
            continue
        lines.append("| 单词 | 释义（点击展开例句） |")
        lines.append("| --- | --- |")
        for display, meaning, sentence in items:
            cell = render_word_cell(meaning, sentence)
            lines.append(f"| {display} | {cell} |")
        lines.append("")

    # 超纲 / 未收录词
    lines.append(f'<a id="{level_anchor("超纲")}"></a>')
    lines.append(f"## 超纲 / 未收录词（{len(unknown)} 词）\n")
    if not unknown:
        lines.append("_无_\n")
    else:
        # 紧凑展示，每行若干个
        lines.append(", ".join(f"`{w}`" for w in unknown))
        lines.append("")

    return "\n".join(lines) + "\n"


def main():
    # 解析命令行参数
    args = sys.argv[1:]
    input_path = args[0] if len(args) >= 1 else DEFAULT_INPUT
    # 默认输出文件名：输入文件名换成 .md
    if len(args) >= 2:
        output_path = args[1]
    else:
        base = os.path.splitext(input_path)[0]
        output_path = base + "-分级单词.md"

    if not os.path.exists(input_path):
        print(f"[错误] 输入文本不存在：{input_path}")
        sys.exit(1)

    print(f"[输入] {input_path}")
    print(f"[输出] {output_path}\n")

    # 1. 加载词表
    level_defs, word_to_level = load_levels()
    print(f"[就绪] 共加载 {len(word_to_level)} 个唯一词条\n")

    # 2. 读取文本
    with open(input_path, "r", encoding="utf-8") as f:
        text = f.read()

    # 3. 提取并归类（先分句，再在句内提词，每个单词天然带上所在句子）
    tokens, sentences = extract_word_sentences(text)
    print(f"[分析] 共分出 {len(sentences)} 个句子，文本中出现 {len(tokens)} 个不同单词\n")

    by_level, unknown = classify(tokens, word_to_level, level_defs)

    # 4. 渲染并写出
    md = render_markdown(by_level, unknown, input_path)
    with open(output_path, "w", encoding="utf-8") as f:
        f.write(md)

    print(f"[完成] 已生成：{output_path}")
    print(f"        各等级词数：" + " / ".join(
        f"{name} {len(by_level[name])}" for name in enabled_levels()
    ) + f"  | 超纲 {len(unknown)}")
    disabled = [name for name, on in LEVELS if not on]
    if disabled:
        print(f"        已关闭（隐去）：" + "、".join(disabled))


if __name__ == "__main__":
    main()
