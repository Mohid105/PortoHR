/**
 * Compiled at build time (npm run build:css) into public/css/tailwind.css, which
 * is committed, so production needs no build step and no external script.
 * Everything is scanned as plain text, so every class used anywhere in the
 * pages or their scripts is picked up as long as it is written out in full.
 */
module.exports = {
  darkMode: 'class',
  content: ['./public/**/*.html', './public/js/**/*.js'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', 'Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        display: ['Fraunces', 'Georgia', 'serif'],
      },
      colors: {
        brand: { DEFAULT: '#0E6379', hover: '#0A4F61', dark: '#46BDD6' },
      },
      boxShadow: {
        card: '0 1px 2px rgb(40 34 20 / 0.04), 0 10px 28px -14px rgb(40 34 20 / 0.12)',
      },
    },
  },
  plugins: [],
};
