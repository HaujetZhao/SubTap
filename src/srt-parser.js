(function (App) {
  'use strict';

  // 把 "HH:MM:SS,mmm" 或 "HH:MM:SS.mmm" 转成秒（浮点）
  function timestampToSeconds(ts) {
    var m = /^(\d{2}):(\d{2}):(\d{2})[,.](\d{3})$/.exec(ts.trim());
    if (!m) return null;
    var h = parseInt(m[1], 10), min = parseInt(m[2], 10), s = parseInt(m[3], 10), ms = parseInt(m[4], 10);
    return h * 3600 + min * 60 + s + ms / 1000;
  }

  // SRT 文本 → Sentence[]
  function parseSRT(text) {
    // 统一换行，按空行分块
    var normalized = text.replace(/\r\n?/g, '\n').trim();
    var blocks = normalized.split(/\n\s*\n/);
    var sentences = [];

    for (var i = 0; i < blocks.length; i++) {
      var block = blocks[i].trim();
      if (!block) continue;

      var lines = block.split('\n');

      // 第一行若是纯数字（序号），跳过
      var idx = 0;
      if (/^\d+$/.test(lines[0].trim())) idx = 1;

      // 找时间轴行
      var timeLine = lines[idx];
      var tm = /^([\d:,.]+)\s*-->\s*([\d:,.]+)/.exec(timeLine.trim());
      if (!tm) continue; // 容错：格式不对的块跳过，不整体崩

      var start = timestampToSeconds(tm[1]);
      var end = timestampToSeconds(tm[2]);
      if (start === null || end === null) continue;

      // 文本部分（可能多行）
      var textLines = lines.slice(idx + 1);
      var text = textLines.join('\n').trim();

      sentences.push({ id: sentences.length + 1, start: start, end: end, text: text });
    }
    return sentences;
  }

  App.timestampToSeconds = timestampToSeconds;
  App.parseSRT = parseSRT;
})(window.App);
