<script setup>
import { computed, reactive, ref, watch, onMounted } from 'vue';
import { lookupEtymology, prewarm } from '../logic/etymology.js';

const props = defineProps({
  store: { type: Object, required: true },
  enabled: { type: Object, required: true },
  currentText: { type: String, default: '' },
  colors: { type: Object, required: true }
});
const emit = defineEmits(['collapse', 'resizestart']);

// 命中单词分组（按级）。显式读取 enabled 各属性以建立响应式依赖，
// 使勾选变化时（store 内部状态非响应式，靠 enabled 镜像触发重算）。
const groups = computed(() => {
  for (const lv of props.store.getLevels()) {
    void props.enabled[lv]; // touch 响应式属性
  }
  return props.store.lookupByLevel(props.currentText);
});

// 是否有任何分级被勾选
const hasAnyEnabled = computed(() =>
  props.store.getLevels().some(lv => props.enabled[lv])
);

// 按 store 分级顺序，只列出已勾选且有命中的级
const visibleLevels = computed(() =>
  props.store.getLevels().filter(lv =>
    props.enabled[lv] && groups.value[lv] && groups.value[lv].length > 0
  )
);

function titleColor(lv) { return props.colors[lv]; }

// 词源状态：word → 词条 HTML（null=已查无）。词典后台预热完成后，
// watch 批量查当前句的词，有词源的词才亮徽章、点击即展开（结果已缓存）。
const etym = reactive({});
const ready = ref(false);
onMounted(async () => { ready.value = !!(await prewarm()); });

// 展开状态用单值记录；换句后词源一律回到收起态（查询结果跨句复用，展开状态不跨句）
const openWord = ref(null);
watch(() => props.currentText, () => { openWord.value = null; });

watch([groups, ready], () => {
  if (!ready.value) return;
  for (const lv of visibleLevels.value) {
    for (const w of groups.value[lv]) {
      if (etym[w.word] !== undefined) continue;
      etym[w.word] = null;
      lookupEtymology(w.word).then(html => { etym[w.word] = html; });
    }
  }
});

// 点击词卡切换词源展开；但若发生文本选择（划词），不响应
function onClickWord(word) {
  if (!etym[word]) return;
  const sel = window.getSelection();
  if (sel && !sel.isCollapsed) return;
  openWord.value = openWord.value === word ? null : word;
}

// 词源跳转：非 null 时展开体显示该词词条（而非词卡词）。返回链只记一层（回到词卡词）
const nav = ref(null);
watch(openWord, () => { nav.value = null; });

// 从点击坐标取落点处的英文单词（caretRangeFromPoint 直接命中文本节点+偏移,向两侧扩词边界）
function wordAt(x, y) {
  let node, offset;
  if (document.caretRangeFromPoint) {
    const r = document.caretRangeFromPoint(x, y);
    node = r?.startContainer; offset = r?.startOffset;
  } else {
    const p = document.caretPositionFromPoint(x, y);
    node = p?.offsetNode; offset = p?.offset;
  }
  if (!node || node.nodeType !== Node.TEXT_NODE) return null;
  const s = node.data;
  const isWord = c => /[A-Za-z]/.test(c);
  let a = offset, b = offset;
  while (a > 0 && isWord(s[a - 1])) a--;
  while (b < s.length && isWord(s[b])) b++;
  return b > a ? s.slice(a, b) : null;
}

// 跳转到目标词：查词条,查无静默
async function jumpTo(word) {
  const html = await lookupEtymology(word);
  if (!html) return;
  etym[word.toLowerCase()] = html;
  nav.value = word.toLowerCase();
}

// 词源展开体内点击：`/ciyuan/目标词` 交叉引用或落点在英文单词上 → 原位跳转；其余链接仅拦截导航。
// 跳转前查选区,划词复制不受影响
async function onEtymClick(e) {
  const a = e.target.closest('a');
  if (a) {
    e.preventDefault();
    const href = a.getAttribute('href') || '';
    if (href.startsWith('/ciyuan/')) {
      e.stopPropagation(); // 不冒泡到词卡（否则切换展开把词源收起）
      let target;
      try { target = decodeURIComponent(href.slice('/ciyuan/'.length)).toLowerCase(); }
      catch { return; }
      jumpTo(target);
    }
    return;
  }
  const sel = window.getSelection();
  if (sel && !sel.isCollapsed) return;
  const word = wordAt(e.clientX, e.clientY);
  if (!word) return;
  e.stopPropagation();
  jumpTo(word);
}
</script>

<template>
  <aside class="panel-right">
    <div class="panel-inner">
      <div class="panel-head">
        <h3 class="panel-title">生词</h3>
        <button class="collapse-btn-panel" title="收起词卡栏" @click="emit('collapse')"><i class="fas fa-chevron-right"></i></button>
      </div>
      <div v-if="!currentText" class="placeholder">点击中间句子查看单词</div>
      <div v-else-if="!hasAnyEnabled" class="placeholder">未勾选任何分级</div>
      <div v-else-if="!visibleLevels.length" class="placeholder">当前句没有词库中的单词</div>
      <div v-else class="word-groups">
        <div v-for="lv in visibleLevels" :key="lv" class="word-group">
          <h4 :style="{ color: titleColor(lv) }">
            {{ lv }}
            <span class="count-pill" :style="{ background: titleColor(lv) + '22', color: titleColor(lv) }">{{ groups[lv].length }}</span>
          </h4>
          <div v-for="w in groups[lv]" :key="w.word" class="word"
            :class="{ 'has-etym': etym[w.word] }"
            @click="onClickWord(w.word)">
            <span v-if="etym[w.word]" class="etym-dot"
              :class="{ on: openWord === w.word }"></span>
            <div class="w">{{ w.word }}</div>
            <div v-if="w.def" class="def">{{ w.def }}</div>
            <!-- capture 拦截词条 HTML 内的死链：/ciyuan/ 交叉引用走跳转,其余不导航 -->
            <div v-if="openWord === w.word" class="etym-body">
              <button v-if="nav" class="etym-back" @click.stop="nav = null">← {{ openWord }}</button>
              <div v-html="etym[nav || openWord]" @click.capture="onEtymClick"></div>
            </div>
          </div>
        </div>
      </div>
    </div>
    <div class="side-resize-handle" title="拖拽调整宽度" @pointerdown="emit('resizestart', $event)"></div>
  </aside>
</template>
