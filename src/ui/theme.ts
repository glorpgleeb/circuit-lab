// Colour themes. Follows the OS (light/dark) until the user picks one; the pick is kept in localStorage.
export const THEMES = [
  { id: 'light', label: 'Clair' },
  { id: 'dark', label: 'Sombre' },
  { id: 'black', label: 'Noir' },
  { id: 'purple', label: 'Violet sombre' },
] as const;
export type Theme = (typeof THEMES)[number]['id'];
const KEY = 'circuit-lab.theme';

function stored(): Theme | null {
  try {
    const v = localStorage.getItem(KEY);
    return THEMES.some((t) => t.id === v) ? (v as Theme) : null;
  } catch {
    return null; // storage blocked: fall back to the OS setting
  }
}

export function currentTheme(): Theme {
  return stored() ?? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
}

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
}

export function setTheme(theme: Theme): void {
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    /* not persisted, still applied for this session */
  }
  applyTheme(theme);
}
