# FAB 闲置自动半透明 · 设计文档

## 问题

手机窄屏上，左右两侧悬浮唤出按钮（FAB）固定在视口顶部两侧（`top: 16px`），
压在视频画面两个上角，遮挡内容。

## 选型

不绑定播放状态（否则每点一句就闪一次），而是**闲置超时自动半透明**：

- FAB 全可见 → 用户停止交互 ~4 秒 → 自动淡成半透明
- 用户再次交互（移动/触摸/按键/悬停 FAB）→ 立即恢复全可见，重新计时
- 半透明时仍可点击，不影响功能

## 设计

### 闲置计时器

- `App.vue` 新增 `idleTimer` ref + `fabIdle` ref（boolean）
- 页面挂载后启动一个 `setTimeout`，4 秒后设 `fabIdle = true`
- 用户在以下交互时**重置计时器、设 `fabIdle = false`**：
  - `document` 的 `mousemove`（防抖 300ms，避免高频触发）
  - `document` 的 `touchstart`
  - `document` 的 `keydown`
  - FAB 按钮本身的 `mouseenter`（悬停立即恢复）
- 组件卸载时清理计时器

### CSS

新增 `.float-btn.idle` 规则：

```css
.float-btn.idle {
  opacity: 0.25;
  transform: scale(0.85);
  transition: opacity .8s ease, transform .8s ease;
}
```

恢复时用较快过渡：

```css
.float-btn {
  transition: opacity .2s ease, transform .2s ease,
              box-shadow .15s;
}
```

优先级处理：`.float-btn.idle` 的 `opacity: 0.25` 需覆盖现有 `.layout:not(.left-pinned) .float-btn-left` 等规则中的 `opacity: 1`，通过选择器具体性实现。

### 事件绑定与清理

- `onMounted` 中绑定事件、启动计时器
- `onUnmounted` 中解绑事件、清理计时器

### 边界情况

- **原有 pinned/overlay 逻辑优先**：当侧栏 pinned 或 overlay 展开时，FAB 已隐藏（`opacity: 0; pointer-events: none`），`.idle` 不产生影响
- **半透明仍可点击**：`pointer-events: auto` 保持（默认值），不影响 `toggleFab` 功能
- **无障碍**：半透明不影响键盘/屏幕阅读器操作

## 改动清单

| 文件 | 改动 |
|------|------|
| `src/App.vue` | 新增 ~20 行 JS（ref、事件绑定、计时器、清理） |
| `src/styles.css` | 新增 ~10 行 CSS（`.float-btn.idle` 规则 + `transition` 调整） |
