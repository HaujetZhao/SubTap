// 分级颜色映射（level → hex）。词背景用 hex+'26'（~15% 透明）；标题用纯 hex。
// 配色后续可在此集中微调。
export const LEVEL_COLORS = {
  '初中': '#16a34a',
  '高中': '#0891b2',
  '四级': '#2563eb',
  '六级': '#7c3aed',
  '考研': '#ea580c',
  '托福': '#dc2626',
  'SAT': '#db2777',
  '超纲': '#6b7280'
};

// token 着色：亮色=级别色半透明背景；暗色=前景色 color-mix 向白混（黑底上纯色偏暗，亮且保色调）
export function tokStyle(tok, { colors, enabled, highlightOn, dark = false }) {
  if (!highlightOn || !tok.level || !enabled[tok.level]) return {};
  return dark
    ? { color: `color-mix(in srgb, ${colors[tok.level]} 55%, white)` }
    : { backgroundColor: colors[tok.level] + '26' };
}
