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


import os
import re
import sys

# ═════════════════════════════════════════════════════════════
#                          【用户配置区】                       
#                                                              
#   每个等级第三列 True/False 控制是否输出该等级区块：          
#     True  = 正常输出该等级的单词表                           
#     False = 不输出该等级；其单词也不会被归入"超纲/未收录词"   
#             （相当于这些词被视为"已掌握"，从结果中完全隐去）  
#                                                              
#   直接修改下面的 True/False 即可，无需改动其它代码。         
LEVELS = [
    ("1 初中-乱序.txt", "初中", False),
    ("2 高中-乱序.txt", "高中", True),
    ("3 四级-乱序.txt", "四级", True),
    ("4 六级-乱序.txt", "六级", True),
    ("5 考研-乱序.txt", "考研", True),
    ("6 托福-乱序.txt", "托福", True),
    ("7 SAT-乱序.txt",  "SAT",  True),
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

# 词库目录（与脚本同级的 english-vocabulay 文件夹）
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DICT_DIR = os.path.join(SCRIPT_DIR, "english-vocabulay")



# 默认输入文本（当前目录下的视频转录）
DEFAULT_INPUT = os.path.join(
    SCRIPT_DIR, "【官方双语】压缩即智能：Part1，重新发明熵.srt"
)

# 用于切分单词的正则：匹配连续的英文字母（含撇号，如 don't），其余字符都当作分隔符
WORD_RE = re.compile(r"[A-Za-z']+")


def enabled_levels():
    """返回当前启用（True）的等级名列表，顺序与 LEVELS 一致。"""
    return [name for _file, name, on in LEVELS if on]


def is_level_enabled(level_name):
    """查询某等级是否启用（LEVELS 第三列开关）。"""
    for _file, name, on in LEVELS:
        if name == level_name:
            return on
    return False


def load_levels():
    """
    加载各等级词表，返回两个结构：
      - level_defs: dict, {等级名: {单词(小写): 释义}}  （释义用于表格右列）
      - word_to_level: dict, {单词(小写): 最低难度等级名}
    归类规则：从低到高遍历，先到的等级"占据"该词，后续更高等级不再覆盖。
    """
    level_defs = {}
    word_to_level = {}

    for filename, level_name, _enabled in LEVELS:
        path = os.path.join(DICT_DIR, filename)
        if not os.path.exists(path):
            print(f"[警告] 词表文件不存在，跳过：{path}")
            continue

        defs = {}
        with open(path, "r", encoding="utf-8") as f:
            for line in f:
                # 格式：单词 \t 释义
                if "\t" not in line:
                    continue
                parts = line.rstrip("\n").split("\t", 1)
                word = parts[0].strip().lower()
                meaning = parts[1].strip() if len(parts) > 1 else ""
                if not word:
                    continue
                defs[word] = meaning
                # 归到最低等级：若该词尚未被更低等级收录，则归入当前等级
                if word not in word_to_level:
                    word_to_level[word] = level_name

        level_defs[level_name] = defs
        print(f"[加载] {level_name:<4} {len(defs):>6} 词  <- {filename}")

    return level_defs, word_to_level


def extract_words_from_text(text):
    """
    从原始文本中按出现顺序提取所有英文单词 token，返回有序列表：
      tokens: list of (原始形式, 小写形式)，按文中首次出现顺序去重。
    （同一形式只保留第一次出现的那次；词形还原后归属同一原形的多个形式，
     会保留各自首次出现的先后，用于决定展示与排序。）
    """
    seen = set()
    tokens = []
    for token in WORD_RE.findall(text):
        lower = token.lower().strip("'")
        if not lower:
            continue
        key = (token, lower)
        if key in seen:
            continue
        seen.add(key)
        tokens.append((token, lower))
    return tokens


def classify(tokens, word_to_level, level_defs):
    """
    将文本中的单词 token 按等级归类。
    归并规则：词形还原后归属同一原形的多个变形（如 answer / answering / answers）
    合并为一条，展示形式取文中【首次出现】的形式，释义取原形释义。
    排序规则：所有列表均按在文中【首次出现】的先后顺序，不按字母序。

    返回：
      - by_level: dict, {等级名: [(单词显示形式, 释义), ...]}  （按出现顺序）
      - unknown: list，未被词表收录的词（按出现顺序，已去重、去过短项）
    """
    by_level = {name: [] for name in enabled_levels()}
    unknown = []

    # 已收录的"原形" -> 已登记标记，避免同一原形的多个变形重复入列
    seen_lemma = set()
    # 顺序号：每个 token 在 tokens 中的下标即其首次出现顺序
    for order, (token, lower) in enumerate(tokens):
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
        by_level[level].append((order, display, meaning))

    # 把 order 排序信息剥掉，转为 (display, meaning) 列表（tokens 本身已按出现顺序，但归并后需重排）
    for level in by_level:
        by_level[level].sort(key=lambda x: x[0])
        by_level[level] = [(disp, mean) for _, disp, mean in by_level[level]]
    unknown.sort(key=lambda x: x[0])
    unknown = [w for _, w in unknown]

    return by_level, unknown


def level_anchor(level_name):
    """生成统计表链接与区块标题锚点共用的 HTML 锚点 ID（保持稳定、无空格）。"""
    return "level-" + level_name


def render_markdown(by_level, unknown, source_name):
    """渲染为 Markdown 字符串。"""
    lines = []
    lines.append(f"# 单词分级 —— {os.path.basename(source_name)}\n")
    lines.append(
        "说明：每个单词只归入它所属的**最低**难度等级（基础词优先吸收），不重复。\n"
    )

    # 提示被关闭（隐去）的等级
    disabled = [name for _f, name, on in LEVELS if not on]
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
        lines.append("| 单词 | 释义 |")
        lines.append("| --- | --- |")
        for display, meaning in items:
            # 转义 Markdown 表格分隔符
            safe_meaning = meaning.replace("|", "\\|") if meaning else ""
            lines.append(f"| {display} | {safe_meaning} |")
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

    # 3. 提取并归类
    tokens = extract_words_from_text(text)
    print(f"[分析] 文本中共出现 {len(tokens)} 个不同单词\n")

    by_level, unknown = classify(tokens, word_to_level, level_defs)

    # 4. 渲染并写出
    md = render_markdown(by_level, unknown, input_path)
    with open(output_path, "w", encoding="utf-8") as f:
        f.write(md)

    print(f"[完成] 已生成：{output_path}")
    print(f"        各等级词数：" + " / ".join(
        f"{name} {len(by_level[name])}" for name in enabled_levels()
    ) + f"  | 超纲 {len(unknown)}")
    disabled = [name for _f, name, on in LEVELS if not on]
    if disabled:
        print(f"        已关闭（隐去）：" + "、".join(disabled))


if __name__ == "__main__":
    main()
