<script setup>
defineProps({ toasts: { type: Array, required: true } });
defineEmits(['dismiss', 'pause', 'resume']);
</script>
<template>
  <div class="toast-container">
    <div v-for="t in toasts" :key="t.id" class="toast" :class="t.type"
         @click="$emit('dismiss', t.id)"
         @mouseenter="$emit('pause', t)" @mouseleave="$emit('resume', t)">
      <span class="ico"><i :class="t.type === 'error' ? 'fas fa-xmark' : 'fas fa-check'"></i></span>
      <span class="msg">{{ t.message }}</span>
      <span class="dismiss"><i class="fas fa-xmark"></i></span>
      <span :key="t.key" class="bar"></span>
    </div>
  </div>
</template>
