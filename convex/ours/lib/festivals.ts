// Preset festivals for the instructor dashboard (#4).
// 24 game hours ≈ 1 real hour until #2 game-clock lands; see ASSIGNMENT FAQ.

export const FESTIVAL_DURATION_MS = 60 * 60 * 1000;

export type FestivalKind =
  | 'spring_festival'
  | 'mid_autumn'
  | 'halloween'
  | 'april_fools'
  | 'custom';

export type FestivalPreset = {
  kind: FestivalKind;
  label: string;
  eventText: string;
};

export const FESTIVAL_PRESETS: FestivalPreset[] = [
  {
    kind: 'spring_festival',
    label: '春节',
    eventText:
      '今天是春节，镇上贴着春联、放着鞭炮，大家互相拜年，说吉祥话、聊团圆饭。',
  },
  {
    kind: 'mid_autumn',
    label: '中秋',
    eventText:
      '今天是中秋节，月亮又圆又亮，人们聊着月饼、赏月和与家人团聚的事。',
  },
  {
    kind: 'halloween',
    label: '万圣节',
    eventText:
      '今天是万圣节，有人穿着奇装异服，糖果、南瓜灯和恶作剧的话题很多。',
  },
  {
    kind: 'april_fools',
    label: '愚人节',
    eventText:
      '今天是愚人节，大伙儿互相开玩笑、搞小恶作剧，但要把握分寸、别伤人。',
  },
  {
    kind: 'custom',
    label: '自定义',
    eventText: '',
  },
];

export function getFestivalPreset(kind: FestivalKind): FestivalPreset | undefined {
  return FESTIVAL_PRESETS.find((p) => p.kind === kind);
}

export function buildFestivalEventText(kind: FestivalKind, customText?: string): string {
  if (kind === 'custom') {
    const trimmed = customText?.trim() ?? '';
    if (!trimmed) {
      throw new Error('自定义节日需要填写说明文字');
    }
    return trimmed;
  }
  const preset = getFestivalPreset(kind);
  if (!preset?.eventText) {
    throw new Error(`未知节日类型: ${kind}`);
  }
  return preset.eventText;
}

export function listExpiredTownEventIds(
  events: Array<{ _id: string; expiresAt?: number }>,
  now: number,
): string[] {
  return events
    .filter((evt) => evt.expiresAt !== undefined && evt.expiresAt <= now)
    .map((evt) => evt._id);
}
