// Appearance: Original (light, default), Dark, or Match device. Remembered per device.
export type ThemeChoice = 'dark' | 'light' | 'system'
const KEY = 'mh-theme'
const META = { dark: '#111514', light: '#0f2a4a' }

export function getThemeChoice(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'dark' || v === 'system' ? v : 'light'
  } catch { return 'light' }
}

function resolve(choice: ThemeChoice): 'dark' | 'light' {
  if (choice !== 'system') return choice
  return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}

export function applyTheme(choice: ThemeChoice = getThemeChoice()) {
  const t = resolve(choice)
  document.documentElement.dataset.theme = t
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', META[t])
}

export function setThemeChoice(choice: ThemeChoice) {
  try { localStorage.setItem(KEY, choice) } catch { /* storage unavailable */ }
  applyTheme(choice)
}

// Follow the device setting live when "Match device" is chosen
window.matchMedia?.('(prefers-color-scheme: light)').addEventListener?.('change', () => {
  if (getThemeChoice() === 'system') applyTheme('system')
})
