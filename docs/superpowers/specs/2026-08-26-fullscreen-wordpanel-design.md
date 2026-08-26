# 全屏左滑打开生词栏 + 侧栏宽度分横竖屏保存

## 目标

1. 视频全屏时，视频区单指左滑（或鼠标按住左拖）打开右侧生词栏；右滑或点击栏外区域关闭；快捷键 `]` 全屏时同效切换。
2. 左右栏宽度按横屏/竖屏分别持久化；全屏生词栏是独立实例，宽度（`fsRight`）单独持久化。

## 设计

### 全屏生词栏（Teleport）

- App.vue 用 v-if 双分支挂两个 `<WordPanel>` 实例：普通布局一份原位；全屏时 Teleport 一份进 `.video-stage`（`isFsWord` 由 VideoStage 的 fullscreenchange 事件载荷驱动）。不用 `<Teleport :disabled>` 切换——disabled 搬移节点会触发 Vue moveTeleport 的 null 容器崩溃，重挂走全新 mount 路径无此问题。
- 开关状态 `wordOpen` 由 VideoStage 持有（defineModel 与 App 双向），进遮罩 `.fs-word-scrim` 点栏外收起；退全屏自动收起。
- 不碰 useLayout 的 rightOv（窄屏三栏互斥语义，不混入全屏）。

### 手势

- gestures.js 新增 `createSwipeRecognizer`（单指、纯几何）：pointerup 时水平位移 ≥60px 且 |dx|>|dy| 判左滑/右滑；小于阈值不拦截（保住"点视频显隐控件"与播控药丸拖动）。
- 绑在 `.video-stage`，仅全屏生效：左滑开、右滑关；识别为滑动后吞掉紧跟的 click（不误切控件层）。

### 宽度分横竖屏

- localStorage `subtap-widths` 改为 `{landscape:{left,right}, portrait:{left,right}, fsRight}`，旧格式不兼容、直接删。
- `leftWidth/rightWidth` 指向当前方向的值；orientation change 时切换并夹到视窗内；拖拽结束写回当前方向。
- 全屏生词栏是独立实例（v-if 双分支，各 new 一个），宽度 `fsRight` 单独存（全屏基本恒为锁定的横屏，不分横竖）；由 VideoStage 的 stage 上绑定 `--panel-right-w` 覆盖继承值。

## 不做的

- 全屏内左栏（设置面板）。

## 验收点（用户手测）

- 全屏：视频区左滑出右栏、右滑/点外/`]` 收起与切换；播控药丸拖动、"点视频显隐控件"不受影响。
- 横竖屏各拖一次左右栏宽度，转屏后各自记忆；全屏生词栏宽度独立记忆，与普通右栏互不影响。
