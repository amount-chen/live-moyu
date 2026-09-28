// Apply before the stylesheet paints, including on a cold start.
document.documentElement.dataset.theme = window.moyu.initialTheme;
document.documentElement.dataset.compact = String(window.moyu.initialCompact);
