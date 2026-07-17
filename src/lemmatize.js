// 词形还原（纯函数，无依赖）
// 移植自 分级单词提取.py 的 lemmatize()：把屈折变形（raises/running/studies/went）
// 还原成原形候选列表，供查词时"原词未命中再试候选"使用。
// 设计为"试所有候选，命中即用"，宁可多生成几个候选；候选按长度降序，
// 避免 coding→cod(鳇鱼) 抢先于 code(编码) 命中导致释义错误。

// 不规则动词变形 → 原形（过去式/过去分词/现在分词/三单）；纯后缀规则无法处理这些
const IRREGULAR_VERBS = {
  // be
  am: 'be', is: 'be', are: 'be', was: 'be', were: 'be',
  been: 'be', being: 'be',
  // have / do / go
  has: 'have', had: 'have', having: 'have',
  did: 'do', done: 'do', does: 'do', doing: 'do',
  went: 'go', gone: 'go', going: 'go', goes: 'go',
  came: 'come', coming: 'come', comes: 'come',
  became: 'become', becoming: 'become', becomes: 'become',
  began: 'begin', begun: 'begin', beginning: 'begin', begins: 'begin',
  took: 'take', taken: 'take', taking: 'take', takes: 'take',
  gave: 'give', given: 'give', giving: 'give', gives: 'give',
  made: 'make', making: 'make', makes: 'make',
  got: 'get', gotten: 'get', getting: 'get', gets: 'get',
  found: 'find', finding: 'find', finds: 'find',
  said: 'say', saying: 'say', says: 'say',
  saw: 'see', seen: 'see', seeing: 'see', sees: 'see',
  knew: 'know', known: 'know', knowing: 'know', knows: 'know',
  thought: 'think', thinking: 'think', thinks: 'think',
  told: 'tell', telling: 'tell', tells: 'tell',
  put: 'put', puts: 'put',
  let: 'let', lets: 'let',
  ran: 'run', running: 'run', runs: 'run',
  sat: 'sit', sitting: 'sit', sits: 'sit',
  stood: 'stand', standing: 'stand', stands: 'stand',
  spoke: 'speak', spoken: 'speak', speaking: 'speak', speaks: 'speak',
  wrote: 'write', written: 'write', writing: 'write', writes: 'write',
  read: 'read', reading: 'read', reads: 'read',
  broke: 'break', broken: 'break', breaking: 'break', breaks: 'break',
  chose: 'choose', chosen: 'choose', choosing: 'choose', chooses: 'choose',
  drove: 'drive', driven: 'drive', driving: 'drive', drives: 'drive',
  fell: 'fall', fallen: 'fall', falling: 'fall', falls: 'fall',
  felt: 'feel', feeling: 'feel', feels: 'feel',
  held: 'hold', holding: 'hold', holds: 'hold',
  kept: 'keep', keeping: 'keep', keeps: 'keep',
  left: 'leave', leaving: 'leave', leaves: 'leave',
  lost: 'lose', losing: 'lose', loses: 'lose',
  met: 'meet', meeting: 'meet', meets: 'meet',
  paid: 'pay', paying: 'pay', pays: 'pay',
  sent: 'send', sending: 'send', sends: 'send',
  spent: 'spend', spending: 'spend', spends: 'spend',
  won: 'win', winning: 'win', wins: 'win',
  understood: 'understand', understanding: 'understand', understands: 'understand',
  meant: 'mean', meaning: 'mean', means: 'mean',
  showed: 'show', shown: 'show', showing: 'show', shows: 'show',
  grew: 'grow', grown: 'grow', growing: 'grow', grows: 'grow',
  threw: 'throw', thrown: 'throw', throwing: 'throw', throws: 'throw',
  flew: 'fly', flown: 'fly', flying: 'fly', flies: 'fly',
  drew: 'draw', drawn: 'draw', drawing: 'draw', draws: 'draw',
  blew: 'blow', blown: 'blow', blowing: 'blow', blows: 'blow',
  caught: 'catch', catching: 'catch', catches: 'catch',
  taught: 'teach', teaching: 'teach', teaches: 'teach',
  bought: 'buy', buying: 'buy', buys: 'buy',
  brought: 'bring', bringing: 'bring', brings: 'bring',
  fought: 'fight', fighting: 'fight', fights: 'fight',
  built: 'build', building: 'build', builds: 'build',
  burnt: 'burn', burned: 'burn', burning: 'burn', burns: 'burn',
  dealt: 'deal', dealing: 'deal', deals: 'deal',
  fed: 'feed', feeding: 'feed', feeds: 'feed',
  laid: 'lay', laying: 'lay', lays: 'lay',
  led: 'lead', leading: 'lead', leads: 'lead',
  rang: 'ring', rung: 'ring', ringing: 'ring', rings: 'ring',
  rose: 'rise', risen: 'rise', rising: 'rise', rises: 'rise',
  swam: 'swim', swum: 'swim', swimming: 'swim', swims: 'swim',
  wore: 'wear', worn: 'wear', wearing: 'wear', wears: 'wear',
  shook: 'shake', shaken: 'shake', shaking: 'shake', shakes: 'shake',
  shot: 'shoot', shooting: 'shoot', shoots: 'shoot',
  sang: 'sing', sung: 'sing', singing: 'sing', sings: 'sing',
  stole: 'steal', stolen: 'steal', stealing: 'steal', steals: 'steal',
  struck: 'strike', striking: 'strike', strikes: 'strike',
  tore: 'tear', torn: 'tear', tearing: 'tear', tears: 'tear',
  woke: 'wake', woken: 'wake', waking: 'wake', wakes: 'wake',
  forgave: 'forgive', forgiven: 'forgive',
  hid: 'hide', hidden: 'hide', hiding: 'hide',
  rode: 'ride', ridden: 'ride', riding: 'ride', rides: 'ride',
};

// 后缀还原规则（按优先级）：[后缀, 替换为]
// repl 取值：'' 直接去后缀 / 'e' 'y' 'ie' 补字母 / null 双写末辅音再去一字母（running→run）
const LEMMATIZE_RULES = [
  ['ies', 'y'],   // studies -> study
  ['ied', 'y'],   // applied -> apply
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
  ['ely', 'e'],
  ['ily', 'y'],   // happily -> happy
  ['ly', ''],     // quickly -> quick
];

// 生成 word 的若干"可能原形"候选（小写），不含 word 自身（调用方已先试过 word 本身）。
// 含撇号等非纯字母词直接返回 []（缩约形式不处理）。
export function lemmatize(word) {
  if (!word || /[^a-z]/.test(word)) return [];

  // 1) 不规则动词变形 → 原形
  if (IRREGULAR_VERBS[word]) return [IRREGULAR_VERBS[word]];

  // 2) 后缀规则：试所有候选
  const cands = [];
  const n = word.length;
  for (const [suffix, repl] of LEMMATIZE_RULES) {
    if (!word.endsWith(suffix) || n <= suffix.length) continue;
    const stem = word.slice(0, n - suffix.length);
    if (repl === null) {
      // 双写末辅音：running -> runn -> 再去一个末字母 -> run
      if (stem.length >= 1) cands.push(stem.slice(0, -1));
    } else {
      cands.push(stem + repl);
    }
  }

  // 去重保序 + 过滤过短候选
  const seen = new Set();
  const out = [];
  for (const c of cands) {
    if (c && !seen.has(c) && c.length >= 2) {
      seen.add(c);
      out.push(c);
    }
  }
  // 候选按长度降序：更长的还原原形优先匹配（避免 coding->cod 抢先于 code）
  out.sort((a, b) => b.length - a.length);
  return out;
}
