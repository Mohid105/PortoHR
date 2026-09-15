/* Assets: catalogue, custody, barcode check-in, facilities, recovery on exit. */
(function (window, document) {
  'use strict';

  var api = window.PortoHR.api;
  var shell = window.PortoHR.shell;

  var TONES = {
    requested: 'bg-amber-50 text-amber-700 ring-amber-600/20',
    issued: 'bg-sky-50 text-sky-700 ring-sky-600/20',
    acknowledged: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
    recovery: 'bg-red-50 text-red-700 ring-red-600/20',
    returned: 'bg-slate-100 text-slate-500 ring-slate-400/20',
    lost: 'bg-red-50 text-red-700 ring-red-600/20',
    available: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
    maintenance: 'bg-amber-50 text-amber-700 ring-amber-600/20',
    retired: 'bg-slate-100 text-slate-500 ring-slate-400/20',
    allocated: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
    open: 'bg-amber-50 text-amber-700 ring-amber-600/20',
    scheduled: 'bg-indigo-50 text-indigo-700 ring-indigo-600/20',
    done: 'bg-slate-100 text-slate-500 ring-slate-400/20',
    cancelled: 'bg-slate-100 text-slate-500 ring-slate-400/20',
    vacated: 'bg-slate-100 text-slate-500 ring-slate-400/20',
  };

  var state = {
    user: null,
    meta: null,
    tab: 'mine',
    assignments: [],
    assets: [],
    people: [],
    checklist: [],
    routes: [],
    rooms: [],
    jobs: [],
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

  function toast(message, tone) {
    var node = document.createElement('div');
    node.className =
      'pointer-events-auto rounded-lg border px-4 py-2.5 text-sm shadow-lg ' +
      (tone === 'error' ? 'border-red-200 bg-red-50 text-red-800' : 'border-emerald-200 bg-emerald-50 text-emerald-800');
    node.textContent = message;
    el('toasts').appendChild(node);
    window.setTimeout(function () {
      node.remove();
    }, 3200);
  }

  function badge(status, label) {
    return (
      '<span class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ' +
      (TONES[status] || TONES.requested) +
      '">' +
      escapeHtml(label || status) +
      '</span>'
    );
  }

  function setTab(tab) {
    state.tab = tab;
    ['mine', 'register', 'recovery', 'facilities', 'maintenance'].forEach(function (name) {
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

  function options(list) {
    return (list || [])
      .map(function (row) {
        return '<option value="' + escapeHtml(row.value) + '">' + escapeHtml(row.label) + '</option>';
      })
      .join('');
  }

  function peopleOptions() {
    return (state.people || [])
      .map(function (row) {
        return '<option value="' + row.id + '">' + escapeHtml(row.fullName) + ' · ' + escapeHtml(row.employeeCode) + '</option>';
      })
      .join('');
  }

  function empty(hostId, text) {
    el(hostId).innerHTML = '<p class="text-sm text-slate-500">' + text + '</p>';
  }

  function myOpen() {
    var rows = (state.assignments || []).filter(function (row) {
      return ['requested', 'issued', 'acknowledged', 'recovery'].indexOf(row.status) !== -1;
    });
    if (!isHr()) return rows;
    var code = state.user && state.user.employeeId;
    return rows.filter(function (row) {
      return row.snapshot && row.snapshot.employeeCode === code;
    });
  }

  function pendingRequests() {
    return (state.assignments || []).filter(function (row) {
      return row.status === 'requested';
    });
  }

  function availableAssets() {
    return (state.assets || []).filter(function (row) {
      return row.status === 'available' && !row.assignmentStatus;
    });
  }

  function renderMine() {
    var rows = myOpen();
    if (!rows.length) {
      empty('mine-list', 'Nothing on issue. Request kit from the catalogue when you need it.');
      return;
    }
    el('mine-list').innerHTML =
      '<ul class="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-card">' +
      rows
        .map(function (row) {
          var asset = row.asset || {};
          return (
            '<li><button type="button" data-open="' +
            row.id +
            '" class="flex w-full items-center justify-between gap-3 px-5 py-3 text-left hover:bg-slate-50">' +
            '<div><p class="text-sm font-medium">' +
            escapeHtml(asset.name || 'Asset') +
            '</p><p class="text-xs text-slate-400">' +
            escapeHtml(asset.code || '') +
            (asset.barcode ? ' · ' + escapeHtml(asset.barcode) : '') +
            (row.dueOn ? ' · due ' + escapeHtml(row.dueOn) : '') +
            '</p></div>' +
            badge(row.status, row.statusLabel) +
            '</button></li>'
          );
        })
        .join('') +
      '</ul>';
  }

  function renderRegister() {
    var pending = pendingRequests();
    var rows = state.assets || [];
    var queue =
      pending.length
        ? '<h2 class="text-sm font-semibold">Open requests</h2><ul class="mt-3 mb-8 divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-card">' +
          pending
            .map(function (row) {
              var asset = row.asset || {};
              return (
                '<li><button type="button" data-open="' +
                row.id +
                '" class="flex w-full items-center justify-between gap-3 px-5 py-3 text-left hover:bg-slate-50">' +
                '<div><p class="text-sm font-medium">' +
                escapeHtml(asset.name || 'Asset') +
                '</p><p class="text-xs text-slate-400">' +
                escapeHtml(row.holder || '') +
                ' · ' +
                escapeHtml(asset.code || '') +
                '</p></div>' +
                badge(row.status, row.statusLabel) +
                '</button></li>'
              );
            })
            .join('') +
          '</ul>'
        : '';
    if (!rows.length) {
      el('register-list').innerHTML = queue + '<p class="text-sm text-slate-500">The register is empty.</p>';
      return;
    }
    el('register-list').innerHTML =
      queue +
      '<h2 class="text-sm font-semibold">Catalogue</h2><ul class="mt-3 divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-card">' +
      rows
        .map(function (row) {
          return (
            '<li class="flex items-center justify-between gap-3 px-5 py-3">' +
            '<div><p class="text-sm font-medium">' +
            escapeHtml(row.code) +
            ' · ' +
            escapeHtml(row.name) +
            '</p><p class="text-xs text-slate-400">' +
            escapeHtml(row.categoryLabel) +
            (row.barcode ? ' · ' + escapeHtml(row.barcode) : '') +
            (row.holder ? ' · ' + escapeHtml(row.holder) : '') +
            (row.bookValue != null ? ' · book ' + escapeHtml(String(row.bookValue)) + ' ' + escapeHtml(row.currency || '') : '') +
            '</p></div>' +
            badge(row.assignmentStatus || row.status, row.assignmentStatus || row.statusLabel) +
            '</li>'
          );
        })
        .join('') +
      '</ul>';
  }

  function renderRecovery() {
    var groups = state.checklist || [];
    if (!groups.length) {
      empty('recovery-list', 'No one on notice or exit currently holds company property.');
      return;
    }
    el('recovery-list').innerHTML = groups
      .map(function (group) {
        var items =
          (group.assignments || [])
            .map(function (row) {
              return (
                '<li class="flex items-center justify-between gap-3 px-5 py-3">' +
                '<div><p class="text-sm font-medium">' +
                escapeHtml((row.asset && row.asset.name) || 'Asset') +
                '</p><p class="text-xs text-slate-400">' +
                escapeHtml((row.asset && row.asset.code) || '') +
                (row.dueOn ? ' · due ' + escapeHtml(row.dueOn) : '') +
                '</p></div>' +
                '<div class="flex items-center gap-2">' +
                badge(row.status, row.statusLabel) +
                '<button type="button" data-complete="' +
                row.id +
                '" class="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-semibold hover:bg-slate-50">Return</button></div></li>'
              );
            })
            .join('') +
          (group.accommodation || [])
            .map(function (row) {
              return (
                '<li class="flex items-center justify-between gap-3 px-5 py-3 text-sm"><span>' +
                escapeHtml(row.site) +
                ' · ' +
                escapeHtml(row.room) +
                '</span>' +
                badge(row.status, row.statusLabel) +
                '</li>'
              );
            })
            .join('') +
          (group.transport || [])
            .map(function (row) {
              return (
                '<li class="px-5 py-3 text-sm text-slate-600">' +
                escapeHtml(row.route) +
                ' · ' +
                escapeHtml(row.departsAt) +
                '</li>'
              );
            })
            .join('');
        return (
          '<article class="mb-4 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-card">' +
          '<div class="border-b border-slate-100 px-5 py-3"><p class="text-sm font-semibold">' +
          escapeHtml(group.fullName) +
          ' · ' +
          escapeHtml(group.employeeCode) +
          '</p><p class="text-xs text-slate-400">' +
          escapeHtml(group.designation) +
          (group.lastWorkingDay ? ' · last day ' + escapeHtml(group.lastWorkingDay) : '') +
          ' · ' +
          group.outstanding +
          ' outstanding</p></div><ul class="divide-y divide-slate-100">' +
          (items || '<li class="px-5 py-3 text-sm text-slate-500">Cleared.</li>') +
          '</ul></article>'
        );
      })
      .join('');
  }

  function renderFacilities() {
    var routes = state.routes || [];
    el('route-list').innerHTML =
      '<div class="flex items-center justify-between"><h2 class="text-sm font-semibold">Transport</h2>' +
      (isHr()
        ? '<button type="button" id="open-route" class="text-sm font-semibold text-[#2054C9]">New route</button>'
        : '') +
      '</div>' +
      (routes.length
        ? '<ul class="mt-3 divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-card">' +
          routes
            .map(function (row) {
              var mine = (row.mine || [])[0];
              return (
                '<li class="flex items-center justify-between gap-3 px-5 py-3">' +
                '<div><p class="text-sm font-medium">' +
                escapeHtml(row.name) +
                '</p><p class="text-xs text-slate-400">' +
                escapeHtml(row.origin) +
                ' → ' +
                escapeHtml(row.destination) +
                ' · ' +
                escapeHtml(row.departsAt) +
                ' · ' +
                row.occupied +
                '/' +
                row.capacity +
                (mine ? ' · your seat ' + escapeHtml(mine.seat || mine.statusLabel) : '') +
                '</p></div>' +
                (mine
                  ? '<button type="button" data-cancel-seat="' +
                    row.id +
                    '" data-slot="' +
                    mine.id +
                    '" class="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-semibold hover:bg-slate-50">Cancel</button>'
                  : '<button type="button" data-request-seat="' +
                    row.id +
                    '" class="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-semibold hover:bg-slate-50">' +
                    (isHr() ? 'Allocate' : 'Request') +
                    '</button>') +
                '</li>'
              );
            })
            .join('') +
          '</ul>'
        : '<p class="mt-3 text-sm text-slate-500">No routes published.</p>');

    var rooms = state.rooms || [];
    el('room-list').innerHTML =
      '<div class="flex items-center justify-between"><h2 class="text-sm font-semibold">Accommodation</h2>' +
      (isHr()
        ? '<button type="button" id="open-room" class="text-sm font-semibold text-[#2054C9]">Allocate room</button>'
        : '') +
      '</div>' +
      (rooms.length
        ? '<ul class="mt-3 divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-card">' +
          rooms
            .map(function (row) {
              return (
                '<li class="flex items-center justify-between gap-3 px-5 py-3">' +
                '<div><p class="text-sm font-medium">' +
                escapeHtml(row.site) +
                ' · ' +
                escapeHtml(row.room) +
                (row.bed ? ' / ' + escapeHtml(row.bed) : '') +
                '</p><p class="text-xs text-slate-400">' +
                (row.holder ? escapeHtml(row.holder) + ' · ' : '') +
                'in ' +
                escapeHtml(row.checkInOn) +
                '</p></div>' +
                (isHr() && (row.status === 'allocated' || row.status === 'requested')
                  ? '<button type="button" data-vacate="' +
                    row.id +
                    '" class="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-semibold hover:bg-slate-50">Vacate</button>'
                  : badge(row.status, row.statusLabel)) +
                '</li>'
              );
            })
            .join('') +
          '</ul>'
        : '<p class="mt-3 text-sm text-slate-500">No hostel allocation on file for you.</p>');
  }

  function renderJobs() {
    var rows = state.jobs || [];
    var toolbar =
      '<div class="mb-3 flex justify-end"><button type="button" id="open-job" class="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-semibold hover:bg-slate-50">Log a fault</button></div>';
    if (!rows.length) {
      el('job-list').innerHTML = toolbar + '<p class="text-sm text-slate-500">No maintenance jobs.</p>';
      return;
    }
    el('job-list').innerHTML =
      toolbar +
      '<ul class="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-card">' +
      rows
        .map(function (row) {
          return (
            '<li class="flex items-center justify-between gap-3 px-5 py-3">' +
            '<div><p class="text-sm font-medium">' +
            escapeHtml(row.summary) +
            '</p><p class="text-xs text-slate-400">' +
            escapeHtml((row.asset && row.asset.name) || '') +
            (row.scheduledOn ? ' · ' + escapeHtml(row.scheduledOn) : '') +
            (row.vendor ? ' · ' + escapeHtml(row.vendor) : '') +
            '</p></div>' +
            '<div class="flex items-center gap-2">' +
            badge(row.status, row.statusLabel) +
            (isHr() && row.status !== 'done' && row.status !== 'cancelled'
              ? '<button type="button" data-job="' +
                row.id +
                '" class="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-semibold hover:bg-slate-50">Update</button>'
              : '') +
            '</div></li>'
          );
        })
        .join('') +
      '</ul>';
  }

  function renderAll() {
    renderMine();
    if (isHr()) {
      renderRegister();
      renderRecovery();
    }
    renderFacilities();
    renderJobs();
  }

  function requestForm() {
    var avail = availableAssets();
    if (!avail.length) return '<p class="text-sm text-slate-500">Nothing is free to request right now.</p>';
    return (
      '<form id="request-form" class="space-y-3">' +
      '<select name="asset" required class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">' +
      avail
        .map(function (row) {
          return '<option value="' + row.id + '">' + escapeHtml(row.name) + ' · ' + escapeHtml(row.code) + '</option>';
        })
        .join('') +
      '</select>' +
      '<textarea name="note" rows="3" placeholder="Why do you need it?" class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"></textarea>' +
      '<button type="submit" class="w-full rounded-lg bg-[#2054C9] py-2.5 text-sm font-semibold text-white">Submit request</button></form>'
    );
  }

  function assetForm() {
    return (
      '<form id="asset-form" class="space-y-3">' +
      '<select name="category" class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">' +
      options((state.meta && state.meta.categories) || []) +
      '</select>' +
      '<input name="name" required minlength="3" placeholder="Name" class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />' +
      '<input name="serial" placeholder="Serial" class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />' +
      '<input name="barcode" placeholder="Barcode / QR code" class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />' +
      '<input name="location" placeholder="Location" class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />' +
      '<input name="purchaseValue" type="number" min="0" placeholder="Purchase value" class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />' +
      '<input name="residualValue" type="number" min="0" placeholder="Residual value" class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />' +
      '<input name="usefulLifeMonths" type="number" min="1" placeholder="Useful life (months)" class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />' +
      '<input name="purchaseDate" type="date" class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />' +
      '<button type="submit" class="w-full rounded-lg bg-[#2054C9] py-2.5 text-sm font-semibold text-white">Add to register</button></form>'
    );
  }

  function scanForm() {
    return (
      '<form id="scan-form" class="space-y-3">' +
      '<input name="barcode" required placeholder="Barcode" class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm uppercase" />' +
      '<label class="block text-xs font-medium text-slate-500">Employee (required to check out a free item)</label>' +
      '<select name="employee" class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"><option value="">—</option>' +
      peopleOptions() +
      '</select>' +
      '<p class="text-xs text-slate-400">An issued barcode checks the item back in. A free barcode checks it out.</p>' +
      '<button type="submit" class="w-full rounded-lg bg-[#2054C9] py-2.5 text-sm font-semibold text-white">Scan</button></form>'
    );
  }

  function issueForm() {
    var avail = availableAssets();
    if (!avail.length) return '<p class="text-sm text-slate-500">No free assets to issue.</p>';
    return (
      '<form id="issue-form" class="space-y-3">' +
      '<select name="employee" required class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">' +
      peopleOptions() +
      '</select>' +
      '<select name="asset" required class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">' +
      avail
        .map(function (row) {
          return '<option value="' + row.id + '">' + escapeHtml(row.name) + ' · ' + escapeHtml(row.code) + '</option>';
        })
        .join('') +
      '</select>' +
      '<select name="conditionOut" class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">' +
      options((state.meta && state.meta.conditions) || []) +
      '</select>' +
      '<button type="submit" class="w-full rounded-lg bg-[#2054C9] py-2.5 text-sm font-semibold text-white">Issue now</button></form>'
    );
  }

  function assignmentDetail(row) {
    var asset = row.asset || {};
    var html =
      '<dl class="space-y-2 text-sm">' +
      '<div class="flex justify-between"><dt class="text-slate-500">Status</dt><dd>' +
      badge(row.status, row.statusLabel) +
      '</dd></div>' +
      '<div class="flex justify-between"><dt class="text-slate-500">Code</dt><dd class="font-medium">' +
      escapeHtml(asset.code || '') +
      '</dd></div>' +
      (asset.barcode
        ? '<div class="flex justify-between"><dt class="text-slate-500">Barcode</dt><dd>' + escapeHtml(asset.barcode) + '</dd></div>'
        : '') +
      (row.issuedOn
        ? '<div class="flex justify-between"><dt class="text-slate-500">Issued</dt><dd>' + escapeHtml(row.issuedOn) + '</dd></div>'
        : '') +
      (row.dueOn
        ? '<div class="flex justify-between"><dt class="text-slate-500">Due</dt><dd>' + escapeHtml(row.dueOn) + '</dd></div>'
        : '') +
      (row.note ? '<p class="pt-2 text-slate-600">' + escapeHtml(row.note) + '</p>' : '') +
      '</dl>';
    if (row.status === 'issued' && row.access === 'party') {
      html +=
        '<form id="ack-form" data-id="' +
        row.id +
        '" class="mt-4"><button type="submit" class="w-full rounded-lg bg-[#2054C9] py-2.5 text-sm font-semibold text-white">Acknowledge custody</button></form>';
    }
    if (['issued', 'acknowledged'].indexOf(row.status) !== -1) {
      html +=
        '<form id="return-req-form" data-id="' +
        row.id +
        '" class="mt-2"><button type="submit" class="w-full rounded-lg border border-slate-200 py-2 text-sm font-semibold">Request return</button></form>';
    }
    if (isHr() && ['requested', 'issued', 'acknowledged', 'recovery'].indexOf(row.status) !== -1) {
      if (row.status === 'requested') {
        html +=
          '<form id="issue-open-form" data-id="' +
          row.id +
          '" class="mt-2"><button type="submit" class="w-full rounded-lg bg-[#2054C9] py-2.5 text-sm font-semibold text-white">Issue</button></form>';
      }
      html +=
        '<form id="return-form" data-id="' +
        row.id +
        '" class="mt-2 space-y-2"><select name="conditionIn" class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">' +
        options((state.meta && state.meta.conditions) || []) +
        '</select><button type="submit" class="w-full rounded-lg border border-slate-200 py-2 text-sm font-semibold">Complete return</button></form>';
    }
    return html;
  }

  function routeAllocateForm(routeId) {
    if (isHr()) {
      return (
        '<form id="seat-form" data-id="' +
        routeId +
        '" class="space-y-3"><select name="employee" required class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">' +
        peopleOptions() +
        '</select><input name="seat" placeholder="Seat (optional)" class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" /><button type="submit" class="w-full rounded-lg bg-[#2054C9] py-2.5 text-sm font-semibold text-white">Allocate</button></form>'
      );
    }
    return (
      '<form id="seat-form" data-id="' +
      routeId +
      '" class="space-y-3"><p class="text-sm text-slate-500">Ask for a seat on this shuttle. HR confirms the allocation.</p><button type="submit" class="w-full rounded-lg bg-[#2054C9] py-2.5 text-sm font-semibold text-white">Request seat</button></form>'
    );
  }

  function roomForm() {
    return (
      '<form id="room-form" class="space-y-3">' +
      '<select name="employee" required class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">' +
      peopleOptions() +
      '</select>' +
      '<input name="site" required placeholder="Site" class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />' +
      '<input name="room" required placeholder="Room" class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />' +
      '<input name="bed" placeholder="Bed" class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />' +
      '<input name="monthlyCharge" type="number" min="0" placeholder="Monthly charge (reference)" class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />' +
      '<button type="submit" class="w-full rounded-lg bg-[#2054C9] py-2.5 text-sm font-semibold text-white">Allocate</button></form>'
    );
  }

  function jobForm() {
    var held = myOpen().filter(function (row) {
      return ['issued', 'acknowledged', 'recovery'].indexOf(row.status) !== -1;
    });
    var choices = isHr() ? state.assets : held.map(function (row) { return row.asset; }).filter(Boolean);
    if (!choices.length) return '<p class="text-sm text-slate-500">No kit in custody to raise a job against.</p>';
    return (
      '<form id="job-form" class="space-y-3">' +
      '<select name="asset" required class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">' +
      choices
        .map(function (row) {
          return '<option value="' + row.id + '">' + escapeHtml(row.name) + ' · ' + escapeHtml(row.code || '') + '</option>';
        })
        .join('') +
      '</select>' +
      '<select name="kind" class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">' +
      options((state.meta && state.meta.maintenanceKinds) || []) +
      '</select>' +
      '<input name="summary" required minlength="5" placeholder="What is wrong?" class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />' +
      '<textarea name="notes" rows="3" class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"></textarea>' +
      '<button type="submit" class="w-full rounded-lg bg-[#2054C9] py-2.5 text-sm font-semibold text-white">Log job</button></form>'
    );
  }

  function jobUpdateForm(id) {
    return (
      '<form id="job-update-form" data-id="' +
      id +
      '" class="space-y-3">' +
      '<input name="scheduledOn" type="date" class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />' +
      '<input name="vendor" placeholder="Vendor" class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />' +
      '<input name="cost" type="number" min="0" placeholder="Cost" class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />' +
      '<textarea name="notes" rows="3" class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"></textarea>' +
      '<button name="intent" value="schedule" type="submit" class="w-full rounded-lg border border-slate-200 py-2 text-sm font-semibold">Schedule</button>' +
      '<button name="intent" value="complete" type="submit" class="w-full rounded-lg bg-[#2054C9] py-2.5 text-sm font-semibold text-white">Mark done</button></form>'
    );
  }

  async function loadAll() {
    var tasks = [
      api.get('/assets/meta'),
      api.get('/assets/assignments'),
      api.get('/assets/assets'),
      api.get('/assets/routes'),
      api.get('/assets/accommodation'),
      api.get('/assets/maintenance'),
    ];
    if (isHr()) {
      tasks.push(api.get('/assets/people'));
      tasks.push(api.get('/assets/recovery'));
    }
    var results = await Promise.all(tasks);
    state.meta = results[0].meta;
    state.assignments = results[1].assignments || [];
    state.assets = results[2].assets || [];
    state.routes = results[3].routes || [];
    state.rooms = results[4].rooms || [];
    state.jobs = results[5].jobs || [];
    if (isHr()) {
      state.people = results[6].people || [];
      state.checklist = results[7].checklist || [];
    }
    renderAll();
  }

  function handled(promise, close) {
    return promise
      .then(function (payload) {
        toast(payload.message || 'Saved');
        if (close) setPanel(false);
        return loadAll();
      })
      .catch(function (err) {
        toast(err.message, 'error');
      });
  }

  function wire() {
    if (isHr()) {
      ['open-scan', 'open-asset', 'open-issue', 'export-file'].forEach(function (id) {
        var button = el(id);
        if (button) button.classList.remove('hidden');
      });
      document.querySelectorAll('[data-tab="register"], [data-tab="recovery"]').forEach(function (button) {
        button.classList.remove('hidden');
      });
    }

    el('asset-tabs').addEventListener('click', function (event) {
      var button = event.target.closest('[data-tab]');
      if (button) setTab(button.getAttribute('data-tab'));
    });

    el('panel-close').addEventListener('click', function () {
      setPanel(false);
    });
    el('panel-backdrop').addEventListener('click', function () {
      setPanel(false);
    });

    el('open-request').addEventListener('click', function () {
      openPanel('Request an asset', 'HR issues from the register.', requestForm());
    });
    el('open-scan').addEventListener('click', function () {
      openPanel('Barcode check-in / out', 'Type the code — camera scanning is not wired.', scanForm());
    });
    el('open-issue').addEventListener('click', function () {
      openPanel('Issue an asset', 'Hands kit to an employee without a prior request.', issueForm());
    });
    el('open-asset').addEventListener('click', function () {
      openPanel('Add asset', 'Depreciation is a Finance reference only.', assetForm());
    });
    el('export-file').addEventListener('click', function () {
      api.get('/assets/export').then(function (payload) {
        var blob = new window.Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
        var url = window.URL.createObjectURL(blob);
        var link = document.createElement('a');
        link.href = url;
        link.download = 'portohr-assets-finance.json';
        link.click();
        window.URL.revokeObjectURL(url);
        toast('Finance export downloaded');
      });
    });

    document.body.addEventListener('click', function (event) {
      var open = event.target.closest('[data-open]');
      if (open) {
        api.get('/assets/assignments/' + open.getAttribute('data-open')).then(function (payload) {
          var row = payload.assignment;
          openPanel((row.asset && row.asset.name) || 'Assignment', row.asset && row.asset.code, assignmentDetail(row));
        });
        return;
      }
      var complete = event.target.closest('[data-complete]');
      if (complete) {
        handled(api.post('/assets/assignments/' + complete.getAttribute('data-complete') + '/return', { complete: true }));
        return;
      }
      var vacate = event.target.closest('[data-vacate]');
      if (vacate) {
        handled(api.post('/assets/accommodation/' + vacate.getAttribute('data-vacate') + '/vacate', {}));
        return;
      }
      var reqSeat = event.target.closest('[data-request-seat]');
      if (reqSeat) {
        openPanel(isHr() ? 'Allocate a seat' : 'Request a seat', '', routeAllocateForm(reqSeat.getAttribute('data-request-seat')));
        return;
      }
      var cancelSeat = event.target.closest('[data-cancel-seat]');
      if (cancelSeat) {
        handled(
          api.post(
            '/assets/routes/' +
              cancelSeat.getAttribute('data-cancel-seat') +
              '/allocations/' +
              cancelSeat.getAttribute('data-slot') +
              '/cancel',
            {}
          )
        );
        return;
      }
      var job = event.target.closest('[data-job]');
      if (job) {
        openPanel('Update job', '', jobUpdateForm(job.getAttribute('data-job')));
        return;
      }
      if (event.target.id === 'open-route') {
        openPanel(
          'New route',
          '',
          '<form id="route-form" class="space-y-3"><input name="name" required placeholder="Name" class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" /><input name="origin" required placeholder="Origin" class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" /><input name="destination" required placeholder="Destination" class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" /><input name="departsAt" required placeholder="08:15" class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" /><input name="capacity" type="number" min="1" value="12" class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" /><button type="submit" class="w-full rounded-lg bg-[#2054C9] py-2.5 text-sm font-semibold text-white">Publish</button></form>'
        );
        return;
      }
      if (event.target.id === 'open-room') {
        openPanel('Allocate a room', 'Charge is a reference, not a payroll deduction.', roomForm());
        return;
      }
      if (event.target.id === 'open-job') {
        openPanel('Log a fault', '', jobForm());
      }
    });

    el('panel-body').addEventListener('submit', function (event) {
      event.preventDefault();
      var form = event.target;
      var data = Object.fromEntries(new FormData(form).entries());
      var id = form.getAttribute('data-id');
      if (form.id === 'request-form') {
        handled(api.post('/assets/assignments', data), true);
      } else if (form.id === 'asset-form') {
        handled(api.post('/assets/assets', data), true);
      } else if (form.id === 'scan-form') {
        handled(api.post('/assets/scan', data), true);
      } else if (form.id === 'issue-form') {
        handled(api.post('/assets/assignments', Object.assign({}, data, { issue: true })), true);
      } else if (form.id === 'ack-form') {
        handled(api.post('/assets/assignments/' + id + '/acknowledge', {}), true);
      } else if (form.id === 'return-req-form') {
        handled(api.post('/assets/assignments/' + id + '/return', {}), true);
      } else if (form.id === 'issue-open-form') {
        handled(api.post('/assets/assignments/' + id + '/issue', {}), true);
      } else if (form.id === 'return-form') {
        handled(api.post('/assets/assignments/' + id + '/return', Object.assign({}, data, { complete: true })), true);
      } else if (form.id === 'seat-form') {
        handled(api.post('/assets/routes/' + id + '/allocate', data), true);
      } else if (form.id === 'room-form') {
        handled(api.post('/assets/accommodation', data), true);
      } else if (form.id === 'route-form') {
        handled(api.post('/assets/routes', data), true);
      } else if (form.id === 'job-form') {
        handled(api.post('/assets/maintenance', data), true);
      } else if (form.id === 'job-update-form') {
        var submitter = event.submitter && event.submitter.value;
        if (submitter === 'complete') handled(api.post('/assets/maintenance/' + id + '/complete', data), true);
        else handled(api.post('/assets/maintenance/' + id + '/schedule', data), true);
      }
    });
  }

  async function init() {
    var user = await shell.mount('assets');
    if (!user) return;
    state.user = user;
    wire();
    await loadAll();
    setTab(isHr() ? 'register' : 'mine');
  }

  init().catch(function (err) {
    if (err && err.status === 401) return;
    console.error('Assets failed to initialise', err);
  });
})(window, document);
