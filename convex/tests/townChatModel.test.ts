import { describe, it, expect, afterEach } from 'vitest';
import {
  townChatModel,
  PRO_CALLTYPES,
  TOWN_FLASH_MODEL,
  TOWN_PRO_MODEL,
} from '../ours/lib/townChatModel';

describe('townChatModel', () => {
  afterEach(() => {
    delete process.env.TOWN_CHAT_MODEL;
    PRO_CALLTYPES.delete('__test_pro__');
  });

  it('keeps non-escalated town callTypes on flash', () => {
    expect(townChatModel('conversation_continue')).toBe(TOWN_FLASH_MODEL);
    expect(townChatModel('conversation_leave')).toBe(TOWN_FLASH_MODEL);
    expect(townChatModel('memory_summary')).toBe(TOWN_FLASH_MODEL);
    expect(townChatModel('memory_importance')).toBe(TOWN_FLASH_MODEL);
  });

  it('escalates the configured callTypes to pro', () => {
    expect(townChatModel('memory_reflection')).toBe(TOWN_PRO_MODEL);
    expect(townChatModel('conversation_start')).toBe(TOWN_PRO_MODEL);
  });

  it('routes a callType listed in PRO_CALLTYPES to pro, rest stay flash', () => {
    PRO_CALLTYPES.add('__test_pro__');
    expect(townChatModel('__test_pro__')).toBe(TOWN_PRO_MODEL);
    expect(townChatModel('conversation_continue')).toBe(TOWN_FLASH_MODEL);
  });

  it('TOWN_CHAT_MODEL env wins as a global override', () => {
    process.env.TOWN_CHAT_MODEL = TOWN_PRO_MODEL;
    expect(townChatModel('memory_summary')).toBe(TOWN_PRO_MODEL);
    PRO_CALLTYPES.add('__test_pro__');
    process.env.TOWN_CHAT_MODEL = TOWN_FLASH_MODEL;
    expect(townChatModel('__test_pro__')).toBe(TOWN_FLASH_MODEL);
  });
});
