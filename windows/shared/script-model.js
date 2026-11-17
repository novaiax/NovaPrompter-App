export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export function spokenTokens(text) {
  return text.toLocaleLowerCase('fr').normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replaceAll('œ', 'oe')
    .replaceAll('æ', 'ae')
    .match(/[\p{L}\p{N}]+/gu) || [];
}

// The editor, the reader and the recognizer share these positions.
export function buildScript(text, tags = []) {
  const markers = new Map(tags.map(tag => [tag.name, tag]));
  const parts = [];
  const tokens = [];
  const pauses = [];
  let words = 0;
  const pattern = /\[[\w-]+\]|[\p{L}\p{N}][\p{L}\p{M}\p{N}]*(?:[’'\-‑][\p{L}\p{M}\p{N}]+)*|[^\p{L}\p{M}\p{N}\[]+|./gu;
  for (const [value] of text.matchAll(pattern)) {
    const cue = value.startsWith('[') && markers.get(value.slice(1, -1));
    if (cue) {
      parts.push({ cue, start: tokens.length });
      if (cue.pause > 0) pauses.push({ at: tokens.length, seconds: cue.pause });
      continue;
    }
    const spoken = spokenTokens(value);
    if (!spoken.length) {
      const previous = parts.at(-1);
      if (previous && previous.start === undefined) previous.text += value;
      else parts.push({ text: value });
      continue;
    }
    const start = tokens.length;
    tokens.push(...spoken);
    words++;
    parts.push({ text: value, start, end: tokens.length });
  }
  return { parts, tokens, words, pauses };
}
