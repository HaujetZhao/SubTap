// 词形还原（纯函数，无依赖）
// 移植自 分级单词提取.py 的 lemmatize()：把屈折变形（raises/running/studies/went）
// 还原成原形候选列表，供查词时"原词未命中再试候选"使用。
// 设计为"试所有候选，命中即用"，宁可多生成几个候选；候选按长度降序，
// 避免 coding→cod(鳇鱼) 抢先于 code(编码) 命中导致释义错误；
// 去双写候选例外地加权排最前（putting→put 先于 putt），见 dedupe。

// 不规则动词变形 → 原形（过去式/过去分词 + be/have/do 系）；
// 只收纯后缀规则还原不了的：三单、-ing 及规则过去式（showed/burned 等）均由
// LEMMATIZE_RULES 覆盖（es→空 / ies→y / ing→空/补e/双写 / ed→空/补e/双写）。
const IRREGULAR_VERBS = {
  // be / have / do
  am: 'be', is: 'be', are: 'be', was: 'be', were: 'be', been: 'be',
  has: 'have', had: 'have',
  did: 'do', done: 'do', does: 'do',
  went: 'go', gone: 'go',
  came: 'come',
  became: 'become',
  began: 'begin', begun: 'begin',
  took: 'take', taken: 'take',
  gave: 'give', given: 'give',
  made: 'make',
  got: 'get', gotten: 'get',
  found: 'find',
  said: 'say',
  saw: 'see', seen: 'see',
  knew: 'know', known: 'know',
  thought: 'think',
  told: 'tell',
  ran: 'run',
  sat: 'sit',
  stood: 'stand',
  spoke: 'speak', spoken: 'speak',
  wrote: 'write', written: 'write',
  broke: 'break', broken: 'break',
  chose: 'choose', chosen: 'choose',
  drove: 'drive', driven: 'drive',
  fell: 'fall', fallen: 'fall',
  felt: 'feel',
  held: 'hold',
  kept: 'keep',
  left: 'leave',
  lost: 'lose',
  met: 'meet',
  paid: 'pay',
  sent: 'send',
  spent: 'spend',
  won: 'win',
  understood: 'understand',
  meant: 'mean',
  shown: 'show',
  grew: 'grow', grown: 'grow',
  threw: 'throw', thrown: 'throw',
  flew: 'fly', flown: 'fly',
  drew: 'draw', drawn: 'draw',
  blew: 'blow', blown: 'blow',
  caught: 'catch',
  taught: 'teach',
  bought: 'buy',
  brought: 'bring',
  fought: 'fight',
  built: 'build',
  burnt: 'burn',
  dealt: 'deal',
  fed: 'feed',
  laid: 'lay',
  led: 'lead',
  rang: 'ring', rung: 'ring',
  rose: 'rise', risen: 'rise',
  swam: 'swim', swum: 'swim',
  wore: 'wear', worn: 'wear',
  shook: 'shake', shaken: 'shake',
  shot: 'shoot',
  sang: 'sing', sung: 'sing',
  stole: 'steal', stolen: 'steal',
  struck: 'strike',
  tore: 'tear', torn: 'tear',
  woke: 'wake', woken: 'wake',
  forgave: 'forgive', forgiven: 'forgive',
  hid: 'hide', hidden: 'hide',
  rode: 'ride', ridden: 'ride',
  heard: 'hear',
};

// 后缀还原规则（按优先级）：[后缀, 替换为]
// repl 取值：'' 直接去后缀 / 'e' 'y' 'ie' 补字母 / null 双写末辅音再去一字母（running→run）
const LEMMATIZE_RULES = [
  ['ies', 'y'],   // studies -> study
  ['ied', 'y'],   // applied -> apply
  ['iest', 'y'],  // easiest -> easy（最高级 -iest）
  ['ier', 'y'],   // easier -> easy / happier -> happy（比较级 -ier）
  ['ying', 'ie'], // dying -> die
  ['ying', 'y'],
  ['ing', ''],    // encoding -> encod（再由补 e 候选补成 encode）
  ['ing', 'e'],   // encod(ing) -> encode
  ['ing', null],  // running -> runn -> 去1 -> run
  ['ed', ''],
  ['ed', 'e'],    // encoded -> encode
  ['ed', null],   // stopped -> stop
  ['es', ''],     // boxes -> box
  ['es', 'e'],
  ['s', ''],      // cats -> cat / makes -> make（靠补 e 候选）
  ['est', ''],
  ['est', 'e'],
  ['er', ''],
  ['er', 'e'],
  ['er', null],   // bigger -> bigg -> 去1 -> big（比较级双写）
  ['ably', 'able'], // inexorably -> inexorable（副词 -ably）
  ['ibly', 'ible'], // terribly -> terrible（副词 -ibly）
  ['ely', 'e'],
  ['ily', 'y'],   // happily -> happy
  ['ly', ''],     // quickly -> quick
  ['ic', ''],     // logarithmic -> logarithm（形容词 -ic 回名词）
  // 名词/形容词/副词派生后缀（词条以基础词为主，派生形还原成词根更易命中）
  ['ically', 'ic'],   // mathematically -> mathematic / classically -> classic
  ['ically', 'ical'], // classically -> classical
  ['ically', 'y'],    // historically -> history
  ['ical', 'ic'],     // electrical -> electric / logical -> logic
  ['ical', 'y'],      // historic -> history（electric+al 类无 y，冗余候选无害）
  ['ic', 'y'],        // economic -> economy（poetic→poet 由 ic 空候选兜住，poetry 收不到属词典覆盖）
  ['ility', 'le'],    // compatibility -> compatible / responsibility -> responsible
  ['ility', 'e'],     // fragility -> fragile
  ['ity', 'e'],       // activity -> active / immensity -> immense
  ['ity', ''],        // reality -> real / humanity -> human
  ['ness', ''],       // kindness -> kind / darkness -> dark
  ['iness', 'y'],     // happiness -> happy（y→i 再加 ness）
  ['ful', ''],        // helpful -> help / careful -> care
  ['less', ''],       // careless -> care / hopeless -> hope
  ['ous', ''],        // dangerous -> danger
  ['ous', 'e'],       // continuous -> continue / famous -> fame
  ['ive', ''],        // active -> act
  ['ive', 'e'],       // creative -> create / relative -> relate
  ['ves', 'f'],       // leaves -> leaf / wolves -> wolf（-f/-fe 复数）
  ['ves', 'fe'],      // knives -> knife / lives -> life
  ['ses', 'sis'],     // bases -> basis / analyses -> analysis（-sis 复数）
  ['ship', ''],       // friendship -> friend / relationship -> relation
];

// 否定缩约（完整 token → 助动词原形）：don't→do, can't→can, won't→will ...
const NEG_CONTRACTIONS = {
  "don't": 'do', "doesn't": 'do', "didn't": 'do',
  "isn't": 'be', "aren't": 'be', "wasn't": 'be', "weren't": 'be',
  "hasn't": 'have', "haven't": 'have', "hadn't": 'have',
  "couldn't": 'can', "shouldn't": 'should', "wouldn't": 'would',
  "mustn't": 'must', "mightn't": 'might', "needn't": 'need', "daren't": 'dare',
  "can't": 'can', "won't": 'will', "shan't": 'shall',
};

// 代词/指示词 base：缩约时撇号前部分命中这些 → 原形即 base
// i'm→i, you're→you, she's→she, it's→it, let's→let, that's→that ...
const PRO_BASES = new Set([
  'i', 'you', 'he', 'she', 'it', 'we', 'they', 'there', 'here',
  'that', 'who', 'what', 'where', 'let',
]);

// 元音判断（双写/补 e 规则的形态约束用）
const isVowel = c => 'aeiou'.includes(c);

// 候选去重保序 + 过滤过短（<2）+ 排序：优先级降序、同优先级长度降序。
// 更长的原形优先匹配，避免 coding→cod(鳇鱼) 抢先于 code(编码)；
// 但去双写候选反向加权排最前：putting→put 优先于 putt(高尔夫轻击)、planning→plan。
function dedupe(cands) {
  const seen = new Map(); // 词 → 优先级（0 常规 / 1 加权，取最大）
  for (const [c, prio] of cands) {
    if (c && c.length >= 2) seen.set(c, Math.max(seen.get(c) ?? 0, prio));
  }
  return [...seen.entries()].sort((a, b) => b[1] - a[1] || b[0].length - a[0].length).map(e => e[0]);
}

// 生成 word 的若干"可能原形"候选（小写），不含 word 自身（调用方已先试过 word 本身）。
export function lemmatize(word) {
  if (!word) return [];

  // 1) 含撇号：缩约 / 所有格
  if (word.includes("'")) {
    // 否定缩约：don't → do, can't → can
    if (NEG_CONTRACTIONS[word]) return [NEG_CONTRACTIONS[word]];
    const base = word.split("'")[0];
    // 代词/指示词缩约：i'm/she's/it's/let's → base（i/she/it/let）
    if (PRO_BASES.has(base)) return [base];
    // 其余含撇号（多为所有格 letters'、shannon's）：取撇号前部分，
    // 并对 base 再走一遍还原（letters' → letters → letter）。
    if (base.length >= 2) return dedupe([[base, 1], ...lemmatize(base).map(c => [c, 0])]);
    return [];
  }

  // 2) cannot 特例（无撇号）
  if (word === 'cannot') return ['can'];

  // 3) 非纯字母（数字、其它符号）：不处理
  if (/[^a-z]/.test(word)) return [];

  // 4) 不规则动词变形 → 原形
  if (IRREGULAR_VERBS[word]) return [IRREGULAR_VERBS[word]];

  // 5) 后缀规则：试所有候选
  const cands = [];
  const n = word.length;
  for (const [suffix, repl] of LEMMATIZE_RULES) {
    if (!word.endsWith(suffix) || n <= suffix.length) continue;
    const stem = word.slice(0, n - suffix.length);
    if (repl === null) {
      // 双写还原：仅当 stem 真以双写辅音结尾（running→runn→run）；
      // 否则（coding→cod）是伪双写，不生成候选。ss/zz 是词基自带形态
      // （pass/discuss/buzz + 后缀），不是双写变形，同样不生成。
      // 去双写候选加权排最前（put 优先于 putt）。
      const last = stem.at(-1);
      if (stem.length >= 3 && !isVowel(last) && last === stem.at(-2) && last !== 's' && last !== 'z') {
        cands.push([stem.slice(0, -1), 1]);
      }
    } else if (repl === 'e' && (suffix === 'ing' || suffix === 'ed') && isVowel(stem.at(-1))) {
      // 补 e 候选基于"辅音结尾词基脱 e"（love→loving/loved）；stem 以元音结尾时
      // 必是垃圾（doing→doe/being→bee/agreed→agreee），不生成
      continue;
    } else {
      cands.push([stem + repl, 0]);
    }
  }
  return dedupe(cands);
}
