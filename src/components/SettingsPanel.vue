<script setup>
import { computed } from 'vue';
import { LEVEL_COLORS } from '../level-colors.js';

const props = defineProps({
  levels: { type: Array, required: true },
  enabled: { type: Object, required: true },
  offset: { type: Number, default: 0 },
  endMode: { type: String, default: 'extend' },     // 'extend' | 'linkNext'
  endOffset: { type: Number, default: 0 },
  highlightOn: { type: Boolean, default: true },
  ttsOn: { type: Boolean, default: false },
  controlBarOn: { type: Boolean, default: true },
  ttsLang: { type: String, default: 'en-US' },
  ttsRate: { type: Number, default: 1 },
  // 注意:prop 名必须叫 ttsVoiceUri(对应父级 :tts-voice-uri)。
  // 若叫 ttsVoiceURI,Vue 的 kebab 归并会把 tts-voice-uri 解析成 ttsVoiceUri 而非 ttsVoiceURI,
  // 导致 prop 拿不到值、声音 select 一直显示"默认"。
  ttsVoiceUri: { type: String, default: '' },
  voices: { type: Array, default: () => [] },
  theme: { type: String, default: 'light' },   // 'light' | 'dark'
  hasSrt: { type: Boolean, default: false },
  srtFromFile: { type: Boolean, default: false },   // 用户载入的外部字幕(VAD 生成的句子不算)
  hasMedia: { type: Boolean, default: false },
  vadHasProbs: { type: Boolean, default: false },
  vadGen: { type: Object, default: null },   // { doneSec, dur, ready, dlDone, dlTotal } | null,null = 空闲
  vadThreshold: { type: Number, default: 0.6 },
  vadMinSpeech: { type: Number, default: 0.2 },
  vadMinSilence: { type: Number, default: 0.1 }
});
const emit = defineEmits(['toggle-level', 'srt-file', 'media-file', 'clear-srt', 'clear-media', 'vad-run', 'tweak', 'toggle-highlight', 'toggle-control-bar', 'toggle-tts', 'set-theme', 'collapse', 'resizestart']);

// 当前语言对应的可选声音(按语言前缀过滤)
const ttsVoiceList = computed(() => {
  const prefix = props.ttsLang.split('-')[0];
  return props.voices.filter(v => v.lang.split('-')[0] === prefix);
});
// 注意:声音 <select> 不能用 computed({get:set:}) 做 v-model 桥——
// Vue 3 的 vModelSelect 时序下,选中后显示会回退到默认(已实测复现)。
// 改用 :value + @change 直绑 prop。

function dotColor(lv) { return LEVEL_COLORS[lv] || '#9ca3af'; }

function onSrtChange(e) {
  const f = e.target.files[0];
  if (f) emit('srt-file', f);
  e.target.value = '';   // 允许重复选同一文件
}
function onMediaChange(e) {
  const f = e.target.files[0];
  if (f) emit('media-file', f);
  e.target.value = '';
}
function onTweak(key, val) {
  emit('tweak', key, val);
}
// 末尾处理模式循环切换:末尾延长 ↔ 句末衔接
function cycleEndMode() {
  emit('tweak', 'endMode', props.endMode === 'extend' ? 'linkNext' : 'extend');
}

// VAD 小节锁定:无媒体或已载外部字幕(按钮再叠加运行中)
const vadOff = computed(() => !props.hasMedia || props.srtFromFile);
</script>

<template>
  <aside class="panel-left">
    <div class="panel-inner">
      <div class="panel-head">
        <h3 class="panel-title">文件</h3>
        <button class="collapse-btn-panel" title="收起设置栏" @click="emit('collapse')"><i class="fas fa-chevron-left"></i></button>
      </div>
      <!-- 文件(置顶) -->
      <section class="files">
      <div class="file-row">
        <label class="file-btn">
          <span class="file-ico"><i class="fas fa-music"></i></span>
          打开音/视频
          <input type="file" accept="audio/*,video/*" @change="onMediaChange" />
        </label>
        <button class="file-clear" :disabled="!hasMedia" @click="emit('clear-media')"><i class="fas fa-xmark"></i><span class="tip">清除音/视频</span></button>
      </div>
      <div class="file-row">
        <label class="file-btn alt">
          <span class="file-ico"><i class="fas fa-file-lines"></i></span>
          打开字幕
          <input type="file" accept=".srt,.vtt,.ass,.ssa,.sub,.sbv,.smi" @change="onSrtChange" />
        </label>
        <button class="file-clear" :disabled="!hasSrt" @click="emit('clear-srt')"><i class="fas fa-xmark"></i><span class="tip">清除字幕</span></button>
      </div>
      </section>

    <!-- 词库分级 -->
    <section class="settings">
      <h3 class="panel-title">词库分级</h3>
      <div class="levels">
        <label v-for="lv in levels" :key="lv" class="level-chip" :class="{ off: !enabled[lv] }">
          <input type="checkbox" class="sr-only" :checked="enabled[lv]"
                 @change="emit('toggle-level', lv, $event.target.checked)" />
          <span class="dot" :style="{ background: dotColor(lv) }"></span>
          <span class="label-text">{{ lv }}</span>
        </label>
      </div>
    </section>

    <!-- 功能开关 -->
    <section class="toggles">
      <h3 class="panel-title">功能开关</h3>
      <label class="level-pill" :class="{ off: theme !== 'dark' }">
        <input type="checkbox" class="sr-only" :checked="theme === 'dark'"
               @change="emit('set-theme', $event.target.checked ? 'dark' : 'light')" />
        <span class="dot muted"></span>
        <span class="label-text">暗色模式</span>
        <span class="switch" aria-hidden="true"></span>
      </label>
      <label class="level-pill" :class="{ off: !highlightOn }">
        <input type="checkbox" class="sr-only" :checked="highlightOn"
               @change="emit('toggle-highlight', $event.target.checked)" />
        <span class="dot muted"></span>
        <span class="label-text">词汇提示</span>
        <span class="switch" aria-hidden="true"></span>
        <span class="tip">用背景色高亮句中生词</span>
      </label>
      <label class="level-pill" :class="{ off: !controlBarOn }">
        <input type="checkbox" class="sr-only" :checked="controlBarOn"
               @change="emit('toggle-control-bar', $event.target.checked)" />
        <span class="dot muted"></span>
        <span class="label-text">控制条</span>
        <span class="switch" aria-hidden="true"></span>
        <span class="tip">非全屏时显示底部药丸控制条</span>
      </label>
      <label class="level-pill" :class="{ off: !ttsOn }">
        <input type="checkbox" class="sr-only" :checked="ttsOn"
               @change="emit('toggle-tts', $event.target.checked)" />
        <span class="dot muted"></span>
        <span class="label-text">语音朗读</span>
        <span class="switch" aria-hidden="true"></span>
        <span class="tip">无音视频时点句朗读</span>
      </label>
      <div v-if="ttsOn" class="sub-options">
        <label class="opt-row">
          <span class="opt-name">语言</span>
          <select class="opt-select" :value="ttsLang"
                  @change="onTweak('ttsLang', $event.target.value); onTweak('ttsVoiceURI', '')">
            <option value="en-US">英语(美)</option>
            <option value="en-GB">英语(英)</option>
            <option value="zh-CN">中文</option>
            <option value="ja-JP">日语</option>
            <option value="ko-KR">韩语</option>
            <option value="fr-FR">法语</option>
            <option value="de-DE">德语</option>
          </select>
        </label>
        <label class="opt-row">
          <span class="opt-name">声音</span>
          <select class="opt-select" :value="ttsVoiceUri"
                  @change="onTweak('ttsVoiceURI', $event.target.value)">
            <option value="">默认</option>
            <option v-for="v in ttsVoiceList" :key="v.voiceURI" :value="v.voiceURI">{{ v.name }}</option>
          </select>
        </label>
        <div class="opt-row">
          <span class="opt-name">语速</span>
          <span class="opt-ctrl">
            <input type="range" class="opt-range" min="0.5" max="2" step="0.1"
                   :value="ttsRate" @input="onTweak('ttsRate', parseFloat($event.target.value))" />
            <span class="opt-val">{{ ttsRate.toFixed(1) }}</span>
          </span>
        </div>
      </div>
    </section>

    <!-- 字幕微调 -->
    <section class="tweak">
      <h3 class="panel-title">字幕微调</h3>
      <label class="tweak-row">句首偏移
        <input type="number" min="-10" max="10" step="0.1" :value="offset"
               @change="onTweak('offset', parseFloat($event.target.value) || 0)" />
      </label>
      <!-- 句末处理:点击文字/箭头在「句末偏移 ↔ 句末衔接」间切换,共用一个偏移输入 -->
      <div class="tweak-row">
        <span class="mode-toggle" @click="cycleEndMode">{{ endMode === 'linkNext' ? '句末衔接' : '句末偏移' }}<span class="cycle-icon" aria-hidden="true"><i class="fas fa-arrow-right-arrow-left"></i></span><span class="tip">{{ endMode === 'linkNext' ? '衔接到下一句开头' : '句末时间戳偏移' }}</span></span>
        <input type="number" min="-5" max="5" step="0.1" :value="endOffset"
               @change="onTweak('endOffset', parseFloat($event.target.value) || 0)" />
      </div>
    </section>

    <!-- VAD 分段(常驻;无媒体时禁用):推理一次,概率留存,改参数即时重切 -->
    <section class="tweak vad">
      <h3 class="panel-title">VAD 分段</h3>
      <button class="empty-sample-btn vad-run-btn" :disabled="vadOff || !!vadGen" @click="emit('vad-run')">
        <span v-if="vadGen" class="vad-run-fill" :style="{ width: vadGen.dur ? (vadGen.doneSec / vadGen.dur * 100) + '%' : '0%' }"></span>
        <span class="vad-run-label">
          <template v-if="!vadGen">{{ vadHasProbs ? '重新分段' : '推理分段' }}</template>
          <template v-else-if="!vadGen.dur">解码音频中…</template>
          <template v-else-if="!vadGen.ready && !vadGen.dlReady">下载推理组件…{{ vadGen.dlTotal ? ' ' + (vadGen.dlDone / 1048576).toFixed(1) + '/' + (vadGen.dlTotal / 1048576).toFixed(1) + 'MB' : '' }}</template>
          <template v-else>{{ Math.round(vadGen.doneSec) }}/{{ Math.round(vadGen.dur) }}s</template>
        </span>
      </button>
      <label class="tweak-row" :class="{ dim: vadOff }">阈值
        <input type="number" min="0.1" max="0.9" step="0.05" :value="vadThreshold" :disabled="vadOff"
               @change="onTweak('vadThreshold', parseFloat($event.target.value) || 0.6)" />
      </label>
      <label class="tweak-row" :class="{ dim: vadOff }">最短语音(s)
        <input type="number" min="0" max="2" step="0.1" :value="vadMinSpeech" :disabled="vadOff"
               @change="onTweak('vadMinSpeech', parseFloat($event.target.value) || 0.2)" />
      </label>
      <label class="tweak-row" :class="{ dim: vadOff }">最短静音(s)
        <input type="number" min="0" max="2" step="0.05" :value="vadMinSilence" :disabled="vadOff"
               @change="onTweak('vadMinSilence', parseFloat($event.target.value) || 0.1)" />
      </label>
    </section>

        </div>
    <div class="side-resize-handle" title="拖拽调整宽度" @pointerdown="emit('resizestart', $event)"></div>
  </aside>
</template>
