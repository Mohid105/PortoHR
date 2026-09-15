/* Recruitment ATS: requisitions, pipeline, internal job board, onboarding. */
(function (window, document) {
  'use strict';

  var api = window.PortoHR.api;
  var shell = window.PortoHR.shell;

  var STAGES = ['applied', 'screening', 'interview', 'offer', 'hired'];
  var TONES = {
    pending: 'bg-amber-50 text-amber-700 ring-amber-600/20',
    open: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
    filled: 'bg-slate-100 text-slate-600 ring-slate-500/20',
    rejected: 'bg-red-50 text-red-700 ring-red-600/20',
    cancelled: 'bg-slate-100 text-slate-500 ring-slate-400/20',
    on_hold: 'bg-sky-50 text-sky-700 ring-sky-600/20',
    sent: 'bg-sky-50 text-sky-700 ring-sky-600/20',
    accepted: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
    hired: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  };

  var state = {
    user: null,
    meta: null,
    tab: 'requisitions',
    requisitions: [],
    applications: [],
    offers: [],
    tasks: [],
    panel: null,
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
    ['requisitions', 'pipeline', 'board', 'onboarding'].forEach(function (name) {
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

  function renderRequisitions() {
    var host = el('req-board');
    if (!state.requisitions.length) {
      host.innerHTML = '<p class="text-sm text-slate-500">No requisitions yet.</p>';
      return;
    }
    host.innerHTML = state.requisitions
      .map(function (row) {
        var actions = '';
        if (isHr() && row.status === 'pending') {
          actions =
            '<div class="mt-3 flex gap-2">' +
            '<button type="button" data-req-decide="' + row.id + '" data-status="approved" class="rounded-lg bg-[#2054C9] px-3 py-1.5 text-xs font-semibold text-white">Approve</button>' +
            '<button type="button" data-req-decide="' + row.id + '" data-status="rejected" class="rounded-lg border border-slate-300 px-3 py-1.5 text-xs">Reject</button></div>';
        }
        return (
          '<article class="rounded-xl border border-slate-200 bg-white p-4 shadow-card">' +
          '<div class="flex items-start justify-between gap-2"><p class="text-sm font-semibold text-slate-900">' +
          escapeHtml(row.title) +
          '</p>' +
          badge(row.status, row.statusLabel) +
          '</div><p class="mt-1 text-xs text-slate-500">' +
          escapeHtml(row.code) +
          (row.positionCode ? ' · ' + escapeHtml(row.positionCode) : '') +
          '</p><p class="mt-2 text-sm text-slate-600">' +
          escapeHtml(row.reason) +
          '</p><p class="mt-3 text-xs text-slate-400">' +
          escapeHtml(row.hiringManagerName || (row.snapshot && row.snapshot.fullName) || '') +
          ' · ' +
          (row.applicationCount || 0) +
          ' candidates</p>' +
          actions +
          '</article>'
        );
      })
      .join('');
  }

  function renderPipeline() {
    var host = el('pipeline-board');
    var labels = {};
    ((state.meta && state.meta.stages) || []).forEach(function (item) {
      labels[item.value] = item.label;
    });
    host.innerHTML = STAGES.map(function (stage) {
      var cards = state.applications
        .filter(function (row) { return row.stage === stage; })
        .map(function (row) {
          var name = row.candidate ? row.candidate.fullName : 'Candidate';
          var next = STAGES[STAGES.indexOf(stage) + 1];
          var actions = '';
          if (canStaff() && next && next !== 'hired' && next !== 'offer') {
            actions =
              '<button type="button" data-move="' + row.id + '" data-stage="' + next + '" class="mt-2 text-xs font-medium text-[#2054C9]">Move to ' +
              escapeHtml(labels[next] || next) +
              '</button>';
          }
          if (isHr() && (stage === 'interview' || stage === 'screening')) {
            actions +=
              '<button type="button" data-offer="' + row.id + '" class="mt-1 block text-xs font-medium text-slate-600">Raise offer</button>';
          }
          if (stage === 'offer') {
            var offer = state.offers.filter(function (item) { return String(item.application) === String(row.id); })[0];
            if (offer && offer.status === 'pending' && !isHr()) {
              actions +=
                '<div class="mt-2 flex gap-2">' +
                '<button type="button" data-offer-decide="' + offer.id + '" data-status="approved" class="text-xs font-semibold text-emerald-700">Approve</button>' +
                '<button type="button" data-offer-decide="' + offer.id + '" data-status="rejected" class="text-xs text-red-600">Reject</button></div>';
            }
            if (isHr() && offer && (offer.status === 'sent' || offer.status === 'approved')) {
              actions +=
                '<button type="button" data-hire="' + offer.id + '" class="mt-1 block text-xs font-semibold text-emerald-700">Hire into Core HR</button>';
            }
          }
          return (
            '<article draggable="' +
            (canStaff() && stage !== 'hired' ? 'true' : 'false') +
            '" data-app="' +
            row.id +
            '" data-from-stage="' +
            stage +
            '" class="cursor-grab rounded-lg border border-slate-200 bg-white p-3 shadow-sm">' +
            '<p class="text-sm font-medium text-slate-900">' +
            escapeHtml(name) +
            '</p><p class="text-xs text-slate-500">' +
            escapeHtml(row.requisitionTitle || '') +
            (row.score ? ' · score ' + row.score : '') +
            '</p>' +
            actions +
            '</article>'
          );
        })
        .join('');
      return (
        '<div class="w-64 shrink-0 rounded-xl border border-slate-200 bg-slate-50 p-3" data-drop-stage="' +
        stage +
        '">' +
        '<p class="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400">' +
        escapeHtml(labels[stage] || stage) +
        '</p><div class="space-y-2">' +
        (cards || '<p class="text-xs text-slate-400">Empty</p>') +
        '</div></div>'
      );
    }).join('');
  }

  function renderBoard() {
    var host = el('job-board');
    var open = state.requisitions.filter(function (row) { return row.status === 'open'; });
    if (!open.length) {
      host.innerHTML = '<p class="text-sm text-slate-500">No internal roles are open right now.</p>';
      return;
    }
    host.innerHTML = open
      .map(function (row) {
        return (
          '<article class="rounded-xl border border-slate-200 bg-white p-5 shadow-card">' +
          '<p class="text-sm font-semibold text-slate-900">' +
          escapeHtml(row.title) +
          '</p><p class="mt-1 text-xs text-slate-500">' +
          escapeHtml(row.department || '') +
          (row.location ? ' · ' + escapeHtml(row.location) : '') +
          '</p><p class="mt-3 text-sm text-slate-600">' +
          escapeHtml(row.reason) +
          '</p><button type="button" data-apply="' +
          row.id +
          '" class="mt-4 rounded-lg bg-[#2054C9] px-3 py-1.5 text-xs font-semibold text-white">Apply internally</button></article>'
        );
      })
      .join('');
  }

  function renderOnboarding() {
    var host = el('onboarding-list');
    if (!state.tasks.length) {
      host.innerHTML = '<p class="px-5 py-10 text-center text-sm text-slate-500">No pre-boarding tasks yet. They appear when an offer is hired into Core HR.</p>';
      return;
    }
    host.innerHTML =
      '<ul class="divide-y divide-slate-100">' +
      state.tasks
        .map(function (task) {
          return (
            '<li class="flex items-center justify-between gap-3 px-5 py-3">' +
            '<div><p class="text-sm font-medium text-slate-900">' +
            escapeHtml(task.title) +
            '</p><p class="text-xs text-slate-400">Owner: ' +
            escapeHtml(task.owner) +
            '</p></div>' +
            (task.status === 'done'
              ? badge('accepted', 'Done')
              : '<button type="button" data-task="' + task.id + '" class="text-xs font-medium text-[#2054C9]">Mark done</button>') +
            '</li>'
          );
        })
        .join('') +
      '</ul>';
  }

  function reqForm() {
    var seats = ((state.meta && state.meta.vacantPositions) || [])
      .map(function (row) {
        return '<option value="' + row.id + '">' + escapeHtml(row.positionCode + ' · ' + row.title) + '</option>';
      })
      .join('');
    var managers = ((state.meta && state.meta.managers) || [])
      .map(function (row) {
        return '<option value="' + row.id + '">' + escapeHtml(row.fullName + ' · ' + row.designation) + '</option>';
      })
      .join('');
    return (
      '<form id="req-form" class="space-y-4">' +
      '<div><label class="block text-sm font-medium text-slate-700">Vacant position</label>' +
      '<select name="position" class="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" required>' +
      seats +
      '</select></div>' +
      (isHr()
        ? '<div><label class="block text-sm font-medium text-slate-700">Hiring manager</label><select name="hiringManager" class="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">' +
          managers +
          '</select></div>'
        : '') +
      '<div><label class="block text-sm font-medium text-slate-700">Reason</label>' +
      '<textarea name="reason" rows="4" required minlength="8" class="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"></textarea></div>' +
      '<button type="submit" class="w-full rounded-lg bg-[#2054C9] py-2.5 text-sm font-semibold text-white">Submit</button></form>'
    );
  }

  function candidateForm() {
    var reqs = state.requisitions
      .filter(function (row) { return row.status === 'open'; })
      .map(function (row) {
        return '<option value="' + row.id + '">' + escapeHtml(row.code + ' · ' + row.title) + '</option>';
      })
      .join('');
    return (
      '<form id="cand-form" class="space-y-3">' +
      '<div><label class="block text-sm font-medium text-slate-700">Requisition</label><select name="requisition" class="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">' +
      reqs +
      '</select></div>' +
      '<div class="grid grid-cols-2 gap-2"><input name="firstName" required placeholder="First name" class="rounded-lg border border-slate-300 px-3 py-2 text-sm" /><input name="lastName" required placeholder="Last name" class="rounded-lg border border-slate-300 px-3 py-2 text-sm" /></div>' +
      '<input name="email" type="email" required placeholder="Email" class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />' +
      '<input name="phone" placeholder="Phone" class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />' +
      '<input name="resumeUrl" placeholder="Resume URL / reference" class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />' +
      '<textarea name="coverNote" rows="3" placeholder="Notes" class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"></textarea>' +
      '<button type="submit" class="w-full rounded-lg bg-[#2054C9] py-2.5 text-sm font-semibold text-white">Add to pipeline</button></form>'
    );
  }

  function offerForm(applicationId) {
    return (
      '<form id="offer-form" data-application="' +
      applicationId +
      '" class="space-y-3">' +
      '<input name="salary" type="number" min="1" step="0.01" required placeholder="Annual / monthly salary" class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />' +
      '<input name="startDate" type="date" required class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />' +
      '<textarea name="letterBody" rows="5" class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">We are pleased to offer you this role at PortoHR.</textarea>' +
      '<button type="submit" class="w-full rounded-lg bg-[#2054C9] py-2.5 text-sm font-semibold text-white">Submit for approval</button></form>'
    );
  }

  function openPanel(title, sub, html) {
    el('panel-title').textContent = title;
    el('panel-sub').textContent = sub || '';
    el('panel-body').innerHTML = html;
    setPanel(true);
  }

  async function loadAll() {
    var reqs = await api.get('/recruitment/requisitions');
    state.requisitions = reqs.requisitions || [];
    if (canStaff()) {
      var apps = await api.get('/recruitment/applications');
      state.applications = apps.applications || [];
      var offers = await api.get('/recruitment/offers');
      state.offers = offers.offers || [];
    } else {
      var mine = await api.get('/recruitment/applications');
      state.applications = mine.applications || [];
      state.offers = [];
    }
    var tasks = await api.get('/recruitment/onboarding');
    state.tasks = tasks.tasks || [];
    renderRequisitions();
    renderPipeline();
    renderBoard();
    renderOnboarding();
  }

  function wire() {
    el('open-req').classList.toggle('hidden', !canStaff());
    el('open-candidate').classList.toggle('hidden', !canStaff());

    el('ats-tabs').addEventListener('click', function (event) {
      var button = event.target.closest('[data-tab]');
      if (button) setTab(button.getAttribute('data-tab'));
    });

    el('pipeline-board').addEventListener('dragstart', function (event) {
      var card = event.target.closest('[data-app]');
      if (!card || card.getAttribute('draggable') !== 'true') return;
      event.dataTransfer.setData('text/plain', card.getAttribute('data-app'));
      event.dataTransfer.effectAllowed = 'move';
    });
    el('pipeline-board').addEventListener('dragover', function (event) {
      if (event.target.closest('[data-drop-stage]')) event.preventDefault();
    });
    el('pipeline-board').addEventListener('drop', function (event) {
      var col = event.target.closest('[data-drop-stage]');
      if (!col) return;
      event.preventDefault();
      var id = event.dataTransfer.getData('text/plain');
      var stage = col.getAttribute('data-drop-stage');
      if (!id || !canStaff()) return;
      if (stage === 'hired') {
        toast('Hire the candidate from an approved offer, not by dragging the card', 'error');
        return;
      }
      if (stage === 'offer') {
        toast('Raise an offer instead of dragging the card to Offer', 'error');
        return;
      }
      api
        .request('/recruitment/applications/' + id, { method: 'PATCH', body: { stage: stage } })
        .then(function () {
          return loadAll();
        })
        .catch(function (err) {
          toast(err.message, 'error');
        });
    });
    el('open-req').addEventListener('click', function () {
      openPanel('New requisition', 'Tied to an approved vacant position.', reqForm());
    });
    el('open-candidate').addEventListener('click', function () {
      openPanel('Add candidate', 'Creates or reuses the person, then opens an application.', candidateForm());
    });
    el('panel-close').addEventListener('click', function () { setPanel(false); });
    el('panel-backdrop').addEventListener('click', function () { setPanel(false); });

    el('panel-body').addEventListener('submit', function (event) {
      var form = event.target;
      if (form.id === 'req-form') {
        event.preventDefault();
        var data = Object.fromEntries(new FormData(form).entries());
        api.post('/recruitment/requisitions', data).then(function (payload) {
          toast(payload.message);
          setPanel(false);
          return loadAll();
        }).catch(function (err) { toast(err.message, 'error'); });
      }
      if (form.id === 'cand-form') {
        event.preventDefault();
        api.post('/recruitment/applications', Object.fromEntries(new FormData(form).entries())).then(function (payload) {
          toast(payload.message);
          setPanel(false);
          setTab('pipeline');
          return loadAll();
        }).catch(function (err) { toast(err.message, 'error'); });
      }
      if (form.id === 'offer-form') {
        event.preventDefault();
        var applicationId = form.getAttribute('data-application');
        api.post('/recruitment/applications/' + applicationId + '/offer', Object.fromEntries(new FormData(form).entries())).then(function (payload) {
          toast(payload.message);
          setPanel(false);
          return loadAll();
        }).catch(function (err) { toast(err.message, 'error'); });
      }
    });

    document.body.addEventListener('click', function (event) {
      var decide = event.target.closest('[data-req-decide]');
      var offerDecide = event.target.closest('[data-offer-decide]');
      var move = event.target.closest('[data-move]');
      var offer = event.target.closest('[data-offer]');
      var hire = event.target.closest('[data-hire]');
      var apply = event.target.closest('[data-apply]');
      var task = event.target.closest('[data-task]');
      if (decide) {
        var status = decide.getAttribute('data-status');
        var note = '';
        if (status === 'rejected') {
          note = window.prompt('Reason?') || '';
          if (!note.trim()) return;
        }
        api.request('/recruitment/requisitions/' + decide.getAttribute('data-req-decide') + '/status', {
          method: 'PATCH',
          body: { status: status, decisionNote: note },
        }).then(function (payload) {
          toast(payload.message);
          if (shell.refreshApprovals) shell.refreshApprovals();
          return loadAll();
        }).catch(function (err) { toast(err.message, 'error'); });
      }
      if (offerDecide) {
        var offerStatus = offerDecide.getAttribute('data-status');
        var offerNote = '';
        if (offerStatus === 'rejected') {
          offerNote = window.prompt('Reason?') || '';
          if (!offerNote.trim()) return;
        }
        api.request('/recruitment/offers/' + offerDecide.getAttribute('data-offer-decide') + '/status', {
          method: 'PATCH',
          body: { status: offerStatus, decisionNote: offerNote },
        }).then(function (payload) {
          toast(payload.message);
          if (shell.refreshApprovals) shell.refreshApprovals();
          return loadAll();
        }).catch(function (err) { toast(err.message, 'error'); });
      }
      if (move) {
        api.request('/recruitment/applications/' + move.getAttribute('data-move'), {
          method: 'PATCH',
          body: { stage: move.getAttribute('data-stage') },
        }).then(function () { return loadAll(); }).catch(function (err) { toast(err.message, 'error'); });
      }
      if (offer) openPanel('Raise offer', 'Hiring manager must approve before it can be hired.', offerForm(offer.getAttribute('data-offer')));
      if (hire) {
        if (!window.confirm('Create the Core HR employee from this accepted offer?')) return;
        api.post('/recruitment/offers/' + hire.getAttribute('data-hire') + '/accept').then(function (payload) {
          toast(payload.message);
          setTab('onboarding');
          return loadAll();
        }).catch(function (err) { toast(err.message, 'error'); });
      }
      if (apply) {
        var cover = window.prompt('Short note for the hiring manager (optional)') || '';
        api.post('/recruitment/apply', { requisition: apply.getAttribute('data-apply'), coverNote: cover }).then(function (payload) {
          toast(payload.message);
          return loadAll();
        }).catch(function (err) { toast(err.message, 'error'); });
      }
      if (task) {
        api.request('/recruitment/onboarding/' + task.getAttribute('data-task'), {
          method: 'PATCH',
          body: { status: 'done' },
        }).then(function () { return loadAll(); }).catch(function (err) { toast(err.message, 'error'); });
      }
    });
  }

  async function init() {
    var user = await shell.mount('recruitment');
    if (!user) return;
    state.user = user;
    if (user.role === 'employee') state.tab = 'board';
    wire();
    state.meta = (await api.get('/recruitment/meta')).meta;
    await loadAll();
    setTab(state.tab);
  }

  init().catch(function (err) {
    if (err && err.status === 401) return;
    console.error('Recruitment failed to initialise', err);
  });
})(window, document);
