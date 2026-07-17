// UI 渲染（纯 DOM 操作，无业务状态）

export function fmtTime(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
}

export function renderSentences(container, sentences, onClick) {
  container.innerHTML = '';
  for (const s of sentences) {
    const div = document.createElement('div');
    div.className = 'sentence';
    div.dataset.id = s.id;
    div.innerHTML =
      '<span class="play-icon">▶</span>' +
      '<span class="time">[' + fmtTime(s.start) + ']</span>' +
      '<span class="text"></span>';
    div.querySelector('.text').textContent = s.text.replace(/\n/g, ' ');
    div.addEventListener('click', () => onClick(s));
    container.appendChild(div);
  }
}

export function highlightSentence(container, id) {
  for (const el of container.querySelectorAll('.sentence')) {
    el.classList.toggle('active', String(el.dataset.id) === String(id));
  }
}

export function markPlaying(container, id, playing) {
  const el = container.querySelector('.sentence[data-id="' + id + '"]');
  if (!el) return;
  el.classList.toggle('playing', playing);
  el.querySelector('.play-icon').textContent = playing ? '⏸' : '▶';
}

// 设置面板：渲染分级勾选项（store 提供分级与状态）
export function renderSettings(container, store, onChange) {
  container.innerHTML = '';
  for (const level of store.getLevels()) {
    const label = document.createElement('label');
    label.className = 'level-item';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = store.isEnabled(level);
    cb.addEventListener('change', () => onChange(level, cb.checked));
    const span = document.createElement('span');
    span.textContent = level;
    label.appendChild(cb);
    label.appendChild(span);
    container.appendChild(label);
  }
}

// 右栏分栏：groups = {level: Word[]}；按 store 分级顺序渲染
export function renderWordGroups(container, store, groups) {
  let any = false;
  container.innerHTML = '';
  container.className = 'word-groups';

  for (const level of store.getLevels()) {
    const words = groups[level];
    if (!words || words.length === 0) continue;
    any = true;

    const group = document.createElement('div');
    group.className = 'word-group';
    const h4 = document.createElement('h4');
    h4.textContent = level + ' (' + words.length + ')';
    group.appendChild(h4);

    for (const w of words) {
      const div = document.createElement('div');
      div.className = 'word';
      const wspan = document.createElement('div');
      wspan.className = 'w';
      wspan.textContent = w.word;
      const dspan = document.createElement('div');
      dspan.className = 'def';
      dspan.textContent = w.def;
      div.appendChild(wspan);
      div.appendChild(dspan);
      group.appendChild(div);
    }
    container.appendChild(group);
  }

  if (!any) {
    container.className = 'placeholder';
    container.textContent = '当前句没有词库中的单词';
  }
}

export function setVocabStatus(text, isError) {
  const el = document.getElementById('vocab-status');
  if (!el) return;
  el.textContent = text;
  el.classList.toggle('error', !!isError);
  el.classList.toggle('placeholder', !isError);
}

export function setStatus(text, isError) {
  const el = document.getElementById('status');
  el.textContent = text;
  el.classList.toggle('error', !!isError);
}
