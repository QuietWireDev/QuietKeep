// QuietKeep: hooks/useTheme.ts
// Theme management. Sets data-theme attribute on <html> for CSS to consume.
// useThemeListener also watches the OS prefers-color-scheme media query when
// the user selects "system" mode, so the UI updates live if the OS switches.
// Author: QuietWire (Dennis Ayotte)

import { useEffect } from 'react';

export function applyTheme(theme: string) {
  const root = document.documentElement;

  if (theme === 'system') {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    root.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
  } else {
    root.setAttribute('data-theme', theme);
  }
}

export function useThemeListener(theme: string) {
  useEffect(() => {
    applyTheme(theme);

    if (theme === 'system') {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      const handler = () => applyTheme('system');
      mq.addEventListener('change', handler);
      return () => mq.removeEventListener('change', handler);
    }
  }, [theme]);
}
