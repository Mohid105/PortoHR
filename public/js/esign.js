/* E-sign: frozen document packs. A signature is evidence, not a Core HR write. */
(function (window, document) {
  'use strict';

  var api = window.PortoHR.api;
  var shell = window.PortoHR.shell;

  var TONES = {
    sent: 'bg-amber-50 text-amber-700 ring-amber-600/20',
    signed: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
    declined: 'bg-red-50 text-red-700 ring-red-600/20',
    cancelled: 'bg-slate-100 text-slate-500 ring-slate-400/20',
  };

  var state = {
    user: null,
    meta: null,
    packs: [],
    people: [],
    tab: 'mine',
    openId: null,
    pad: { strokes: 0, drawing: false },
    confirm: null,
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
      (TONES[status] || TONES.sent) +
      '">' +
      escapeHtml(label || status) +
      '</span>'
    );
  }

  function formatWhen(value) {
    if (!value) return '';
    var date = new Date(value);
    if (isNaN(date.getTime())) return value;
    return date.toLocaleString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  function setTab(tab) {
    state.tab = tab;
    ['mine', 'done', 'send'].forEach(function (name) {
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
    if (!open) state.openId = null;
  }

  function askConfirm(title, text, onConfirm) {
    el('confirm-title').textContent = title;
    el('confirm-text').textContent = text;
    state.confirm = onConfirm;
    el('confirm-backdrop').classList.remove('hidden');
  }

  function closeConfirm() {
    state.confirm = null;
    el('confirm-backdrop').classList.add('hidden');
  }

  function emptyState(text) {
    return (
      '<p class="rounded-lg border border-dashed border-slate-300 px-4 py-10 text-center text-sm text-slate-500">' +
      escapeHtml(text) +
      '</p>'
    );
  }

  function packCard(row) {
    return (
      '<button type="button" data-open="' +
      escapeHtml(row.id) +
      '" class="w-full rounded-xl border border-slate-200 bg-white p-4 text-left shadow-card transition hover:border-slate-300">' +
      '<div class="flex items-start justify-between gap-3">' +
      '<div><p class="font-medium text-slate-900">' +
      escapeHtml(row.title) +
      '</p><p class="mt-0.5 text-xs text-slate-500">' +
      escapeHtml(row.code + ' · ' + ((row.snapshot && row.snapshot.fullName) || '') + (row.dueOn ? ' · due ' + row.dueOn : '')) +
      '</p></div>' +
      badge(row.status, row.statusLabel) +
      '</div></button>'
    );
  }

  function renderLists() {
    var waiting = state.packs.filter(function (row) {
      return row.status === 'sent';
    });
    var closed = state.packs.filter(function (row) {
      return row.status !== 'sent';
    });
    el('mine-list').innerHTML = waiting.length
      ? '<div class="grid gap-3">' + waiting.map(packCard).join('') + '</div>'
      : emptyState('Nothing waiting for your signature.');
    el('done-list').innerHTML = closed.length
      ? '<div class="grid gap-3">' + closed.map(packCard).join('') + '</div>'
      : emptyState('No signed or closed packs yet.');
  }

  function wirePad(canvas) {
    var ctx = canvas.getContext('2d');
    var ratio = window.devicePixelRatio || 1;
    var cssWidth = canvas.clientWidth || 420;
    var cssHeight = 160;
    canvas.width = Math.floor(cssWidth * ratio);
    canvas.height = Math.floor(cssHeight * ratio);
    canvas.style.height = cssHeight + 'px';
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    state.pad = { strokes: 0, drawing: false, ctx: ctx, canvas: canvas };

    function point(event) {
      var box = canvas.getBoundingClientRect();
      return { x: event.clientX - box.left, y: event.clientY - box.top };
    }

    canvas.addEventListener('pointerdown', function (event) {
      canvas.setPointerCapture(event.pointerId);
      state.pad.drawing = true;
      state.pad.strokes += 1;
      var p = point(event);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
    });
    canvas.addEventListener('pointermove', function (event) {
      if (!state.pad.drawing) return;
      var p = point(event);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
    });
    function stop() {
      state.pad.drawing = false;
    }
    canvas.addEventListener('pointerup', stop);
    canvas.addEventListener('pointercancel', stop);
  }

  function clearPad() {
    if (!state.pad.canvas) return;
    var canvas = state.pad.canvas;
    var ctx = state.pad.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    var ratio = window.devicePixelRatio || 1;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    state.pad.strokes = 0;
  }

  function renderPanel(pack) {
    el('panel-title').textContent = pack.title;
    el('panel-sub').textContent = pack.code + ' · ' + pack.kindLabel + ' · ' + pack.statusLabel;
    var signer = (pack.snapshot && pack.snapshot.fullName) || '';
    var canSign = pack.status === 'sent' && !isHr();
    var html =
      '<article class="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm leading-relaxed text-slate-700 whitespace-pre-wrap">' +
      escapeHtml(pack.body) +
      '</article>' +
      '<dl class="mt-4 grid gap-2 text-xs text-slate-500">' +
      '<div><dt class="font-medium text-slate-600">Signer</dt><dd>' +
      escapeHtml(signer) +
      '</dd></div>' +
      '<div><dt class="font-medium text-slate-600">Body hash</dt><dd class="break-all font-mono">' +
      escapeHtml(pack.bodyHash) +
      (pack.bodyUnchanged ? ' · unchanged' : ' · TAMPERED') +
      '</dd></div>' +
      (pack.contentHash
        ? '<div><dt class="font-medium text-slate-600">Signature hash</dt><dd class="break-all font-mono">' +
          escapeHtml(pack.contentHash) +
          '</dd></div>'
        : '') +
      (pack.signedAt
        ? '<div><dt class="font-medium text-slate-600">Signed</dt><dd>' +
          escapeHtml(pack.typedName + ' · ' + formatWhen(pack.signedAt)) +
          '</dd></div>'
        : '') +
      (pack.declineReason
        ? '<div><dt class="font-medium text-slate-600">Declined</dt><dd>' +
          escapeHtml(pack.declineReason) +
          '</dd></div>'
        : '') +
      '</dl>';

    if (pack.signatureImage) {
      html +=
        '<p class="mt-4 text-xs font-medium text-slate-600">Captured signature</p>' +
        '<img alt="Signature" class="mt-1 max-h-32 rounded-lg border border-slate-200 bg-white" src="' +
        pack.signatureImage.replace(/"/g, '') +
        '" />';
    }

    if (canSign) {
      html +=
        '<form id="sign-form" class="mt-6 space-y-3">' +
        '<label class="block text-sm"><span class="text-xs font-medium text-slate-500">Type your full name</span>' +
        '<input id="sign-name" class="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" required minlength="3" value="' +
        escapeHtml(signer) +
        '" /></label>' +
        '<div><p class="text-xs font-medium text-slate-500">Draw your signature</p>' +
        '<canvas id="sign-pad" class="mt-1 w-full cursor-crosshair rounded-lg border border-slate-300 bg-white"></canvas>' +
        '<button type="button" id="sign-clear" class="mt-1 text-xs font-medium text-slate-500 underline">Clear</button></div>' +
        '<label class="flex items-start gap-2 text-sm text-slate-700"><input id="sign-declare" type="checkbox" class="mt-1" required />' +
        '<span>I confirm this is my signature and I accept the frozen text above. This does not change my Core HR record or payroll.</span></label>' +
        '<div class="flex flex-wrap gap-2">' +
        '<button type="submit" class="rounded-lg bg-[#2054C9] px-4 py-2 text-sm font-semibold text-white">Sign</button>' +
        '<button type="button" id="sign-decline" class="rounded-lg border border-slate-300 px-4 py-2 text-sm">Decline</button>' +
        '</div></form>';
    }

    if (isHr() && pack.status === 'sent') {
      html +=
        '<button type="button" id="pack-cancel" class="mt-4 rounded-lg border border-slate-300 px-3 py-1.5 text-sm">Cancel pack</button>';
    }
    if (pack.status === 'signed') {
      html +=
        '<button type="button" id="pack-evidence" class="mt-4 rounded-lg border border-slate-300 px-3 py-1.5 text-sm">Download evidence JSON</button>';
    }

    el('panel-body').innerHTML = html;

    var pad = el('sign-pad');
    if (pad) wirePad(pad);
    if (el('sign-clear')) el('sign-clear').addEventListener('click', clearPad);

    if (el('sign-form')) {
      el('sign-form').addEventListener('submit', function (event) {
        event.preventDefault();
        if (!state.pad.strokes) {
          toast('Draw your signature before submitting', 'error');
          return;
        }
        api
          .request('/esign/packs/' + pack.id + '/sign', {
            method: 'POST',
            body: {
              typedName: el('sign-name').value,
              signatureImage: state.pad.canvas.toDataURL('image/png'),
              strokeCount: state.pad.strokes,
              declare: el('sign-declare').checked,
            },
          })
          .then(function (payload) {
            toast(payload.message || 'Signed');
            return refresh().then(function () {
              return openPack(pack.id);
            });
          })
          .catch(function (err) {
            toast(err.message || 'Could not sign', 'error');
          });
      });
    }

    if (el('sign-decline')) {
      el('sign-decline').addEventListener('click', function () {
        var reason = window.prompt('Why are you declining this document?');
        if (!reason) return;
        api
          .request('/esign/packs/' + pack.id + '/decline', { method: 'POST', body: { reason: reason } })
          .then(function (payload) {
            toast(payload.message || 'Declined');
            setPanel(false);
            return refresh();
          })
          .catch(function (err) {
            toast(err.message || 'Could not decline', 'error');
          });
      });
    }

    if (el('pack-cancel')) {
      el('pack-cancel').addEventListener('click', function () {
        askConfirm('Cancel this signature pack?', 'The employee will no longer be able to sign it. The document stays on file as cancelled.', function () {
          api
            .request('/esign/packs/' + pack.id + '/cancel', { method: 'POST', body: {} })
            .then(function (payload) {
              toast(payload.message || 'Cancelled');
              setPanel(false);
              return refresh();
            })
            .catch(function (err) {
              toast(err.message || 'Could not cancel', 'error');
            });
        });
      });
    }

    if (el('pack-evidence')) {
      el('pack-evidence').addEventListener('click', function () {
        api.get('/esign/packs/' + pack.id + '/evidence').then(function (payload) {
          var blob = new window.Blob([JSON.stringify(payload.evidence, null, 2)], { type: 'application/json' });
          var url = window.URL.createObjectURL(blob);
          var link = document.createElement('a');
          link.href = url;
          link.download = pack.code + '-evidence.json';
          link.click();
          window.URL.revokeObjectURL(url);
        });
      });
    }
  }

  async function openPack(id) {
    var payload = await api.get('/esign/packs/' + id);
    state.openId = id;
    renderPanel(payload.pack);
    setPanel(true);
  }

  async function refresh() {
    var payload = await api.get('/esign/packs');
    state.packs = payload.packs || [];
    renderLists();
  }

  async function loadPeople() {
    var payload = await api.get('/esign/people');
    state.people = payload.people || [];
    el('send-employee').innerHTML = state.people
      .map(function (person) {
        var selected = person.employeeCode === 'PH-1003' ? ' selected' : '';
        return (
          '<option value="' +
          escapeHtml(person.id) +
          '"' +
          selected +
          '>' +
          escapeHtml(person.fullName + ' · ' + person.employeeCode) +
          '</option>'
        );
      })
      .join('');
  }

  function wire() {
    document.querySelectorAll('.tab-btn').forEach(function (button) {
      button.addEventListener('click', function () {
        setTab(button.getAttribute('data-tab'));
      });
    });
    el('panel-close').addEventListener('click', function () {
      setPanel(false);
    });
    el('panel-backdrop').addEventListener('click', function () {
      setPanel(false);
    });
    document.addEventListener('click', function (event) {
      var open = event.target.closest('[data-open]');
      if (!open) return;
      openPack(open.getAttribute('data-open')).catch(function (err) {
        toast(err.message || 'Could not open pack', 'error');
      });
    });
    el('confirm-cancel').addEventListener('click', closeConfirm);
    el('confirm-backdrop').addEventListener('click', function (event) {
      if (event.target === el('confirm-backdrop')) closeConfirm();
    });
    el('confirm-ok').addEventListener('click', function () {
      var action = state.confirm;
      closeConfirm();
      if (action) action();
    });
    el('send-form').addEventListener('submit', function (event) {
      event.preventDefault();
      api
        .request('/esign/packs', {
          method: 'POST',
          body: {
            employee: el('send-employee').value,
            kind: el('send-kind').value,
            title: el('send-title').value,
            body: el('send-body').value,
            dueOn: el('send-due').value || undefined,
          },
        })
        .then(function (payload) {
          toast(payload.message || 'Sent');
          el('send-form').reset();
          return refresh();
        })
        .catch(function (err) {
          toast(err.message || 'Could not send', 'error');
        });
    });
  }

  async function init() {
    var user = await shell.mount('esign');
    if (!user) return;
    state.user = user;

    var meta = await api.get('/esign/meta');
    state.meta = meta.meta;
    el('send-kind').innerHTML = (state.meta.kinds || [])
      .map(function (kind) {
        return '<option value="' + escapeHtml(kind.value) + '">' + escapeHtml(kind.label) + '</option>';
      })
      .join('');

    if (isHr()) {
      el('page-subtitle').textContent =
        'Send a frozen pack. Signing records consent and never rewrites Core HR or payroll.';
      document.querySelector('[data-tab="send"]').classList.remove('hidden');
      await loadPeople();
    } else {
      el('page-subtitle').textContent =
        'Documents waiting for your signature. Signing is evidence — it does not change your record or pay.';
    }

    wire();
    await refresh();
  }

  init().catch(function (err) {
    if (err && err.status === 401) return;
    console.error('E-sign failed to initialise', err);
  });
})(window, document);
