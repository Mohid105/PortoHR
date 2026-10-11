/* Core HR: the "Reports" tab on an employee, with the four printable PDFs. */
(function (window, document) {
  'use strict';

  var api = window.PortoHR.api;

  function esc(v) {
    return String(v === null || v === undefined ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function ym(date) { return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0'); }

  function mount(host, employee) {
    var id = employee.id || employee._id;
    var perms = employee.permissions || {};
    var now = new Date();
    var year = now.getFullYear();
    var last = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    var cards = [
      {
        kind: 'leave-record', title: "Employee's leave record", file: 'Leave Detail',
        text: 'Every approved leave and absence in a period, with who approved it, and the leave balances.',
        fields: '<label>From<input type="date" name="from" value="' + year + '-01-01" /></label><label>To<input type="date" name="to" value="' + year + '-12-31" /></label>',
      },
      {
        kind: 'time-sheet', title: 'Time sheet (individual attendance)', file: 'Time Sheet',
        text: 'Each day\'s in and out times, rest days, gazetted holidays and absences, with overtime and the month summary.',
        fields: '<label>From month<input type="month" name="from" value="' + ym(now) + '" /></label><label>To month<input type="month" name="to" value="' + ym(now) + '" /></label>',
      },
    ];
    if (perms.canViewReport) {
      cards.push({
        kind: 'salary-sheet', title: 'Monthly salary sheet', file: 'Salary Sheet',
        text: 'Earnings, overtime, allowances, deductions and net pay for each month, in the payroll sheet layout.',
        fields: '<label>From month<input type="month" name="from" value="' + ym(last) + '" /></label><label>To month<input type="month" name="to" value="' + ym(last) + '" /></label>',
      });
    }
    if (perms.canViewPayment) {
      cards.push({
        kind: 'final-settlement', title: 'Final settlement bill', file: 'FFS',
        text: 'The full-and-final bill for a leaver. It exists once a settlement has been prepared under Payroll.',
        fields: '',
      });
    }

    host.innerHTML = '<div class="dl-grid">' + cards.map(function (c) {
      return '<form class="dl-card" data-kind="' + c.kind + '" novalidate><h3>' + esc(c.title) + '</h3><p>' + esc(c.text) + '</p>' +
        (c.fields ? '<div class="dl-fields">' + c.fields + '</div>' : '') +
        '<div class="dl-act"><button type="submit" class="btn btn-primary btn-sm">Download PDF</button><span class="dl-msg" role="status"></span></div></form>';
    }).join('') + '</div>';

    host.addEventListener('submit', async function (event) {
      var form = event.target.closest('.dl-card');
      if (!form) return;
      event.preventDefault();
      var kind = form.getAttribute('data-kind');
      var button = form.querySelector('button');
      var msg = form.querySelector('.dl-msg');
      var query = [];
      Array.prototype.forEach.call(form.querySelectorAll('input[name]'), function (input) {
        if (input.value) query.push(input.name + '=' + encodeURIComponent(input.value));
      });
      button.disabled = true;
      msg.className = 'dl-msg';
      msg.textContent = 'Preparing…';
      try {
        var card = cards.filter(function (c) { return c.kind === kind; })[0];
        await api.download('/employees/' + id + '/downloads/' + kind + (query.length ? '?' + query.join('&') : ''), card.file + '-' + (employee.employeeCode || 'employee') + '.pdf');
        msg.textContent = 'Downloaded.';
      } catch (err) {
        msg.className = 'dl-msg is-bad';
        msg.textContent = err.message || 'Could not make the file.';
      } finally {
        button.disabled = false;
      }
    });
  }

  window.PortoHR = window.PortoHR || {};
  window.PortoHR.employeeDownloads = { mount: mount };
})(window, document);
