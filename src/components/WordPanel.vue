<script setup>
import { computed, reactive, ref, watch, onMounted } from 'vue';
import { lookupEtymology, prewarm, dictReady } from '../logic/etymology.js';

const props = defineProps({
  store: { type: Object, required: true },
  enabled: { type: Object, required: true },
  currentText: { type: String, default: '' },
  colors: { type: Object, required: true },
  theme: { type: String, default: 'light' }
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

// 暗色下纯级别色偏深,同视频字幕层:级别色向白混,亮且保色调。
// count-pill 仍用原始级别色拼 16 进制透明度,不吃 color-mix
function titleColor(lv) {
  return props.theme === 'dark'
    ? `color-mix(in srgb, ${props.colors[lv]} 55%, white)`
    : props.colors[lv];
}

// 词源状态，按词记：word → { open, html }。词典后台预热完成后，
// watch 批量查当前句的词，有词源的词才亮徽章、点击即展开（结果已缓存）。
const etym = reactive({});
const ready = ref(false);
onMounted(async () => { await prewarm(); ready.value = dictReady(); });

// 换句后词源一律回到收起态（词的查询结果跨句缓存复用，展开状态不跨句）
watch(() => props.currentText, () => {
  for (const k in etym) etym[k].open = false;
});

watch([groups, ready], () => {
  if (!ready.value) return;
  for (const lv of visibleLevels.value) {
    for (const w of groups.value[lv]) {
      if (etym[w.word]) continue;
      etym[w.word] = { open: false, html: null };
      lookupEtymology(w.word).then(html => { etym[w.word].html = html; });
    }
  }
});

function toggleEtym(word) { etym[word].open = !etym[word].open; }

// 点击词卡切换词源展开；但若发生文本选择（划词），不响应
function onClickWord(e, word) {
  if (!etym[word]?.html) return;
  const sel = window.getSelection();
  if (sel && !sel.isCollapsed) return;
  toggleEtym(word);
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
            <span class="count-pill" :style="{ background: colors[lv] + '22', color: titleColor(lv) }">{{ groups[lv].length }}</span>
          </h4>
          <div v-for="w in groups[lv]" :key="w.word" class="word"
            :class="{ 'has-etym': etym[w.word]?.html }"
            @click="onClickWord($event, w.word)">
            <span v-if="etym[w.word]?.html" class="etym-dot"
              :class="{ on: etym[w.word]?.open }"></span>
            <div class="w">{{ w.word }}</div>
            <div v-if="w.def" class="def">{{ w.def }}</div>
            <!-- capture+prevent：拦截词条 HTML 内的死链点击（/ciyuan/...），不导航 -->
            <div v-if="etym[w.word]?.open" class="etym-body" v-html="etym[w.word].html"
              @click.capture.prevent></div>
          </div>
        </div>
      </div>
    </div>
    <div class="side-resize-handle" title="拖拽调整宽度" @pointerdown="emit('resizestart', $event)"></div>
  </aside>
</template>
