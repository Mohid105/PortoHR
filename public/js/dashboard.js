/* Dashboard: a personal home with today's clock, leave, approvals, pay, schedule and company news. */
(function (window, document) {
  'use strict';

  var api = window.PortoHR.api;
  var shell = window.PortoHR.shell;
  var state = { user: null, employeeId: null, weekStart: null, selected: null, calendars: {}, clock: null };

  var el = function (id) { return document.getElementById(id); };

  function esc(value) {
    return String(value === null || value === undefined ? '' : value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function svg(paths, cls) {
    return '<svg class="' + (cls || 'h-5 w-5') + '" fill="none" viewBox="0 0 24 24" stroke-width="1.6" stroke="currentColor" aria-hidden="true">' + paths + '</svg>';
  }

  function initials(name) {
    return String(name || '?').split(' ').filter(Boolean).slice(0, 2).map(function (p) { return p[0].toUpperCase(); }).join('');
  }

  function tone(name) {
    var sum = 0;
    String(name || '').split('').forEach(function (c) { sum += c.charCodeAt(0); });
    return 'av-' + ((sum % 5) + 1);
  }

  function avatar(name) { return '<span class="av ' + tone(name) + '">' + esc(initials(name)) + '</span>'; }

  function iso(date) {
    return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
  }

  function money(amount, currency) {
    try {
      return new Intl.NumberFormat(undefined, { style: 'currency', currency: currency || 'USD', maximumFractionDigits: 0 }).format(amount);
    } catch (err) {
      return (currency || '') + ' ' + Math.round(amount).toLocaleString();
    }
  }

  function has(module) { return (state.user.modules || []).indexOf(module) !== -1; }

  function fillIcons() {
    var icons = shell.icon;
    var map = {
      'clock-ico': '<path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />',
      'leave-ico': icons.leave,
      'approvals-ico': '<path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />',
      'payslip-ico': icons.payroll,
      'cal-ico': icons.attendance,
      'news-ico': '<path stroke-linecap="round" stroke-linejoin="round" d="M10.34 15.84c-.688-.06-1.386-.09-2.09-.09H7.5a4.5 4.5 0 110-9h.75c.704 0 1.402-.03 2.09-.09m0 9.18c.253.962.584 1.892.985 2.783.247.55.06 1.21-.463 1.511l-.657.38c-.551.318-1.26.117-1.527-.461a20.845 20.845 0 01-1.44-4.282m3.102.069a18.03 18.03 0 01-.59-4.59c0-1.586.205-3.124.59-4.59m0 9.18a23.848 23.848 0 018.835 2.535M10.34 6.66a23.847 23.847 0 008.835-2.535m0 0A23.74 23.74 0 0018.795 3m.38 1.125a23.91 23.91 0 011.014 5.395m-1.014 8.855c-.118.38-.245.754-.38 1.125m.38-1.125a23.91 23.91 0 001.014-5.395m0-3.46c.495.413.811 1.035.811 1.73 0 .695-.316 1.317-.811 1.73m0-3.46a24.347 24.347 0 010 3.46" />',
      'moments-ico': icons.core_hr,
      'learning-ico': icons.lms,
      'pulse-ico': icons.analytics,
    };
    Object.keys(map).forEach(function (id) { if (el(id)) el(id).innerHTML = svg(map[id]); });
  }

  /* ---------- hero ---------- */

  function renderHero(user) {
    var hour = new Date().getHours();
    el('greeting-prefix').textContent = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
    el('greeting-name').textContent = user.fullName.split(' ')[0];
    el('today-label').textContent = new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
    el('role-line').textContent = [user.roleLabel, user.designation, user.department].filter(Boolean).join(' · ');

    var chips = [
      { m: 'leave', label: 'Apply for leave', href: '/leave.html?apply=1', icon: '<path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" />' },
      { m: 'payroll', label: 'My payslips', href: '/payroll.html', icon: shell.icon.payroll },
      { m: 'core_hr', label: 'My profile', href: '/core-hr.html', icon: shell.icon.core_hr },
      { m: 'company', label: 'Company hub', href: '/company.html', icon: shell.icon.assets },
    ].filter(function (c) { return has(c.m); });
    el('hero-chips').innerHTML = chips.map(function (c) {
      return '<a class="hero-chip" href="' + c.href + '">' + svg(c.icon, 'h-4 w-4') + esc(c.label) + '</a>';
    }).join('');
  }

  function setHeroStats(parts) {
    var host = el('hero-stats');
    var current = host.__stats || {};
    Object.assign(current, parts);
    host.__stats = current;
    var items = [];
    if (current.leave !== undefined) items.push([current.leave, 'days of leave left']);
    if (current.approvals !== undefined) items.push([current.approvals, current.approvals === 1 ? 'approval waiting' : 'approvals waiting']);
    if (current.holiday) items.push([current.holiday.when, current.holiday.name]);
    host.innerHTML = items.map(function (i) { return '<div class="hero-stat"><b>' + esc(i[0]) + '</b><span>' + esc(i[1]) + '</span></div>'; }).join('');
  }

  /* ---------- clock ---------- */

  function tickClock() {
    var now = new Date();
    el('clock-time').textContent = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
    el('clock-date').textContent = now.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  }

  var CLOCK_TONE = { not_started: '', in_progress: 'info', present: 'ok', short_day: 'warn', absent: 'bad', on_leave: 'info' };

  function renderClock(t) {
    state.clock = t;
    var pill = el('clock-status');
    pill.textContent = t.statusLabel;
    pill.className = 'pill ml-auto ' + (CLOCK_TONE[t.status] || '');
    var btn = el('clock-btn');
    btn.classList.remove('hidden', 'out');
    btn.disabled = false;
    if (t.canClockOut) {
      btn.textContent = 'Clock out';
      btn.classList.add('out');
      el('clock-meta').textContent = 'You have been on the clock for ' + t.elapsedHours + ' h.';
    } else if (t.canClockIn) {
      btn.textContent = 'Clock in';
      el('clock-meta').textContent = (t.employee && t.employee.shift ? 'Shift: ' + t.employee.shift.label + '.' : '') + ' Ready when you are.';
    } else {
      btn.classList.add('hidden');
      el('clock-meta').textContent = t.status === 'on_leave' ? 'Enjoy your day off.' : 'Your day is recorded. Nice work.';
    }
  }

  async function loadClock() {
    if (!has('attendance')) return hideClock();
    try {
      renderClock(await api.get('/attendance/today'));
    } catch (err) {
      hideClock();
    }
  }

  function hideClock() {
    el('clock-card').classList.add('hidden');
    el('hero').classList.remove('span-8');
    el('hero').classList.add('span-12');
  }

  function wireClock() {
    el('clock-btn').addEventListener('click', async function () {
      var btn = el('clock-btn');
      btn.disabled = true;
      try {
        await api.post(state.clock && state.clock.canClockOut ? '/attendance/clock-out' : '/attendance/clock-in');
        await loadClock();
      } catch (err) {
        el('clock-meta').textContent = err.message || 'Could not record that.';
        btn.disabled = false;
      }
    });
    tickClock();
    window.setInterval(tickClock, 15000);
  }

  /* ---------- leave ---------- */

  var STATUS_TONE = { approved: 'ok', pending: 'warn', rejected: 'bad', cancelled: '' };

  function gaugeSvg(ratio) {
    var len = Math.PI * 80;
    var filled = Math.max(0, Math.min(1, ratio)) * len;
    return '<svg viewBox="0 0 200 112" aria-hidden="true"><defs><linearGradient id="gGrad" x1="0" y1="0" x2="1" y2="0">' +
      '<stop offset="0" style="stop-color:var(--primary)"/><stop offset="1" style="stop-color:var(--primary-bright)"/></linearGradient></defs>' +
      '<path d="M20 100 A80 80 0 0 1 180 100" fill="none" stroke="var(--border)" stroke-width="16" stroke-linecap="round"/>' +
      '<path d="M20 100 A80 80 0 0 1 180 100" fill="none" stroke="url(#gGrad)" stroke-width="16" stroke-linecap="round" stroke-dasharray="' + filled.toFixed(1) + ' ' + len.toFixed(1) + '"/></svg>';
  }

  function renderLeave(balances, requests) {
    var annual = balances.filter(function (b) { return b.code === 'annual'; })[0] || balances[0];
    if (!annual) {
      el('leave-body').innerHTML = '<p class="text-sm text-slate-500">Link your login to an employee record to see balances.</p>';
      return;
    }
    var ratio = annual.entitlementDays ? annual.availableDays / annual.entitlementDays : 0;
    var list = (requests || []).slice(0, 3).map(function (r) {
      return '<div>' + '<span class="grow"><b class="font-semibold">' + esc(r.fromDate === r.toDate ? r.fromDate : r.fromDate + ' → ' + r.toDate) + '</b><span class="sub block">' + esc(r.leaveTypeLabel) + ' · ' + (Math.round(r.days * 100) / 100) + ' day' + (r.days === 1 ? '' : 's') + '</span></span>' +
        '<span class="pill ' + (STATUS_TONE[r.status] || '') + '">' + esc(r.statusLabel) + '</span></div>';
    }).join('');
    el('leave-body').innerHTML =
      '<div class="gauge">' + gaugeSvg(ratio) + '<div class="gauge-center"><b>' + (Math.round(annual.availableDays * 10) / 10) + '</b><span>of ' + annual.entitlementDays + ' days left</span></div></div>' +
      '<div class="legend"><span><i style="background:var(--primary)"></i>' + (Math.round(annual.takenDays * 10) / 10) + ' taken</span><span><i style="background:var(--accent)"></i>' + (Math.round(annual.pendingDays * 10) / 10) + ' pending</span></div>' +
      '<div class="rows mt-3">' + (list || '<p class="muted py-3 text-center text-xs">No requests yet this year.</p>') + '</div>';
  }

  /* ---------- approvals ---------- */

  function renderApprovals(payload) {
    var items = payload.items || [];
    var total = payload.total || items.length;
    var rows = items.slice(0, 3).map(function (item) {
      return '<div><span class="grow"><b class="block truncate font-semibold">' + esc(item.title) + '</b><span class="sub block capitalize">' + esc(item.kind) + '</span></span>' +
        '<a href="' + esc(item.href) + '" class="see-all" style="margin-left:0">Review</a></div>';
    }).join('');
    el('approvals-body').innerHTML =
      '<div class="bignum">' + total + '<small>' + (total === 1 ? 'request waiting' : 'requests waiting') + '</small></div>' +
      (rows ? '<div class="rows mt-3">' + rows + '</div>' : '<p class="mt-3 text-sm" style="color:var(--text-2)">You are all caught up. New requests will land here.</p>') +
      (total > 3 ? '<button type="button" id="open-inbox" class="see-all mt-3" style="margin-left:0">Open inbox</button>' : '');
    var inbox = el('open-inbox');
    if (inbox) inbox.addEventListener('click', function () { var t = document.getElementById('approvals-toggle'); if (t) t.click(); });
  }

  /* ---------- payslip ---------- */

  function renderPayslip(slip) {
    if (!slip) {
      el('payslip-body').innerHTML = '<p class="text-sm" style="color:var(--text-2)">No finalised payslip yet. Your next one will appear here.</p>';
      return;
    }
    var d = new Date(slip.month + '-01T00:00:00');
    var label = d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    var deductions = (slip.deductions.total || 0) - (slip.deductions.attendanceTotal || 0);
    el('payslip-body').innerHTML =
      '<p class="text-xs font-semibold uppercase tracking-wider" style="color:var(--text-2)">' + esc(label) + '</p>' +
      '<div class="bignum mt-1">' + esc(money(slip.netPay, slip.currency)) + '</div>' +
      '<p class="mt-1 text-xs" style="color:var(--text-2)">Net pay · ' + esc(slip.status) + '</p>' +
      '<div class="split"><div><b>' + esc(money(slip.earnings.gross, slip.currency)) + '</b><span>Earned</span></div><div><b>' + esc(money(deductions + (slip.deductions.attendanceTotal || 0), slip.currency)) + '</b><span>Deducted</span></div></div>' +
      '<a class="see-all mt-4" style="margin-left:0;display:inline-block" href="/payroll.html#/payslip/' + esc(slip.id) + '">View payslip</a>';
  }

  /* ---------- schedule ---------- */

  function mondayOf(date) {
    var d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    var offset = (d.getDay() + 6) % 7;
    d.setDate(d.getDate() - offset);
    return d;
  }

  function monthKey(date) { return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0'); }

  async function ensureMonths(days) {
    var needed = Array.from(new Set(days.map(monthKey)));
    await Promise.all(needed.filter(function (m) { return !state.calendars[m]; }).map(function (m) {
      return api.get('/leave/calendar?month=' + m).then(function (payload) { state.calendars[m] = payload; }).catch(function () { state.calendars[m] = { holidays: [], people: [] }; });
    }));
  }

  function eventsFor(dateIso) {
    var cal = state.calendars[dateIso.slice(0, 7)] || { holidays: [], people: [] };
    var holidays = (cal.holidays || []).filter(function (h) { return h.date === dateIso && !h.isOptional; });
    var away = [];
    (cal.people || []).forEach(function (p) {
      (p.requests || []).forEach(function (r) {
        if (r.status !== 'cancelled' && r.status !== 'rejected' && r.fromDate <= dateIso && r.toDate >= dateIso) away.push({ name: p.fullName, request: r });
      });
    });
    return { holidays: holidays, away: away };
  }

  async function renderWeek() {
    var days = [];
    for (var i = 0; i < 7; i += 1) { var d = new Date(state.weekStart); d.setDate(d.getDate() + i); days.push(d); }
    await ensureMonths(days);
    var todayIso = iso(new Date());
    var first = days[0], last = days[6];
    el('cal-month').textContent = first.getMonth() === last.getMonth()
      ? first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
      : first.toLocaleDateString(undefined, { month: 'short' }) + ' – ' + last.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
    el('week-days').innerHTML = days.map(function (d) {
      var key = iso(d);
      var ev = eventsFor(key);
      var cls = 'day' + (key === state.selected ? ' is-sel' : '') + (key === todayIso ? ' is-today' : '') + (ev.holidays.length || ev.away.length ? ' has-event' : '');
      return '<button type="button" class="' + cls + '" data-date="' + key + '"><span>' + d.toLocaleDateString(undefined, { weekday: 'short' }) + '</span><b>' + String(d.getDate()).padStart(2, '0') + '</b></button>';
    }).join('');
    renderDay();
  }

  function renderDay() {
    var ev = eventsFor(state.selected);
    var html = '';
    ev.holidays.forEach(function (h) {
      html += '<div class="event tint-sand"><span class="dico">' + svg(shell.icon.leave, 'h-4 w-4') + '</span><span><b>' + esc(h.name) + '</b><span class="sub block">Public holiday</span></span></div>';
    });
    ev.away.slice(0, 5).forEach(function (a) {
      html += '<div class="event" style="background:var(--surface-alt)">' + avatar(a.name) + '<span class="grow"><b>' + esc(a.name) + '</b><span class="sub block">' + esc(a.request.leaveTypeLabel) + ' · ' + esc(a.request.fromDate === a.request.toDate ? 'one day' : a.request.fromDate + ' → ' + a.request.toDate) + '</span></span>' +
        '<span class="pill ' + (STATUS_TONE[a.request.status] || '') + '">' + esc(a.request.statusLabel) + '</span></div>';
    });
    if (ev.away.length > 5) html += '<p class="muted mt-2 text-center text-xs">and ' + (ev.away.length - 5) + ' more away</p>';
    if (!html) html = '<div class="event" style="background:var(--surface-alt)"><span class="dico">' + svg('<path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5" />', 'h-4 w-4') + '</span><span><b>A clear day</b><span class="sub block">No holidays or time off on this date.</span></span></div>';
    var label = new Date(state.selected + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
    el('day-events').innerHTML = '<p class="kpi-label mb-2">' + esc(label) + '</p>' + html;
  }

  function wireWeek() {
    el('week-prev').addEventListener('click', function () { state.weekStart.setDate(state.weekStart.getDate() - 7); renderWeek(); });
    el('week-next').addEventListener('click', function () { state.weekStart.setDate(state.weekStart.getDate() + 7); renderWeek(); });
    el('week-days').addEventListener('click', function (event) {
      var btn = event.target.closest('[data-date]');
      if (!btn) return;
      state.selected = btn.getAttribute('data-date');
      renderWeek();
    });
  }

  function nextHoliday() {
    var todayIso = iso(new Date());
    var found = null;
    Object.keys(state.calendars).sort().forEach(function (m) {
      ((state.calendars[m] || {}).holidays || []).forEach(function (h) {
        if (!h.isOptional && h.date >= todayIso && (!found || h.date < found.date)) found = h;
      });
    });
    return found;
  }

  /* ---------- news, moments, learning ---------- */

  var NEWS_TINT = { general: 'tint-mint', policy: 'tint-sand', event: 'tint-sea', urgent: 'tint-rose' };

  function renderNews(rows) {
    if (!rows.length) {
      el('news-body').innerHTML = '<p class="py-6 text-center text-sm text-slate-500">No announcements right now.</p>';
      return;
    }
    el('news-body').innerHTML = rows.slice(0, 3).map(function (row) {
      var d = new Date(row.publishedAt);
      return '<a class="news ' + (NEWS_TINT[row.category] || 'tint-mint') + '" href="/company.html"><div class="meta"><span class="chip">' + esc(row.category) + '</span>' +
        (row.pinned ? '<span class="chip">Pinned</span>' : '') + '<span>' + esc(isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })) + '</span></div>' +
        '<h3>' + esc(row.title) + '</h3><p>' + esc(row.body) + '</p></a>';
    }).join('');
  }

  function renderMoments(m) {
    var people = []
      .concat((m.birthdays || []).map(function (r) { return { name: r.fullName, tag: 'Birthday', line: r.inDays === 0 ? 'Today' : r.inDays === 1 ? 'Tomorrow' : 'In ' + r.inDays + ' days' }; }))
      .concat((m.anniversaries || []).map(function (r) { return { name: r.fullName, tag: r.years + (r.years === 1 ? ' year' : ' years'), line: r.inDays === 0 ? 'Today' : 'In ' + r.inDays + ' days' }; }))
      .concat((m.newJoiners || []).map(function (r) { return { name: r.fullName, tag: 'New', line: r.designation }; }))
      .slice(0, 6);
    el('moments-body').innerHTML = people.length
      ? '<div class="grid gap-3 sm:grid-cols-2">' + people.map(function (p) {
          return '<div class="flex items-center gap-3 rounded-2xl p-2.5" style="background:var(--surface-alt)">' + avatar(p.name) +
            '<span class="min-w-0 flex-1"><b class="block truncate text-sm font-semibold">' + esc(p.name) + '</b><span class="block truncate text-xs text-slate-500">' + esc(p.line) + '</span></span>' +
            '<span class="pill info">' + esc(p.tag) + '</span></div>';
        }).join('') + '</div>'
      : '<p class="py-6 text-center text-sm text-slate-500">No birthdays, anniversaries or new joiners in the next two weeks.</p>';
  }

  function renderLearning(payload) {
    var overdue = payload.overdueCount || 0;
    var open = (payload.enrollments || []).filter(function (r) { return r.status === 'enrolled' || r.status === 'pending'; }).length;
    el('learning-body').innerHTML =
      '<div class="bignum">' + overdue + '<small>overdue</small></div>' +
      '<p class="mt-2 text-sm" style="color:var(--text-2)">' + (overdue ? 'Mandatory courses need your attention.' : 'No mandatory courses are overdue.') + '</p>' +
      '<div class="split"><div><b>' + open + '</b><span>In progress</span></div><div><b>' + ((payload.enrollments || []).length - open) + '</b><span>Completed or closed</span></div></div>';
  }

  /* ---------- workforce pulse ---------- */

  function renderPulse(p) {
    var team = p.scope === 'team';
    el('pulse-title').textContent = team ? 'Your team at a glance' : 'Workforce at a glance';
    el('pulse-asof').textContent = 'Updated ' + new Date(p.asOf).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    var attr = p.attritionPct === null || p.attritionPct === undefined ? '—' : p.attritionPct + '%';
    var tiles = [
      ['Headcount', p.headcount, team ? 'in your team' : 'active employees', ''],
      ['New hires', p.newHires, 'joined in the last 30 days', ''],
      ['Away today', p.onLeaveToday, p.awayToday && p.awayToday.length ? p.awayToday.map(function (a) { return (a.name || '').split(' ')[0]; }).filter(Boolean).slice(0, 3).join(', ') : 'everyone is in', ''],
      [team ? 'On notice' : 'Attrition', team ? p.onNotice : attr, team ? 'serving notice' : 'last 12 months (' + p.leavers + ' left)', !team && p.attritionPct > 15 ? 'is-warn' : ''],
    ];
    if (!team && p.openRequisitions !== null) tiles.push(['Open roles', p.openRequisitions, 'requisitions hiring now', '']);
    if (!team) tiles.push(['On notice', p.onNotice, 'serving notice', '']);
    var kpis = '<div class="kpis">' + tiles.slice(0, 6).map(function (t) {
      return '<div class="kpi ' + t[3] + '"><span class="kpi-label">' + esc(t[0]) + '</span><b>' + esc(t[1]) + '</b><small>' + esc(t[2]) + '</small></div>';
    }).join('') + '</div>';

    var max = Math.max.apply(null, p.byDepartment.map(function (d) { return d.count; }).concat([1]));
    var bars = '<div><p class="kpi-label mb-2">By department</p><div class="bars">' + (p.byDepartment.length ? p.byDepartment.map(function (d) {
      return '<div><span class="lbl" title="' + esc(d.department) + '">' + esc(d.department) + '</span><span class="track"><i style="width:' + Math.round((d.count / max) * 100) + '%"></i></span><span class="n">' + d.count + '</span></div>';
    }).join('') : '<p class="muted text-sm">No people yet.</p>') + '</div></div>';

    var attention = '<div><p class="kpi-label mb-2">Needs attention</p>' + (p.attention.length ? p.attention.map(function (a) {
      return '<a class="attn" href="' + esc(a.href) + '"><span class="dot ' + esc(a.severity) + '"></span><span>' + esc(a.message) + '</span><span class="go">›</span></a>';
    }).join('') : '<div class="attn" style="cursor:default"><span class="dot"></span><span>Nothing needs attention right now.</span></div>') + '</div>';

    el('pulse-body').innerHTML = '<div class="pulse">' + kpis + bars + attention + '</div>';
  }

  /* ---------- workspace tiles ---------- */

  function renderModules(user) {
    var groups = [];
    shell.NAV_ITEMS.filter(function (item) { return item.key && (user.modules || []).indexOf(item.key) !== -1; }).forEach(function (item) {
      var last = groups[groups.length - 1];
      if (!last || last.label !== item.group) groups.push({ label: item.group, items: [item] });
      else last.items.push(item);
    });
    el('module-cards').innerHTML = '<div class="ws-wrap">' + groups.map(function (g) {
      return '<div class="ws-group"><h3>' + esc(g.label) + '</h3><div class="ws-grid">' + g.items.map(function (item) {
        return '<a class="ws-tile" href="' + item.href + '" title="' + esc(item.blurb || '') + '"><span class="dico">' + svg(item.icon) + '</span><b>' + esc(item.label) + '</b></a>';
      }).join('') + '</div></div>';
    }).join('') + '</div>';
  }

  /* ---------- init ---------- */

  async function init() {
    var user = await shell.mount('dashboard');
    if (!user) return;
    state.user = user;
    fillIcons();
    renderHero(user);
    renderModules(user);
    wireClock();
    wireWeek();

    state.weekStart = mondayOf(new Date());
    state.selected = iso(new Date());

    var safe = function (promise) { return promise.catch(function () { return null; }); };

    loadClock();

    safe(Promise.all([has('leave') ? api.get('/leave/balances') : null, has('leave') ? api.get('/leave?scope=mine') : null])).then(function (r) {
      if (!r || !r[0]) { el('leave-card').classList.add('hidden'); return; }
      state.employeeId = r[0].employee && r[0].employee.id;
      var annual = (r[0].balances || []).filter(function (b) { return b.code === 'annual'; })[0] || (r[0].balances || [])[0];
      if (annual) setHeroStats({ leave: Math.round(annual.availableDays * 10) / 10 });
      renderLeave(r[0].balances || [], r[1] ? r[1].requests : []);
      if (has('payroll') && state.employeeId) {
        safe(api.get('/payroll?limit=1&employee=' + encodeURIComponent(state.employeeId))).then(function (p) {
          renderPayslip(p && p.payslips && p.payslips[0]);
        });
      } else {
        renderPayslip(null);
      }
    });

    safe(api.get('/approvals')).then(function (p) {
      renderApprovals(p || { items: [], total: 0 });
      setHeroStats({ approvals: (p && p.total) || 0 });
    });

    if (user.role === 'hr_admin' || user.role === 'manager') {
      el('pulse-card').classList.remove('hidden');
      safe(api.get('/company/pulse')).then(function (p) {
        if (p) renderPulse(p); else el('pulse-card').classList.add('hidden');
      });
    }

    safe(has('company') ? api.get('/company/announcements') : null).then(function (p) { renderNews(p ? p.announcements || [] : []); });
    safe(has('company') ? api.get('/company/moments?days=14') : null).then(function (p) { renderMoments(p || {}); });
    safe(has('lms') ? api.get('/lms/me') : null).then(function (p) { if (p) renderLearning(p); else el('learning-card').classList.add('hidden'); });

    renderWeek().then(function () {
      var h = nextHoliday();
      if (h) {
        var diff = Math.round((new Date(h.date + 'T00:00:00') - new Date(iso(new Date()) + 'T00:00:00')) / 86400000);
        setHeroStats({ holiday: { when: diff === 0 ? 'Today' : diff === 1 ? 'Tomorrow' : 'In ' + diff + ' days', name: 'Next holiday · ' + h.name } });
      }
    });
  }

  init().catch(function (err) {
    if (err && err.status === 401) return;
    console.error('Dashboard failed to initialise', err);
  });
})(window, document);
