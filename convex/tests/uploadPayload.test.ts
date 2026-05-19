import { describe, it, expect } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { parseUploadPayload } from '../ours/lib/uploadPayload';

describe('parseUploadPayload — zip path', () => {
  it('extracts card.md from a zip bundle', () => {
    const zip = zipSync({ 'card.md': strToU8('# hello\nworld') });
    const result = parseUploadPayload(zip);
    expect(result.cardText).toBe('# hello\nworld');
    expect(result.avatarBytes).toBeUndefined();
  });

  it('extracts avatar.png alongside card.md when present', () => {
    const zip = zipSync({
      'card.md': strToU8('# card'),
      'avatar.png': new Uint8Array([1, 2, 3, 4]),
    });
    const result = parseUploadPayload(zip);
    expect(result.cardText).toBe('# card');
    expect(result.avatarBytes).toBeDefined();
    expect(Array.from(result.avatarBytes!)).toEqual([1, 2, 3, 4]);
  });

  it('throws when zip is missing card.md', () => {
    const zip = zipSync({ 'wrong-name.md': strToU8('hello') });
    expect(() => parseUploadPayload(zip)).toThrow(/missing card.md/);
  });
});

describe('parseUploadPayload — bare card.md path', () => {
  it('treats non-zip bytes as raw card.md text', () => {
    const md = strToU8('---\nkey: value\n---\n# Card body');
    const result = parseUploadPayload(md);
    expect(result.cardText).toBe('---\nkey: value\n---\n# Card body');
    expect(result.avatarBytes).toBeUndefined();
  });

  it('handles UTF-8 (Chinese) card content', () => {
    const md = strToU8('# 灯火\n小镇里的图书馆员。');
    expect(parseUploadPayload(md).cardText).toContain('图书馆员');
  });
});

describe('parseUploadPayload — detection edge cases', () => {
  it('detects zip via PK\\x03\\x04 magic bytes, not file extension', () => {
    // First 4 bytes are the ZIP local-file-header signature.
    const zip = zipSync({ 'card.md': strToU8('x') });
    expect(zip[0]).toBe(0x50);
    expect(zip[1]).toBe(0x4b);
    expect(parseUploadPayload(zip).cardText).toBe('x');
  });

  it('does NOT treat short payloads (<4 bytes) as zip', () => {
    // Smaller than the magic signature — falls through to bare text.
    expect(parseUploadPayload(new Uint8Array([0x50, 0x4b])).cardText).toBe(
      'PK',
    );
  });

  it('does NOT misidentify a markdown line that happens to start with "PK"', () => {
    // PK followed by ASCII characters (not the zip continuation bytes).
    const md = strToU8('PKE schedule for fall semester');
    const result = parseUploadPayload(md);
    expect(result.cardText).toMatch(/^PKE schedule/);
  });
});
