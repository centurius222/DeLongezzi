import { signal } from '@preact/signals';

// The shot timer, big, in the middle of the chart too (Settings > Brew Button, user
// 2026-09-30): for when the brew button's numbers are hidden to see its video, or just to
// read the time from across the room. Kept on the machine; set from its settings at start
// and after Save (utils/themeManager.js rememberThemeSettings).
export const chartTimer = signal({ on: false, opacity: 0.35, size: 1 });

export function rememberChartTimer(s) {
  if (!s || typeof s !== 'object') return;
  chartTimer.value = {
    on: !!s.chartTimer,
    opacity: (s.chartTimerOpacity ?? 35) / 100,
    size: (s.chartTimerSize ?? 100) / 100,
  };
}
