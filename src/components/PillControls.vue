<script setup>
// 播控三按钮(上一句/暂停-重播/下一句):全屏播控药丸与底部控制条共用。
// guard 为 App 层的 guardPillClick(吞拖拽后的误点 + 点击后去焦点)。
defineProps({ disabled: Boolean, playing: Boolean, guard: { type: Function, required: true } });
const emit = defineEmits(['prev', 'toggle', 'next']);
</script>

<template>
  <button class="vc-big" title="上一句" :disabled="disabled" @click="guard(() => emit('prev'), $event)"><i class="fas fa-chevron-up"></i></button>
  <button class="vc-big" :title="playing ? '暂停' : '重播'" :disabled="disabled" @click="guard(() => emit('toggle'), $event)">
    <i :class="playing ? 'fas fa-stop' : 'fas fa-play'"></i>
  </button>
  <button class="vc-big" title="下一句" :disabled="disabled" @click="guard(() => emit('next'), $event)"><i class="fas fa-chevron-down"></i></button>
</template>
