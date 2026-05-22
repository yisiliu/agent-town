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
  '简介', '自我介绍', '介绍',
  'intro', 'introduction', 'about', 'bio',
]);

const MAX_INTRO_CHARS = 400;

export function parseIntro(markdown: string): string {
  const trimmed = markdown.trimStart();

  // 1. YAML frontmatter
  if (trimmed.startsWith('---\n') || trimmed.startsWith('---\r\n')) {
    const close = trimmed.indexOf('\n---', 4);
    if (close > 0) {
      const fm = trimmed.slice(4, close);
      const m = fm.match(/^intro\s*:\s*(?:["'](.*?)["']|(.+))\s*$/m);
      if (m) {
        const value = (m[1] ?? m[2] ?? '').trim();
        if (value) return truncate(value);
      }
    }
  }

  // 2. Heading section
  const lines = markdown.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const h = line.match(/^##\s+(.+?)\s*$/);
    if (!h || !h[1]) continue;
    if (!HEADING_NAMES.has(h[1].toLowerCase().trim())) continue;
    // Walk forward; collect paragraph until blank line or next heading.
    const para: string[] = [];
    for (let j = i + 1; j < lines.length; j++) {
      const l = (lines[j] ?? '').trim();
      if (!l) {
        if (para.length) break;
        continue;
      }
      if (l.startsWith('#')) break;
      para.push(l);
    }
    if (para.length) return truncate(para.join(' '));
  }

  // 3. First non-empty, non-heading paragraph
  const para: string[] = [];
  for (const raw of lines) {
    const l = raw.trim();
    if (!l) {
      if (para.length) break;
      continue;
    }
    if (l.startsWith('#') || l.startsWith('---')) continue;
    para.push(l);
  }
  if (para.length) return truncate(para.join(' '));

  return '';
}

function truncate(s: string): string {
  if (s.length <= MAX_INTRO_CHARS) return s;
  return s.slice(0, MAX_INTRO_CHARS - 1).trimEnd() + '…';
}
