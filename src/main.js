import { createApp } from 'vue';
import App from './App.vue';
import './styles.css';
import '@fortawesome/fontawesome-free/css/all.min.css';

createApp(App).mount('#app');

// 请求持久化存储,防止浏览器在存储压力下清掉 PWA 预缓存(清掉后只能全走网络,GitHub Pages 慢则打开极慢)。
navigator.storage?.persist?.();

