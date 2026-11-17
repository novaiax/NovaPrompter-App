const timeline = /^\s*(?:\d{1,2}:)?\d{1,2}:\d{2}(?:[.,]\d{2,3})?\s+-->\s+(?:\d{1,2}:)?\d{1,2}:\d{2}(?:[.,]\d{2,3})?(?:\s+.*)?$/;

export function cleanScript(text, { timestamps = true, formatting = true, spacing = true } = {}) {
  if (!timestamps && !formatting && !spacing) return text;
  let lines = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n');
  if (timestamps) {
    lines = lines.filter((line, index) => {
      if (timeline.test(line) || (index === 0 && /^WEBVTT\b/.test(line))) return false;
      if (index + 1 < lines.length && timeline.test(lines[index + 1])) {
        if (/^\s*\d+\s*$/.test(line)) return false;
        if (/^WEBVTT\b/.test(lines[0]) && (index === 0 || !lines[index - 1].trim())) return false;
      }
      return true;
    }).map(line => line
      .replace(/^\s*\[(?:\d{1,2}:)?\d{1,2}:\d{2}(?:[.,]\d{2,3})?\]\s*/, '')
      .replace(/<\d{2}:\d{2}:\d{2}\.\d{3}>/g, ''));
  }
  if (formatting) {
    lines = lines.map(line => line
      .replace(/^\s*`{3,}(?:[\w-]+)?\s*$/, '')
      .replace(/^\s*(?:[-*_]\s*){3,}$/, '')
      .replace(/^\s{0,3}#{1,6}\s+/, '')
      .replace(/^\s*(?:>\s*)+/, '')
      .replace(/^\s*[-*+]\s+(?:\[[ xX]\]\s+)?/, '')
      .replace(/!?\[([^\]]+)\]\((?:https?:\/\/|mailto:)[^)\s]+\)/gi, '$1')
      .replace(/(\*\*|__|~~|`)(\S(?:.*?\S)?)\1/g, '$2')
      .replace(/(^|[\s(])([*_])(\S(?:.*?\S)?)\2(?=$|[\s.,!?:;)])/g, '$1$3')
      .replace(/<\/?(?:i|b|u|em|strong|c|v)(?:[ .][^<>]*)?>/gi, '')
      .replaceAll('&nbsp;', ' '));
  }
  const output = lines.join('\n');
  return spacing
    ? output.replace(/[\u200B\uFEFF]/g, '').replace(/[ \t]+/g, ' ')
      .replace(/^ +| +$/gm, '').replace(/\n{3,}/g, '\n\n').trim()
    : output;
}
