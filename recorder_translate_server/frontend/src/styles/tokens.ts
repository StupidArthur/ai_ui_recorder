import type { ThemeConfig } from 'antd'

// Vercel Design Tokens
export const TOKENS = {
  primary: '#0070f3',
  secondary: '#8855ff',
  success: '#10b981',
  warning: '#f59e0b',
  error: '#ef4444',
  white: '#ffffff',
  black: '#000000',
  gray1: '#fafafa',
  gray2: '#f4f4f5',
  gray3: '#e4e4e7',
  gray4: '#a1a1aa',
  gray5: '#71717a',
  gray6: '#52525b',
  gray7: '#3f3f46',
  gray8: '#27272a',
  gray9: '#18181b',
  gray10: '#09090b',
  textPrimary: '#09090b',
  textSecondary: '#52525b',
  textTertiary: '#a1a1aa',
  border: '#e4e4e7',
  fontFamily: "'Geist', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  fontMono: "'Geist Mono', 'Fira Code', monospace",
} as const

export const antdTheme: ThemeConfig['token'] = {
  colorPrimary: TOKENS.primary,
  colorSuccess: TOKENS.success,
  colorWarning: TOKENS.warning,
  colorError: TOKENS.error,
  colorBgBase: TOKENS.white,
  colorTextBase: TOKENS.textPrimary,
  fontFamily: TOKENS.fontFamily,
  borderRadius: 6,
}

export const antdThemeDark: ThemeConfig['token'] = {
  ...antdTheme,
  colorBgBase: TOKENS.gray9,
  colorTextBase: TOKENS.white,
  colorPrimary: TOKENS.primary,
}
