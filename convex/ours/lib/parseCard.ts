// Extracts a short "intro" blurb from a card.md so the town UI can show
// a one-paragraph self-introduction instead of dumping the entire card.
//
// Convention (any of these works; we try in order):
//   1. YAML frontmatter:
//        ---
//        intro: 我是一个咖啡店老板，喜欢爵士乐。
//        ---
//   2. Heading section: a level-2 heading matching any of
//        简介 | 自我介绍 | 介绍 | Intro | Introduction | About | Bio
//      Content = first non-empty paragraph under that heading.
//   3. Fallback: first non-empty paragraph that isn't a heading.
//   4. Final fallback: empty string (caller decides what to do).
//
// The full markdown stays the LLM-facing persona; intro is for UI only.

const HEADING_NAMES = new Set([
  '简介', '自我介绍', '介绍', '一句话定位',
  'intro', 'introduction', 'about', 'bio',
]);

// Lines like `family: celebrity`, `name: cheli-zi description: |`,
// `pseudonym: 阿朕` — ascii key + colon at the start. These have
// leaked from frontmatter blocks of concatenated cards and must not
// be picked up as intro content.
function isYamlLeak(line: string): boolean {
  return /^[a-z][a-z0-9_-]*\s*:\s*\S/i.test(line);
}

// Lines like `[当前小镇事件: 下雨了]` — engine event injections that
// have ended up in some cards. Reject anything wrapped entirely in
// square brackets.
function isBracketTag(line: string): boolean {
  return /^\[.+\]$/.test(line);
}

// After dropping yaml-leak lines, does the remaining text look like
// real prose? Require at least a Chinese sentence character, or
// sentence-ending punctuation, or a reasonably long string of
// non-ascii content.
function looksLikeProse(s: string): boolean {
  const t = s.trim();
  if (!t) return false;
  // Sentence-ending punctuation
  if (/[。！？!?]/.test(t)) return true;
  // 6+ Chinese characters total in the string
  const chinese = t.match(/[一-鿿]/g);
  if (chinese && chinese.length >= 6) return true;
  // Reasonable English prose
  if (/\s/.test(t) && t.length >= 20 && !/^[a-z][a-z0-9_-]*\s*:/i.test(t)) return true;
  return false;
}

const MAX_INTRO_CHARS = 400;

export function parseIntro(markdown: string): string {
  const allLines = markdown.split(/\r?\n/);

  // 1. ANY line in the doc matching `^intro:` (case-insensitive).
  // Some cards have been concatenated through multiple re-uploads, so
  // the canonical `intro:` may live in the second or third frontmatter
  // block — scan everything and take the LAST one (likely the most
  // recent definitive version).
  let bestIntro: string | null = null;
  for (const raw of allLines) {
    const m = raw.match(/^intro\s*:\s*(?:["'](.*?)["']|(.+?))\s*$/i);
    if (!m) continue;
    const value = (m[1] ?? m[2] ?? '').trim();
    if (value) bestIntro = value;
  }
  if (bestIntro) return truncate(bestIntro);

  // 2. Known heading section. Look at every occurrence; pick the first
  // one whose body looks like real prose (after dropping YAML-leak
  // lines).
  for (let i = 0; i < allLines.length; i++) {
    const line = allLines[i] ?? '';
    const h = line.match(/^##\s+(.+?)\s*$/);
    if (!h || !h[1]) continue;
    if (!HEADING_NAMES.has(h[1].toLowerCase().trim())) continue;
    const para: string[] = [];
    for (let j = i + 1; j < allLines.length; j++) {
      const l = (allLines[j] ?? '').trim();
      if (!l) {
        if (para.length) break;
        continue;
      }
      if (l.startsWith('#')) break;
      if (l.startsWith('---')) continue;
      if (isYamlLeak(l)) continue;
      if (isBracketTag(l)) continue;
      para.push(l);
    }
    if (para.length) {
      const joined = para.join(' ');
      if (looksLikeProse(joined)) return truncate(joined);
    }
  }

  // 3. First prose-looking paragraph that isn't inside a frontmatter
  // block. Drop YAML-leak lines too.
  let inFence = false;
  const para: string[] = [];
  for (const raw of allLines) {
    const l = raw.trim();
    if (l === '---') {
      inFence = !inFence;
      if (para.length) break;
      continue;
    }
    if (inFence) continue;
    if (!l) {
      if (para.length) break;
      continue;
    }
    if (l.startsWith('#')) continue;
    if (isYamlLeak(l)) continue;
    if (isBracketTag(l)) continue;
    para.push(l);
  }
  if (para.length) {
    const joined = para.join(' ');
    if (looksLikeProse(joined)) return truncate(joined);
  }

  return '';
}

function truncate(s: string): string {
  if (s.length <= MAX_INTRO_CHARS) return s;
  return s.slice(0, MAX_INTRO_CHARS - 1).trimEnd() + '…';
}
