import { create } from 'zustand'
import { persist } from 'zustand/middleware'

type ThemeMode = 'light' | 'dark'

interface ThemeState {
  mode: ThemeMode
  toggle: () => void
  set: (mode: ThemeMode) => void
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      mode: 'light',
      toggle: () =>
        set((s) => {
          const next = s.mode === 'light' ? 'dark' : 'light'
          applyTheme(next)
          return { mode: next }
        }),
      set: (mode) => {
        applyTheme(mode)
        set({ mode })
      },
    }),
    {
      name: 'theme-mode',
    },
  ),
)

function applyTheme(mode: ThemeMode) {
  document.documentElement.setAttribute('data-theme', mode)
}
