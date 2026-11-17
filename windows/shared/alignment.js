import { spokenTokens } from './script-model.js';

const HEARD_WINDOW = 32;
const LOOK_BACK = 24;
const LOOK_FORWARD = 180;
const COMMON = new Set([
  'alors', 'aussi', 'avec', 'bien', 'cela', 'celle', 'celles', 'ceci', 'cette', 'chez', 'comme',
  'dans', 'depuis', 'donc', 'encore', 'entre', 'etre', 'faire', 'fait', 'ici', 'leur', 'leurs',
  'mais', 'meme', 'notre', 'nous', 'peut', 'plus', 'pour', 'puis', 'quand', 'sans', 'sont',
  'tout', 'tous', 'tres', 'vers', 'voila', 'votre', 'vous'
]);

function informative(word) {
  return word.length >= 4 && !COMMON.has(word);
}

function atMostOneEdit(a, b) {
  if (Math.abs(a.length - b.length) > 1) return false;
  if (a.length > b.length) [a, b] = [b, a];
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length === b.length) i++;
    j++;
  }
  return edits + b.length - j <= 1;
}

function enoughEvidence(path, heard, position, length, { final, waiting, connected }) {
  if (path.matches === 1) {
    const word = heard[path.lastHeard];
    const atEnd = position === length - 1;
    return path.firstScript === position && path.exact === 1 && heard.length === 1
      && (atEnd && final || !waiting && informative(word) && (final || connected && word.length >= 5));
  }

  const distance = path.firstScript - position;
  const heardCoverage = path.matches / (path.lastHeard - path.firstHeard + 1);
  const scriptCoverage = path.matches / (path.end - path.firstScript);
  if (heardCoverage < .66 || scriptCoverage < .55) return false;
  if (!path.keywords.length) {
    return final && distance === 0 && path.end === length && path.exact === length - position
      && path.exact === heard.length;
  }
  if (distance <= 2) {
    if (waiting) return path.exact >= 3 || path.keywords.length >= 2;
    return path.exact >= 2 || (path.exact >= 1 && path.matches >= 3 && connected);
  }
  if (distance <= 12) {
    return path.exact >= 3 && (path.keywords.length >= 2 || path.exact >= 4);
  }
  const minimum = distance <= 58 ? 4 : 6;
  return path.exact >= minimum && path.keywords.length >= (distance <= 58 ? 2 : 3)
    && path.longest >= 3 && heardCoverage >= .75 && scriptCoverage >= .73;
}

function findMatch(script, position, heard, options) {
  const from = Math.max(0, position - LOOK_BACK);
  const to = Math.min(script.length, position + LOOK_FORWARD);
  const cells = [];
  const candidates = new Map();

  for (let i = 0; i < heard.length; i++) {
    const row = new Array(to - from);
    cells.push(row);
    const word = heard[i];
    for (let j = 0; j < row.length; j++) {
      const current = script[from + j];
      const exact = word === current;
      if (!exact && !(word.length >= 5 && current.length >= 5 && word[0] === current[0] && atMostOneEdit(word, current))) continue;

      // Bridge a missing script word or a short recognition error. An
      // unrelated sentence breaks the path and lets a new local match start.
      let prior;
      let previousScore = 0;
      let adjacent = false;
      for (let dh = 1; dh <= 2 && dh <= i; dh++) {
        for (let ds = 1; ds <= 4 && ds <= j; ds++) {
          const choice = cells[i - dh][j - ds];
          if (!choice) continue;
          if (choice.end <= position && from + j >= position && (dh !== 1 || ds !== 1)) continue;
          const score = choice.score - (dh - 1) * 2.1 - (ds - 1) * 1.25;
          if (score > previousScore) {
            prior = choice;
            previousScore = score;
            adjacent = dh === 1 && ds === 1 && choice.lastExact;
          }
        }
      }

      const keyword = exact && informative(word);
      let keywords = prior?.keywords || [];
      if (keyword && !keywords.includes(word)) keywords = [...keywords, word];
      const run = exact ? (adjacent ? prior.run + 1 : 1) : 0;
      const path = {
        firstHeard: prior?.firstHeard ?? i, lastHeard: i,
        firstScript: prior?.firstScript ?? from + j, end: from + j + 1,
        matches: (prior?.matches || 0) + 1, exact: (prior?.exact || 0) + Number(exact),
        lastExact: exact, keywords, run, longest: Math.max(prior?.longest || 0, run),
        score: previousScore + (exact ? (keyword ? 3.5 : 2) : 1.1)
      };
      row[j] = path;
      if (!enoughEvidence(path, heard, position, script.length, options)) continue;
      const proof = path.score - (heard.length - 1 - i) * .32;
      const rank = proof - Math.min(9, Math.abs(path.firstScript - position) * .13);
      const key = path.firstScript;
      if (rank > (candidates.get(key)?.rank ?? -Infinity)) candidates.set(key, { ...path, proof, rank });
    }
  }

  const ordered = [...candidates.values()].sort((a, b) => b.rank - a.rank || a.end - b.end);
  const best = ordered.find(path => path.end > position);
  if (!best) return null;

  if (best.firstScript > position) {
    const repeated = ordered.some(path => path.end <= position && path.lastHeard === best.lastHeard
      && path.firstHeard <= best.firstHeard && path.proof >= best.proof - .65);
    if (repeated) return null;
  }
  if (best.firstScript > position + 12) {
    const ambiguous = ordered.some(path => path !== best && path.lastHeard === best.lastHeard
      && (path.firstScript >= best.end || best.firstScript >= path.end)
      && path.proof >= best.proof - .95);
    if (ambiguous) return null;
  }
  return best;
}

export function matchUtterance(script, position, text, final) {
  const heard = spokenTokens(text).slice(-HEARD_WINDOW);
  return findMatch(script, position, heard, { final, waiting: false, connected: false })?.end ?? position;
}

export class VoiceAlignment {
  reset(position) {
    this.position = Math.floor(position);
    this.clearUtterance();
    this.pending = [];
    this.waiting = false;
  }

  clearUtterance() {
    this.committed = 0;
    this.boundary = [];
    this.previous = '';
  }

  resync() {
    this.clearUtterance();
    this.pending = [];
    this.waiting = true;
  }

  consumed(heard) {
    if (!this.committed) return 0;
    // A Vosk partial is a mutable hypothesis for the whole utterance. Match
    // the last committed words near their original offset if it changes.
    const length = this.boundary.length;
    const offsets = [0, -1, 1, -2, 2, -3, 3, -4, 4];
    for (const offset of offsets) {
      const end = this.committed + offset;
      if (end < length || end > heard.length) continue;
      if (length < 2 && offset) continue;
      if (this.boundary.every((word, i) => heard[end - length + i] === word)) {
        return end;
      }
    }
    if (length >= 3) {
      for (const offset of offsets) {
        const end = this.committed + offset;
        for (const span of [length, length + 1, length - 1]) {
          if (end < span || end > heard.length) continue;
          if (atMostOneEdit(this.boundary, heard.slice(end - span, end))) return end;
        }
      }
    }
    return Math.min(this.committed, heard.length);
  }

  update(script, text, final) {
    if (this.position >= script.length || (!final && (!text || text === this.previous))) return this.position;
    const heard = spokenTokens(text);
    const cut = this.consumed(heard);
    const current = heard.slice(cut);
    if (final && current.length === 1 && this.position === script.length - 1 && current[0] === script[this.position]) {
      this.pending = [];
    }
    let fresh = this.pending.concat(current);
    const offset = Math.max(0, fresh.length - HEARD_WINDOW);
    const latest = fresh.slice(offset);
    const match = findMatch(script, this.position, latest, {
      final, waiting: this.waiting, connected: cut > 0 && !this.pending.length && offset === 0
    });

    if (match) {
      this.position = match.end;
      const next = offset + match.lastHeard + 1;
      const newCut = cut + Math.max(0, next - this.pending.length);
      this.committed = newCut;
      this.boundary = heard.slice(Math.max(0, newCut - 4), newCut);
      this.pending = [];
      fresh = fresh.slice(next);
      this.waiting = false;
    }
    if (fresh.length >= 3 || (final && fresh.length >= 2)) this.waiting = true;
    if (final) {
      this.pending = fresh.slice(-3);
      this.clearUtterance();
    } else {
      this.previous = text;
    }
    return this.position;
  }
}
