/**
 * @license
 * Copyright 2025 Arquimedes
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Theme } from '@/common/theme/types';
import { FIELD_THEME_ID, LIGHT_THEME_ID, DARK_THEME_ID } from '@/common/theme/constants';
import { arquimedesFieldCover, arquimedesLightCover } from '@renderer/pages/settings/AppearanceSettings/themeCovers';

const T0 = 0;

// Arquimedes themes use an engineering-inspired navy and teal palette.
export const BUILTIN_THEMES: Theme[] = [
  {
    id: LIGHT_THEME_ID,
    name: 'Arquimedes Light',
    appearance: 'light',
    cover: arquimedesLightCover,
    builtin: true,
    created_at: T0,
    updated_at: T0,
    tokens: {
      root: {
        // Appearance-invariant tokens (same in light and dark)
        '--text-white': '#ffffff',
        '--inverse': '#ffffff',
      },
      light: {
        // Appearance-scoped tokens for light mode
        '--bg-base': '#f5f7f5',
        '--bg-1': '#ffffff',
        '--bg-2': '#edf2ef',
        '--bg-3': '#dde6e1',
        '--bg-6': '#586c65',
        '--bg-hover': '#e7efeb',
        '--bg-active': '#dbe8e2',
        '--text-primary': '#172a2a',
        '--text-secondary': '#4c625c',
        '--text-disabled': '#82928c',
        '--border-base': '#d5e0da',
        '--border-light': '#e6ece8',
        '--border-special': '#d5e0da',
        '--primary': '#176b65',
        '--success': '#19734d',
        '--warning': '#875500',
        '--danger': '#a6342a',
        '--info': '#1d637a',
        '--brand': '#18384a',
        '--brand-light': '#e6f0ee',
        '--brand-hover': '#102d3c',
        '--message-user-bg': '#dcefeb',
        '--message-tips-bg': '#edf1e8',
        '--workspace-btn-bg': '#edf2ef',
        '--thought-gradient': 'linear-gradient(90deg, #dcefeb 0%, #edf1e8 100%)',
        '--fill': '#edf2ef',
        '--fill-0': '#ffffff',
        '--dialog-fill-0': '#ffffff',
      },
    },
  },
  {
    id: DARK_THEME_ID,
    name: 'Arquimedes Dark',
    appearance: 'dark',
    builtin: true,
    created_at: T0,
    updated_at: T0,
    tokens: {
      root: {
        // Appearance-invariant tokens (same in light and dark)
        '--text-white': '#ffffff',
        '--inverse': '#ffffff',
      },
      dark: {
        // Appearance-scoped tokens for dark mode
        '--bg-base': '#111a1e',
        '--bg-1': '#172328',
        '--bg-2': '#202e33',
        '--bg-3': '#2b3d42',
        '--bg-6': '#8ea29f',
        '--bg-hover': '#26383d',
        '--bg-active': '#30464a',
        '--text-primary': '#edf4f1',
        '--text-secondary': '#b9c9c4',
        '--text-disabled': '#81938e',
        '--border-base': '#35494d',
        '--border-light': '#26383d',
        '--border-special': '#2b3d42',
        '--primary': '#24766e',
        '--success': '#73d49a',
        '--warning': '#f0bf5c',
        '--danger': '#f0786f',
        '--info': '#76c8dd',
        '--brand': '#55c7b4',
        '--brand-light': '#1e383a',
        '--brand-hover': '#73d5c3',
        '--message-user-bg': '#1b3d42',
        '--message-tips-bg': '#243832',
        '--workspace-btn-bg': '#172328',
        '--thought-gradient': 'linear-gradient(90deg, #1b3d42 0%, #243832 100%)',
        '--fill': '#172328',
        '--fill-0': 'rgba(255, 255, 255, 0.05)',
        '--dialog-fill-0': '#202e33',
      },
    },
  },
  {
    id: FIELD_THEME_ID,
    name: 'Arquimedes Campo',
    appearance: 'light',
    cover: arquimedesFieldCover,
    builtin: true,
    created_at: T0,
    updated_at: T0,
    tokens: {
      root: {
        '--text-white': '#ffffff',
        '--inverse': '#ffffff',
      },
      light: {
        '--bg-base': '#f1f0e9',
        '--bg-1': '#faf9f3',
        '--bg-2': '#e5e4d9',
        '--bg-3': '#d0d1c5',
        '--bg-6': '#52656b',
        '--bg-hover': '#e3e5dc',
        '--bg-active': '#d5ddd7',
        '--text-primary': '#182b32',
        '--text-secondary': '#43585d',
        '--text-disabled': '#788488',
        '--border-base': '#c6cbc2',
        '--border-light': '#e5e4d9',
        '--border-special': '#d0d1c5',
        '--primary': '#174f63',
        '--success': '#137c69',
        '--warning': '#875100',
        '--danger': '#a52e26',
        '--info': '#126b81',
        '--brand': '#174f63',
        '--brand-light': '#e3e5dc',
        '--brand-hover': '#123e4e',
        '--message-user-bg': '#d9e8e4',
        '--message-tips-bg': '#e8e9df',
        '--workspace-btn-bg': '#e5e4d9',
        '--thought-gradient': 'linear-gradient(90deg, #d9e8e4 0%, #e8e9df 100%)',
        '--fill': '#e5e4d9',
        '--fill-0': '#faf9f3',
        '--dialog-fill-0': '#faf9f3',
      },
    },
  },
];

export const BUILTIN_THEME_IDS = new Set(BUILTIN_THEMES.map((t) => t.id));
