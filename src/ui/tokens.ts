export const palettes = {
  light: {
    bg: '#F7F8FA',
    surface: '#FFFFFF',
    text: '#0F172A',
    muted: '#64748B',
    border: '#E2E8F0',
    primary: '#4F46E5',
    primaryText: '#FFFFFF',
    success: '#16A34A',
    warning: '#D97706',
    danger: '#DC2626',
  },
  dark: {
    bg: '#0B0F19',
    surface: '#131A2A',
    text: '#F1F5F9',
    muted: '#94A3B8',
    border: '#1F2937',
    primary: '#818CF8',
    primaryText: '#0B0F19',
    success: '#4ADE80',
    warning: '#FBBF24',
    danger: '#F87171',
  },
} as const;
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;
export const radius = { card: 12, pill: 999, sheet: 16 } as const;
export const typography = {
  display: { fontSize: 28, lineHeight: 34, fontWeight: '600' },
  title: { fontSize: 20, lineHeight: 26, fontWeight: '600' },
  body: { fontSize: 16, lineHeight: 24, fontWeight: '400' },
  caption: { fontSize: 13, lineHeight: 18, fontWeight: '400' },
  mono: { fontSize: 15, lineHeight: 22, fontFamily: 'monospace' },
} as const;
export const metrics = {
  target: 48,
  icon: 28,
  stroke: 1,
  pressedOpacity: 0.7,
  disabledOpacity: 0.5,
  motionMs: 200,
} as const;
export const lightShadow = '0 1px 2px rgba(0, 0, 0, 0.05)';
