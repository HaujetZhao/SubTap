import { reactive } from 'vue';

// toast 队列:自动消失的状态消息(成功/错误均 2.5s),hover 暂停,点击立即关。
// 框架相关的独立小机器,App 只取返回值绑模板。
export function createToasts() {
  const toasts = reactive([]);
  let seq = 0;

  function notify(message, type = 'success') {
    // 相同文案的 toast 先关掉旧的,避免连续点击堆叠一串(如未载媒体时连点句子)
    for (let i = toasts.length - 1; i >= 0; i--) {
      if (toasts[i].message === message) {
        clearTimeout(toasts[i].timer);
        toasts.splice(i, 1);
      }
    }
    const t = { id: ++seq, message, type, key: 0 };
    toasts.push(t);
    t.key++;                        // 触发进度条动画重启
    t.timer = setTimeout(() => dismiss(t.id), 2500);
  }
  function dismiss(id) {
    const i = toasts.findIndex(x => x.id === id);
    if (i < 0) return;
    clearTimeout(toasts[i].timer);
    toasts.splice(i, 1);
  }
  function pause(t) {
    clearTimeout(t.timer);
  }
  function resume(t) {
    if (!toasts.find(x => x.id === t.id)) return;   // 已被关闭,不再重设定时器
    t.key++;                        // 重启进度条动画
    t.timer = setTimeout(() => dismiss(t.id), 2500);
  }
  function dispose() {              // 卸载时清掉所有计时器
    toasts.forEach(t => clearTimeout(t.timer));
    toasts.splice(0);
  }

  return { toasts, notify, dismiss, pause, resume, dispose };
}
