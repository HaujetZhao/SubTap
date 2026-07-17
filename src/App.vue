<script setup>
import SettingsPanel from './components/SettingsPanel.vue';
import SentenceList from './components/SentenceList.vue';
import WordPanel from './components/WordPanel.vue';
</script>

<template>
  <div class="layout">
    <SettingsPanel />
    <main class="panel-center">
      <div class="video-slot"></div>
      <SentenceList />
      <span class="status">请选择文件</span>
    </main>
    <WordPanel />
  </div>
  <audio class="hidden" preload="metadata"></audio>
</template>
