/* Applies the saved light/dark choice before first paint and loads the design system. */
/* If the browser kept an old copy of this page after an upload, notice and reload it once. */
(function checkForNewBuild() {
  try {
    var script = document.currentScript;
    var mine = script && /[?&]v=([A-Za-z0-9._-]+)/.exec(script.src);
    if (!mine || !window.fetch) return;
    window.fetch('/version.json', { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (latest) {
      if (!latest || !latest.v || latest.v === mine[1]) { window.sessionStorage.removeItem('portohr.reloaded'); return; }
      if (window.sessionStorage.getItem('portohr.reloaded') === latest.v) return; // already tried this version once
      window.sessionStorage.setItem('portohr.reloaded', latest.v);
      window.location.reload();
    }).catch(function () { /* offline or no version file: carry on */ });
  } catch (err) { /* never block the page */ }
})();

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
  // Colour palette: Navy & gold unless the person picked another in the account menu.
  // Lagoon is the base stylesheet, so it is the one palette without an attribute.
  var palette = 'navy';
  try {
    var saved = window.localStorage.getItem('portohr.palette');
    if (['lagoon', 'navy', 'indigo', 'graphite'].indexOf(saved) !== -1) palette = saved;
  } catch (err) { /* storage unavailable: default palette */ }
  if (palette !== 'lagoon') document.documentElement.setAttribute('data-palette', palette);
  // Page background for the first paint, matching theme.css (light / dark per palette).
  var BG = { lagoon: ['#f1eee6', '#0a1216'], navy: ['#f3f4f7', '#0b1020'], indigo: ['#f5f5fa', '#0d0d17'], graphite: ['#f4f4f2', '#0c0c0e'] };
  document.documentElement.style.backgroundColor = BG[palette][dark ? 1 : 0];
  if (!document.getElementById('portohr-theme-css')) {
    var link = document.createElement('link');
    link.id = 'portohr-theme-css';
    link.rel = 'stylesheet';
    link.href = '/css/theme.css?v=20261009-0452';
    document.head.appendChild(link);
  }
})();
