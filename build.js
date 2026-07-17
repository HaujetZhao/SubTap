// 把 index.html 引用的 styles.css 和 src/*.js 内联，输出 dist/index.html
const fs = require('fs');
const path = require('path');

const root = __dirname;
const distDir = path.join(root, 'dist');
if (!fs.existsSync(distDir)) fs.mkdirSync(distDir, { recursive: true });

let html = fs.readFileSync(path.join(root, 'index.html'), 'utf-8');

// 内联 <link rel="stylesheet" href="...">
html = html.replace(/<link[^>]*rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/g, (m, href) => {
  const css = fs.readFileSync(path.join(root, href), 'utf-8');
  return '<style>\n' + css + '\n</style>';
});

// 内联 <script src="...">（仅本地相对路径，不含 http）
html = html.replace(/<script src="([^"]+)"><\/script>/g, (m, src) => {
  if (/^https?:/.test(src)) return m;
  const code = fs.readFileSync(path.join(root, src), 'utf-8');
  return '<script>\n' + code + '\n</script>';
});

const outPath = path.join(distDir, 'index.html');
fs.writeFileSync(outPath, html, 'utf-8');
console.log('已生成 ' + outPath + ' (' + html.length + ' 字节)');
