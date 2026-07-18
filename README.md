# SubTap · 字幕点读器

> 点读式英语学习工具 —— 载入字幕 + 音视频，点任意句子播放对应片段，内置分级词库给生词按难度着色。先读句、再点听，主动学英语。

## 特性

- **点读播放** —— 点句子即播该句片段，到点自动停（切到后台 tab 也不漏停）
- **分级词库** —— 内置 7 级约 34000 词（初中 / 高中 / 四级 / 六级 / 考研 / 托福 / SAT），按难度给句中生词着色，右栏列出释义
- **多格式字幕** —— SRT / VTT / ASS / SSA / SUB / SBV / SMI（经 [subsrt](https://github.com/papnkukn/subsrt) 解析）
- **字幕微调** —— 起始偏移校准；末尾处理在「末尾延长 ↔ 句末衔接」间切换
- **纯前端单文件** —— 词库内置，可离线双击打开，也可托管到 GitHub Pages

## 用法

**直接用**（任选其一）：

- 在线用：访问 [SubTap Pages](https://haujetzhao.github.io/SubTap/dist/)
- 离线用：或下载 [`dist/index.html`](./dist/index.html)，双击打开

**本地开发**：

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # 产出单文件 dist/index.html
```

## 快捷键

| 键 | 作用 |
|---|---|
| `↑` / `↓` | 上一句 / 下一句 |
| `←` | 重读当前句 |
| `→` / `空格` | 停止播放 |

