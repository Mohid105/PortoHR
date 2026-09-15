/* Shared Tailwind Play CDN theme. Move these values into tailwind.config.js at
   the project root when switching to a compiled build. */
tailwind.config = {
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
      },
      colors: {
        brand: {
          DEFAULT: '#2054C9',
          hover: '#173F9C',
          dark: '#5B8DEF',
        },
      },
      boxShadow: {
        card: '0 1px 2px 0 rgb(15 23 42 / 0.04), 0 1px 3px 0 rgb(15 23 42 / 0.06)',
      },
    },
  },
};

(function applyThemeEarly() {
  var KEY = 'portohr.theme';
  var mode = 'system';
  try {
    mode = window.localStorage.getItem(KEY) || 'system';
  } catch (err) {
    mode = 'system';
  }
  var prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  var dark = mode === 'dark' || (mode === 'system' && prefersDark);
  document.documentElement.classList.toggle('dark', dark);
  if (!document.getElementById('portohr-theme-css')) {
    var link = document.createElement('link');
    link.id = 'portohr-theme-css';
    link.rel = 'stylesheet';
    link.href = '/css/theme.css';
    document.head.appendChild(link);
  }
})();
