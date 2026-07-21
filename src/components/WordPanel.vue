<script setup>
import { computed } from 'vue';

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

function titleColor(lv) { return props.colors[lv] || '#2563eb'; }
</script>

<template>
  <aside class="panel-right">
    <div class="panel-inner">
      <div class="panel-head">
        <h3 class="panel-title">生词</h3>
        <button class="collapse-btn-panel" title="收起词卡栏" @click="emit('collapse')">〉</button>
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
          <div v-for="w in groups[lv]" :key="w.word" class="word">
            <div class="w">{{ w.word }}</div>
            <div v-if="w.def" class="def">{{ w.def }}</div>
          </div>
        </div>
      </div>
    </div>
    <div class="side-resize-handle" title="拖拽调整宽度" @pointerdown="emit('resizestart', $event)"></div>
  </aside>
</template>
