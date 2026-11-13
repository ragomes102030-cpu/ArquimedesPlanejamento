import { describe, it, expect } from 'vitest';
import { resolveActiveTheme } from '@/common/theme/resolveTheme';
import { FIELD_THEME_ID, LIGHT_THEME_ID, DARK_THEME_ID, SYSTEM_THEME_ID } from '@/common/theme/constants';
import { BUILTIN_THEMES } from '@renderer/theme/builtinThemes';
import type { Theme } from '@/common/theme/types';

const mk = (id: string, appearance: 'light' | 'dark' = 'light'): Theme => ({
  id,
  name: id,
  appearance,
  builtin: true,
  created_at: 0,
  updated_at: 0,
});
const light = mk(LIGHT_THEME_ID);
const dark = mk(DARK_THEME_ID, 'dark');
const userTheme: Theme = {
  id: 'u1',
  name: 'Mine',
  appearance: 'dark',
  css: 'body{}',
  builtin: false,
  created_at: 1,
  updated_at: 1,
};
const themes = [light, dark, userTheme];

const relativeLuminance = (hex: string) => {
  const channels = [1, 3, 5].map((offset) => {
    const channel = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
};

const contrastRatio = (foreground: string, background: string) => {
  const luminances = [relativeLuminance(foreground), relativeLuminance(background)].sort((a, b) => b - a);
  return (luminances[0] + 0.05) / (luminances[1] + 0.05);
};

describe('resolveActiveTheme', () => {
  it('returns a theme by id', () => {
    expect(resolveActiveTheme(DARK_THEME_ID, themes).id).toBe(DARK_THEME_ID);
  });
  it('resolves the Arquimedes field theme as a distinct high-contrast light theme', () => {
    const field = resolveActiveTheme(FIELD_THEME_ID, BUILTIN_THEMES);
    expect(field.appearance).toBe('light');
    expect(field.cover).toMatch(/^data:image\/svg\+xml;base64,/);
    expect(field.tokens).toMatchObject({
      light: {
        '--primary': '#174f63',
        '--bg-base': '#f1f0e9',
        '--text-primary': '#182b32',
      },
    });
  });
  it('uses the Arquimedes navy and teal palette in the standard light and dark themes', () => {
    const lightTheme = resolveActiveTheme(LIGHT_THEME_ID, BUILTIN_THEMES);
    const darkTheme = resolveActiveTheme(DARK_THEME_ID, BUILTIN_THEMES);
    expect(lightTheme.tokens).toMatchObject({
      light: {
        '--primary': '#176b65',
        '--brand': '#18384a',
        '--bg-base': '#f5f7f5',
      },
    });
    expect(darkTheme.tokens).toMatchObject({
      dark: {
        '--primary': '#24766e',
        '--brand': '#55c7b4',
        '--bg-base': '#111a1e',
      },
    });
  });
  it('keeps dark semantic colors readable on every dark surface', () => {
    const tokens = resolveActiveTheme(DARK_THEME_ID, BUILTIN_THEMES).tokens;
    if (!tokens || !('dark' in tokens) || typeof tokens.dark !== 'object') {
      throw new Error('Dark theme tokens are missing');
    }
    const darkTokens = tokens.dark;
    for (const foreground of ['--success', '--warning', '--danger', '--info']) {
      for (const background of ['--bg-base', '--bg-1', '--bg-2']) {
        expect(contrastRatio(darkTokens[foreground], darkTokens[background])).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
  it('returns a user theme by id', () => {
    expect(resolveActiveTheme('u1', themes).id).toBe('u1');
  });
  it('falls back to Light when id is unknown', () => {
    expect(resolveActiveTheme('nope', themes).id).toBe(LIGHT_THEME_ID);
  });
  it('falls back to Light when id is empty', () => {
    expect(resolveActiveTheme('', themes).id).toBe(LIGHT_THEME_ID);
  });
  it('falls back to Light when activeId points at a removed community theme', () => {
    // Decorative community skins (e.g. hello-kitty, retro-windows) were deprecated and
    // removed. A persisted activeId still pointing at one is unknown to the resolver
    // and safely resolves to Light — no crash, no blank UI.
    const remainingBuiltins = [light, dark];
    expect(resolveActiveTheme('hello-kitty', remainingBuiltins).id).toBe(LIGHT_THEME_ID);
    expect(resolveActiveTheme('retro-windows', remainingBuiltins).id).toBe(LIGHT_THEME_ID);
  });
  it('falls back to first theme when no Light present', () => {
    expect(resolveActiveTheme('nope', [dark, userTheme]).id).toBe(DARK_THEME_ID);
  });
  it('resolves system to Dark when prefersDark is true', () => {
    expect(resolveActiveTheme(SYSTEM_THEME_ID, themes, true).id).toBe(DARK_THEME_ID);
  });
  it('resolves system to Light when prefersDark is false', () => {
    expect(resolveActiveTheme(SYSTEM_THEME_ID, themes, false).id).toBe(LIGHT_THEME_ID);
  });
  it('resolves system to Light when prefersDark is undefined', () => {
    expect(resolveActiveTheme(SYSTEM_THEME_ID, themes).id).toBe(LIGHT_THEME_ID);
  });
  it('ignores prefersDark for non-system ids', () => {
    expect(resolveActiveTheme('u1', themes, true).id).toBe('u1');
    expect(resolveActiveTheme(LIGHT_THEME_ID, themes, true).id).toBe(LIGHT_THEME_ID);
  });
  it('falls back to Light when system resolves to a missing Dark theme', () => {
    expect(resolveActiveTheme(SYSTEM_THEME_ID, [light, userTheme], true).id).toBe(LIGHT_THEME_ID);
  });
});
