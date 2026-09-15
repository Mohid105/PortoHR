/* Learning LMS: catalogue, calendar, enrollments, certificates, compliance. */
(function (window, document) {
  'use strict';

  var api = window.PortoHR.api;
  var shell = window.PortoHR.shell;

  var TONES = {
    pending: 'bg-amber-50 text-amber-700 ring-amber-600/20',
    enrolled: 'bg-sky-50 text-sky-700 ring-sky-600/20',
    completed: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
    rejected: 'bg-red-50 text-red-700 ring-red-600/20',
    cancelled: 'bg-slate-100 text-slate-500 ring-slate-400/20',
    no_show: 'bg-red-50 text-red-700 ring-red-600/20',
    published: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
    draft: 'bg-slate-100 text-slate-600 ring-slate-500/20',
    valid: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
    expiring: 'bg-amber-50 text-amber-700 ring-amber-600/20',
    expired: 'bg-red-50 text-red-700 ring-red-600/20',
    overdue: 'bg-red-50 text-red-700 ring-red-600/20',
  };

  var state = {
    user: null,
    meta: null,
    tab: 'mine',
    mine: { enrollments: [], certifications: [], overdueCount: 0, gap: [] },
    courses: [],
    sessions: [],
    team: [],
    people: [],
    compliance: { mandatory: [], expiring: [], pending: [] },
  };

  function el(id) {
    return document.getElementById(id);
  }

  function escapeHtml(value) {
    return String(value === null || value === undefined ? '' : value).replace(/[&<>"']/g, function (char) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char];
    });
  }

  function isHr() {
    return state.user && state.user.role === 'hr_admin';
  }

  function canStaff() {
    return state.user && state.user.role !== 'employee';
  }

  function toast(message, tone) {
    var node = document.createElement('div');
    node.className =
      'pointer-events-auto rounded-lg border px-4 py-2.5 text-sm shadow-lg ' +
      (tone === 'error' ? 'border-red-200 bg-red-50 text-red-800' : 'border-emerald-200 bg-emerald-50 text-emerald-800');
    node.textContent = message;
    el('toasts').appendChild(node);
    window.setTimeout(function () { node.remove(); }, 3200);
  }

  function badge(status, label) {
    return (
      '<span class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ' +
      (TONES[status] || TONES.pending) +
      '">' +
      escapeHtml(label || status) +
      '</span>'
    );
  }

  function setTab(tab) {
    state.tab = tab;
    ['mine', 'catalogue', 'calendar', 'team', 'compliance'].forEach(function (name) {
      var panel = el('tab-' + name);
      if (panel) panel.classList.toggle('hidden', name !== tab);
    });
    document.querySelectorAll('.tab-btn').forEach(function (button) {
      var active = button.getAttribute('data-tab') === tab;
      button.classList.toggle('border-[#2054C9]', active);
      button.classList.toggle('border-transparent', !active);
      button.classList.toggle('font-semibold', active);
      button.classList.toggle('text-slate-900', active);
      button.classList.toggle('text-slate-500', !active);
    });
  }

  function setPanel(open) {
    el('side-panel').classList.toggle('translate-x-full', !open);
    el('panel-backdrop').classList.toggle('hidden', !open);
  }

  function openPanel(title, sub, html) {
    el('panel-title').textContent = title;
    el('panel-sub').textContent = sub || '';
    el('panel-body').innerHTML = html;
    setPanel(true);
  }

  function formatWhen(iso) {
    if (!iso) return '';
    var date = new Date(iso);
    if (Number.isNaN(date.getTime())) return String(iso).slice(0, 10);
    return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  }

  function renderMine() {
    var summary = el('mine-summary');
    var enrolled = state.mine.enrollments.filter(function (row) { return row.status === 'enrolled'; }).length;
    var done = state.mine.enrollments.filter(function (row) { return row.status === 'completed'; }).length;
    summary.innerHTML =
      '<div class="rounded-xl border border-slate-200 bg-white p-4 shadow-card"><p class="text-xs font-semibold uppercase tracking-wider text-slate-400">In progress</p><p class="mt-1 text-2xl font-semibold">' +
      enrolled +
      '</p></div>' +
      '<div class="rounded-xl border border-slate-200 bg-white p-4 shadow-card"><p class="text-xs font-semibold uppercase tracking-wider text-slate-400">Completed</p><p class="mt-1 text-2xl font-semibold">' +
      done +
      '</p></div>' +
      '<div class="rounded-xl border border-slate-200 bg-white p-4 shadow-card"><p class="text-xs font-semibold uppercase tracking-wider text-slate-400">Overdue</p><p class="mt-1 text-2xl font-semibold ' +
      (state.mine.overdueCount ? 'text-red-700' : '') +
      '">' +
      state.mine.overdueCount +
      '</p></div>';

    var rows = state.mine.enrollments;
    var certs = state.mine.certifications;
    var gap = (state.mine.gap || []).filter(function (item) { return item.required; });
    var html = '';
    if (!rows.length) {
      html += '<p class="text-sm text-slate-500">Nothing on your plan yet. Request a course from the catalogue.</p>';
    } else {
      html += '<div class="space-y-3">' + rows.map(function (row) {
        var actions = '';
        if (row.status === 'enrolled' && row.delivery !== 'instructor_led') {
          actions += '<button type="button" data-complete="' + row.id + '" class="mt-2 text-xs font-semibold text-emerald-700">Mark complete</button>';
        }
        if (row.status === 'pending') {
          actions += '<button type="button" data-cancel="' + row.id + '" class="mt-2 text-xs font-medium text-slate-500">Cancel request</button>';
        }
        return (
          '<article class="rounded-xl border border-slate-200 bg-white p-4 shadow-card">' +
          '<div class="flex items-start justify-between gap-2"><p class="text-sm font-semibold text-slate-900">' +
          escapeHtml(row.courseTitle) +
          '</p>' +
          badge(row.overdue ? 'overdue' : row.status, row.overdue ? 'Overdue' : row.statusLabel) +
          '</div><p class="mt-1 text-xs text-slate-500">' +
          escapeHtml(row.deliveryLabel || '') +
          (row.dueDate ? ' · due ' + escapeHtml(row.dueDate) : '') +
          '</p>' +
          actions +
          '</article>'
        );
      }).join('') + '</div>';
    }
    if (certs.length) {
      html += '<h3 class="mt-8 text-sm font-semibold text-slate-900">Certificates</h3><ul class="mt-3 divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">' +
        certs.map(function (row) {
          return (
            '<li class="flex items-center justify-between gap-3 px-4 py-3"><div><p class="text-sm font-medium">' +
            escapeHtml(row.title) +
            '</p><p class="text-xs text-slate-400">Issued ' +
            escapeHtml(row.issuedAt) +
            (row.expiresAt ? ' · expires ' + escapeHtml(row.expiresAt) : '') +
            '</p></div>' +
            badge(row.status, row.statusLabel) +
            '</li>'
          );
        }).join('') +
        '</ul>';
    }
    if (gap.length) {
      html += '<h3 class="mt-8 text-sm font-semibold text-slate-900">Competency gap</h3><p class="mt-1 text-xs text-slate-500">Mandatory course competencies you have not completed yet.</p><div class="mt-3 flex flex-wrap gap-2">' +
        gap.map(function (item) {
          return badge(item.held ? 'completed' : 'overdue', item.name + (item.held ? '' : ' · gap'));
        }).join('') +
        '</div>';
    }
    el('mine-list').innerHTML = html;
  }

  function renderCatalogue() {
    var host = el('catalogue-list');
    if (!state.courses.length) {
      host.innerHTML = '<p class="text-sm text-slate-500">No published courses yet.</p>';
      return;
    }
    host.innerHTML = state.courses.map(function (row) {
      var actions =
        row.delivery === 'instructor_led'
          ? '<p class="mt-3 text-xs text-slate-500">Pick a date on the Calendar tab.</p>'
          : '<button type="button" data-request="' + row.id + '" class="mt-3 text-xs font-semibold text-[#2054C9]">Request a seat</button>';
      return (
        '<article class="rounded-xl border border-slate-200 bg-white p-4 shadow-card">' +
        '<div class="flex items-start justify-between gap-2"><p class="text-sm font-semibold text-slate-900">' +
        escapeHtml(row.title) +
        '</p>' +
        (row.mandatory ? badge('overdue', 'Mandatory') : badge(row.status, row.statusLabel)) +
        '</div><p class="mt-1 text-xs text-slate-500">' +
        escapeHtml(row.code) +
        ' · ' +
        escapeHtml(row.deliveryLabel) +
        ' · ' +
        escapeHtml(String(row.durationHours)) +
        'h</p><p class="mt-2 text-sm text-slate-600">' +
        escapeHtml(row.summary || '') +
        '</p>' +
        actions +
        '</article>'
      );
    }).join('');
  }

  function renderCalendar() {
    var host = el('calendar-list');
    if (!state.sessions.length) {
      host.innerHTML = '<p class="text-sm text-slate-500">No classroom sessions on the calendar.</p>';
      return;
    }
    host.innerHTML = state.sessions.map(function (row) {
      return (
        '<article class="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-card">' +
        '<div><p class="text-sm font-semibold text-slate-900">' +
        escapeHtml(row.course.title || 'Session') +
        '</p><p class="mt-1 text-xs text-slate-500">' +
        escapeHtml(formatWhen(row.startsAt)) +
        (row.location ? ' · ' + escapeHtml(row.location) : '') +
        (row.instructorName ? ' · ' + escapeHtml(row.instructorName) : '') +
        '</p></div><div class="text-right"><p class="text-xs text-slate-500">' +
        (row.seatsLeft || 0) +
        ' seats left</p>' +
        '<button type="button" data-request="' +
        (row.course.id || '') +
        '" data-session="' +
        row.id +
        '" class="mt-1 text-xs font-semibold text-[#2054C9]">Request</button></div></article>'
      );
    }).join('');
  }

  function renderTeam() {
    var host = el('team-list');
    if (!state.team.length) {
      host.innerHTML = '<p class="px-5 py-10 text-center text-sm text-slate-500">No team enrollments yet.</p>';
      return;
    }
    host.innerHTML =
      '<ul class="divide-y divide-slate-100">' +
      state.team.map(function (row) {
        var actions = '';
        if (row.status === 'pending') {
          actions =
            '<button type="button" data-enroll-decide="' + row.id + '" data-status="approved" class="text-xs font-semibold text-emerald-700">Approve</button>' +
            '<button type="button" data-enroll-decide="' + row.id + '" data-status="rejected" class="ml-2 text-xs text-red-600">Reject</button>';
        }
        if (row.status === 'enrolled' && row.sessionId && canStaff()) {
          actions +=
            '<button type="button" data-attend="' + row.id + '" data-present="true" class="ml-2 text-xs font-medium text-[#2054C9]">Present</button>' +
            '<button type="button" data-attend="' + row.id + '" data-present="false" class="ml-2 text-xs text-slate-500">No-show</button>';
        }
        if (row.status === 'enrolled' && (row.attended === true || row.delivery !== 'instructor_led') && canStaff()) {
          actions += '<button type="button" data-complete="' + row.id + '" class="ml-2 text-xs font-semibold text-emerald-700">Complete</button>';
        }
        return (
          '<li class="flex flex-wrap items-center justify-between gap-3 px-5 py-3">' +
          '<div><p class="text-sm font-medium text-slate-900">' +
          escapeHtml(row.learner) +
          ' · ' +
          escapeHtml(row.courseTitle) +
          '</p><p class="text-xs text-slate-400">' +
          escapeHtml(row.sourceLabel) +
          (row.dueDate ? ' · due ' + escapeHtml(row.dueDate) : '') +
          '</p></div><div class="flex items-center gap-3">' +
          badge(row.overdue ? 'overdue' : row.status, row.overdue ? 'Overdue' : row.statusLabel) +
          actions +
          '</div></li>'
        );
      }).join('') +
      '</ul>';
  }

  function renderCompliance() {
    var host = el('compliance-board');
    function block(title, items, empty, renderItem) {
      return (
        '<section><h3 class="text-sm font-semibold text-slate-900">' +
        title +
        '</h3>' +
        (items.length
          ? '<ul class="mt-3 divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">' + items.map(renderItem).join('') + '</ul>'
          : '<p class="mt-2 text-sm text-slate-500">' + empty + '</p>') +
        '</section>'
      );
    }
    host.innerHTML =
      block('Mandatory still open', state.compliance.mandatory, 'Everyone assigned a mandatory course has finished it.', function (row) {
        return (
          '<li class="flex items-center justify-between gap-3 px-4 py-3"><div><p class="text-sm font-medium">' +
          escapeHtml(row.learner) +
          ' · ' +
          escapeHtml(row.courseTitle) +
          '</p><p class="text-xs text-slate-400">Due ' +
          escapeHtml(row.dueDate || '—') +
          '</p></div>' +
          badge(row.overdue ? 'overdue' : 'enrolled', row.overdue ? 'Overdue' : 'Open') +
          '</li>'
        );
      }) +
      block('Certificates expiring', state.compliance.expiring, 'No certificates in the 45-day window.', function (row) {
        return (
          '<li class="flex items-center justify-between gap-3 px-4 py-3"><div><p class="text-sm font-medium">' +
          escapeHtml(row.holder || row.title) +
          '</p><p class="text-xs text-slate-400">Expires ' +
          escapeHtml(row.expiresAt || '') +
          '</p></div>' +
          badge(row.status, row.statusLabel) +
          '</li>'
        );
      }) +
      block('Waiting on approval', state.compliance.pending, 'No learning requests in the queue.', function (row) {
        return (
          '<li class="flex items-center justify-between gap-3 px-4 py-3"><div><p class="text-sm font-medium">' +
          escapeHtml(row.learner) +
          ' · ' +
          escapeHtml(row.courseTitle) +
          '</p></div>' +
          badge('pending', row.statusLabel) +
          '</li>'
        );
      });
  }

  function courseForm() {
    var comps = ((state.meta && state.meta.competencies) || [])
      .map(function (row) {
        return '<option value="' + escapeHtml(row.code) + '">' + escapeHtml(row.name) + '</option>';
      })
      .join('');
    return (
      '<form id="course-form" class="space-y-3">' +
      '<input name="title" required minlength="3" placeholder="Course title" class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />' +
      '<textarea name="summary" rows="3" placeholder="Summary" class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"></textarea>' +
      '<select name="delivery" class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">' +
      '<option value="elearning">E-learning</option><option value="instructor_led">Instructor-led</option><option value="external">External</option></select>' +
      '<input name="durationHours" type="number" min="0.5" step="0.5" value="1" class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />' +
      '<select name="competencies" multiple class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">' + comps + '</select>' +
      '<label class="flex items-center gap-2 text-sm"><input type="checkbox" name="mandatory" value="true" /> Mandatory</label>' +
      '<label class="flex items-center gap-2 text-sm"><input type="checkbox" name="issuesCertificate" value="true" /> Issues certificate</label>' +
      '<input name="validityMonths" type="number" min="0" placeholder="Validity months (0 = none)" class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />' +
      '<button type="submit" class="w-full rounded-lg bg-[#2054C9] py-2.5 text-sm font-semibold text-white">Save course</button></form>'
    );
  }

  function sessionForm() {
    var courses = state.courses
      .filter(function (row) { return row.delivery === 'instructor_led'; })
      .map(function (row) {
        return '<option value="' + row.id + '">' + escapeHtml(row.title) + '</option>';
      })
      .join('');
    return (
      '<form id="session-form" class="space-y-3">' +
      '<select name="course" class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">' + courses + '</select>' +
      '<input name="startsAt" type="datetime-local" required class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />' +
      '<input name="endsAt" type="datetime-local" required class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />' +
      '<input name="location" placeholder="Location" class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />' +
      '<input name="instructorName" placeholder="Instructor" class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />' +
      '<input name="capacity" type="number" min="1" value="16" class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />' +
      '<button type="submit" class="w-full rounded-lg bg-[#2054C9] py-2.5 text-sm font-semibold text-white">Schedule</button></form>'
    );
  }

  function assignForm() {
    var courses = state.courses
      .map(function (row) {
        return '<option value="' + row.id + '">' + escapeHtml(row.title) + '</option>';
      })
      .join('');
    var people = (state.people || [])
      .map(function (row) {
        return '<option value="' + row.id + '">' + escapeHtml(row.fullName + ' · ' + row.employeeCode) + '</option>';
      })
      .join('');
    return (
      '<form id="assign-form" class="space-y-3">' +
      '<select name="employee" class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">' + people + '</select>' +
      '<select name="course" class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">' + courses + '</select>' +
      '<input name="dueDate" type="date" class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />' +
      '<label class="flex items-center gap-2 text-sm"><input type="checkbox" name="mandatory" value="true" /> Treat as mandatory</label>' +
      '<button type="submit" class="w-full rounded-lg bg-[#2054C9] py-2.5 text-sm font-semibold text-white">Nominate</button></form>'
    );
  }

  async function loadAll() {
    var mine = await api.get('/lms/me');
    state.mine = mine;
    var courses = await api.get('/lms/courses');
    state.courses = courses.courses || [];
    var sessions = await api.get('/lms/sessions');
    state.sessions = sessions.sessions || [];
    if (canStaff()) {
      var enrollments = await api.get('/lms/enrollments');
      state.team = enrollments.enrollments || [];
      var team = await api.get('/lms/team');
      state.people = team.people || [];
      var compliance = await api.get('/lms/compliance');
      state.compliance = compliance;
    }
    renderMine();
    renderCatalogue();
    renderCalendar();
    if (canStaff()) {
      renderTeam();
      renderCompliance();
    }
  }

  function formPayload(form) {
    var data = Object.fromEntries(new FormData(form).entries());
    var multi = form.querySelector('[name="competencies"]');
    if (multi && multi.multiple) {
      data.competencies = Array.prototype.map.call(multi.selectedOptions, function (opt) { return opt.value; });
    }
    data.mandatory = Boolean(form.querySelector('[name="mandatory"]:checked'));
    data.issuesCertificate = Boolean(form.querySelector('[name="issuesCertificate"]:checked'));
    return data;
  }

  function wire() {
    el('open-course').classList.toggle('hidden', !isHr());
    el('open-session').classList.toggle('hidden', !isHr());
    el('open-assign').classList.toggle('hidden', !canStaff());
    document.querySelector('[data-tab="team"]').classList.toggle('hidden', !canStaff());
    document.querySelector('[data-tab="compliance"]').classList.toggle('hidden', !canStaff());

    el('lms-tabs').addEventListener('click', function (event) {
      var button = event.target.closest('[data-tab]');
      if (button) setTab(button.getAttribute('data-tab'));
    });
    el('open-course').addEventListener('click', function () {
      openPanel('New course', 'Published courses appear on the catalogue immediately.', courseForm());
    });
    el('open-session').addEventListener('click', function () {
      openPanel('Schedule session', 'Instructor-led courses only.', sessionForm());
    });
    el('open-assign').addEventListener('click', function () {
      openPanel('Nominate a learner', 'Managers can nominate direct reports; HR can assign anyone.', assignForm());
    });
    el('panel-close').addEventListener('click', function () { setPanel(false); });
    el('panel-backdrop').addEventListener('click', function () { setPanel(false); });

    el('panel-body').addEventListener('submit', function (event) {
      var form = event.target;
      if (form.id === 'course-form') {
        event.preventDefault();
        api.post('/lms/courses', formPayload(form)).then(function (payload) {
          toast(payload.message);
          setPanel(false);
          return loadAll();
        }).catch(function (err) { toast(err.message, 'error'); });
      }
      if (form.id === 'session-form') {
        event.preventDefault();
        api.post('/lms/sessions', Object.fromEntries(new FormData(form).entries())).then(function (payload) {
          toast(payload.message);
          setPanel(false);
          return loadAll();
        }).catch(function (err) { toast(err.message, 'error'); });
      }
      if (form.id === 'assign-form') {
        event.preventDefault();
        api.post('/lms/enrollments', formPayload(form)).then(function (payload) {
          toast(payload.message);
          setPanel(false);
          return loadAll();
        }).catch(function (err) { toast(err.message, 'error'); });
      }
    });

    document.body.addEventListener('click', function (event) {
      var request = event.target.closest('[data-request]');
      var complete = event.target.closest('[data-complete]');
      var cancel = event.target.closest('[data-cancel]');
      var decide = event.target.closest('[data-enroll-decide]');
      var attend = event.target.closest('[data-attend]');
      if (request) {
        var body = { course: request.getAttribute('data-request') };
        if (request.getAttribute('data-session')) body.session = request.getAttribute('data-session');
        api.post('/lms/enrollments', body).then(function (payload) {
          toast(payload.message);
          setTab('mine');
          return loadAll();
        }).catch(function (err) { toast(err.message, 'error'); });
      }
      if (complete) {
        var score = window.prompt('Effectiveness score 1–5 (optional)') || '';
        api.post('/lms/enrollments/' + complete.getAttribute('data-complete') + '/complete', {
          feedbackScore: score || undefined,
        }).then(function (payload) {
          toast(payload.message);
          return loadAll();
        }).catch(function (err) { toast(err.message, 'error'); });
      }
      if (cancel) {
        api.post('/lms/enrollments/' + cancel.getAttribute('data-cancel') + '/cancel').then(function (payload) {
          toast(payload.message);
          return loadAll();
        }).catch(function (err) { toast(err.message, 'error'); });
      }
      if (decide) {
        var status = decide.getAttribute('data-status');
        var note = '';
        if (status === 'rejected') {
          note = window.prompt('Reason?') || '';
          if (!note.trim()) return;
        }
        api.request('/lms/enrollments/' + decide.getAttribute('data-enroll-decide') + '/status', {
          method: 'PATCH',
          body: { status: status, decisionNote: note },
        }).then(function (payload) {
          toast(payload.message);
          if (shell.refreshApprovals) shell.refreshApprovals();
          return loadAll();
        }).catch(function (err) { toast(err.message, 'error'); });
      }
      if (attend) {
        api.post('/lms/enrollments/' + attend.getAttribute('data-attend') + '/attend', {
          present: attend.getAttribute('data-present') !== 'false',
        }).then(function (payload) {
          toast(payload.message);
          return loadAll();
        }).catch(function (err) { toast(err.message, 'error'); });
      }
    });
  }

  async function init() {
    var user = await shell.mount('lms');
    if (!user) return;
    state.user = user;
    wire();
    state.meta = (await api.get('/lms/meta')).meta;
    await loadAll();
    setTab(state.tab);
  }

  init().catch(function (err) {
    if (err && err.status === 401) return;
    console.error('Learning failed to initialise', err);
  });
})(window, document);
