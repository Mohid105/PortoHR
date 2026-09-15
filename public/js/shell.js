/* Renders the authenticated app shell: grouped sidebar, header, theme, approvals. */
(function (window, document) {
  'use strict';

  var api = window.PortoHR.api;
  var session = window.PortoHR.session;
  var THEME_KEY = 'portohr.theme';

  var icon = {
    dashboard:
      '<path d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM13.5 6A2.25 2.25 0 0115.75 3.75H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 018.25 20.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />',
    core_hr:
      '<path d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />',
    attendance:
      '<path d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />',
    leave:
      '<path d="M6.75 3v2.25M17.25 3v2.25M3 8.25h18M4.5 6.75h15A1.5 1.5 0 0121 8.25v11.25A1.5 1.5 0 0119.5 21h-15A1.5 1.5 0 013 19.5V8.25A1.5 1.5 0 014.5 6.75zM12 12v6m-3-3h6" />',
    payroll:
      '<path d="M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75M15 10.5a3 3 0 11-6 0 3 3 0 016 0zm3 0h.008v.008H18V10.5zm-12 0h.008v.008H6V10.5z" />',
    loans:
      '<path d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />',
    compensation:
      '<path d="M16.5 18.75h-9m9 0a3 3 0 013 3h-15a3 3 0 013-3m9 0v-3.375c0-.621-.503-1.125-1.125-1.125h-.871M7.5 18.75v-3.375c0-.621.504-1.125 1.125-1.125h.872m5.007 0H9.497m5.007 0a7.454 7.454 0 01-.982-3.172M9.497 14.25a7.454 7.454 0 00.981-3.172M5.25 4.236c-.982.143-1.954.317-2.916.52A6.003 6.003 0 007.73 9.728M5.25 4.236V4.5c0 2.108.966 3.99 2.48 5.228M5.25 4.236V2.721C7.456 2.41 9.71 2.25 12 2.25c2.291 0 4.545.16 6.75.47v1.516M7.73 9.728a6.726 6.726 0 002.748 1.35m8.272-6.842V4.5c0 2.108-.966 3.99-2.48 5.228m2.48-5.492a46.32 46.32 0 012.916.52 6.003 6.003 0 01-5.395 4.972m0 0a6.726 6.726 0 01-2.749 1.35m0 0a6.772 6.772 0 01-3.044 0" />',
    benefits:
      '<path d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z" />',
    pms: '<path d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />',
    recruitment:
      '<path d="M20.25 14.15v4.25a2.25 2.25 0 01-2.25 2.25h-12A2.25 2.25 0 013.75 18.4v-4.25m16.5 0a2.25 2.25 0 00-1.07-1.91l-5.18-3.11a2.25 2.25 0 00-2.25 0L4.82 12.24a2.25 2.25 0 00-1.07 1.91m16.5 0H3.75M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />',
    lms: '<path d="M4.26 10.147a60.436 60.436 0 00-.491 6.347A48.627 48.627 0 0112 20.904a48.627 48.627 0 018.232-4.41 60.46 60.46 0 00-.491-6.347m-15.482 0a50.57 50.57 0 00-2.658-.813A59.905 59.905 0 0112 3.493a59.902 59.902 0 0110.399 5.84c-.896.248-1.783.52-2.658.814m-15.482 0A50.697 50.697 0 0112 13.489a50.702 50.702 0 017.74-3.342M6.75 15a.75.75 0 100-1.5.75.75 0 000 1.5zm0 0v-3.675A55.378 55.378 0 0112 8.443m-7.007 11.55A5.981 5.981 0 006.75 15.75v-1.5" />',
    compliance:
      '<path d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.623 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />',
    grievance:
      '<path d="M12 3v17.25m0 0c-1.472 0-2.882.265-4.185.75M12 20.25c1.472 0 2.882.265 4.185.75M18.75 4.97A48.416 48.416 0 0012 4.5c-2.291 0-4.545.16-6.75.47m13.5 0c1.01.143 2.01.317 3 .52m-3-.52l2.62 10.726c.122.499-.106 1.028-.589 1.202a5.988 5.988 0 01-2.031.352 5.988 5.988 0 01-2.031-.352c-.483-.174-.711-.703-.589-1.202L18.75 4.971zm-16.5.52c.99-.203 1.99-.377 3-.52m0 0l2.62 10.726c.122.499-.106 1.028-.589 1.202a5.989 5.989 0 01-2.031.352 5.989 5.989 0 01-2.031-.352c-.483-.174-.711-.703-.589-1.202L5.25 4.971z" />',
    esign:
      '<path d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />',
    assets:
      '<path d="M21 7.5l-9-5.25L3 7.5m18 0l-9 5.25m9-5.25v9l-9 5.25M3 7.5l9 5.25M3 7.5v9l9 5.25m0-9v9" />',
    analytics:
      '<path d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />',
    admin:
      '<path d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" /><path d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />',
    logout:
      '<path d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15M12 9l-3 3m0 0l3 3m-3-3h12.75" />',
    sun: '<path d="M12 3v1.5M12 19.5V21M4.22 4.22l1.06 1.06M18.72 18.72l1.06 1.06M3 12h1.5M19.5 12H21M4.22 19.78l1.06-1.06M18.72 5.28l1.06-1.06M12 7.5a4.5 4.5 0 100 9 4.5 4.5 0 000-9z" />',
    moon: '<path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />',
  };

  var NAV_ITEMS = [
    { key: null, label: 'Dashboard', href: '/dashboard.html', icon: icon.dashboard, group: null },
    {
      key: 'core_hr',
      label: 'Core HR',
      href: '/core-hr.html',
      icon: icon.core_hr,
      group: 'Core HR & Org',
      ready: true,
      blurb: 'Person, position and grade masters, effective-dated assignments, documents and maker-checker workflows.',
    },
    {
      key: 'attendance',
      label: 'Attendance',
      href: '/attendance.html',
      icon: icon.attendance,
      group: 'Time & Pay',
      ready: true,
      blurb: 'Clock in and out, overtime, short days and the monthly time log.',
    },
    {
      key: 'leave',
      label: 'Leave',
      href: '/leave.html',
      icon: icon.leave,
      group: 'Time & Pay',
      ready: true,
      blurb: 'Apply for leave, track balances, approve requests and see the team calendar.',
    },
    {
      key: 'payroll',
      label: 'Payroll',
      href: '/payroll.html',
      icon: icon.payroll,
      group: 'Time & Pay',
      ready: true,
      blurb: 'Monthly payroll runs, payslips, overtime pay and arrears that never rewrite a closed period.',
    },
    {
      key: 'loans',
      label: 'Loans',
      href: '/finance.html#loans',
      icon: icon.loans,
      group: 'Time & Pay',
      ready: true,
      blurb: 'Apply for a salary loan and track approvals and repayment schedules.',
    },
    {
      key: 'compensation',
      label: 'Compensation',
      href: '/finance.html#compensation',
      icon: icon.compensation,
      group: 'Time & Pay',
      ready: true,
      blurb: 'Claim travel allowance and annual benefits with receipt references.',
    },
    {
      key: 'benefits',
      label: 'Benefits',
      href: '/benefits.html',
      icon: icon.benefits,
      group: 'Time & Pay',
      ready: true,
      blurb: 'Medical, life and retirement plans with grade defaults, dependents and open enrollment.',
    },
    {
      key: 'recruitment',
      label: 'Recruitment',
      href: '/recruitment.html',
      icon: icon.recruitment,
      group: 'Talent',
      ready: true,
      blurb: 'Requisitions, candidate pipeline, offers and conversion into a Core HR hire.',
    },
    {
      key: 'lms',
      label: 'Learning',
      href: '/lms.html',
      icon: icon.lms,
      group: 'Talent',
      ready: true,
      blurb: 'Course catalogue, nominations, classroom sessions and certificate expiry.',
    },
    {
      key: 'pms',
      label: 'PMS',
      href: '/pms.html',
      icon: icon.pms,
      group: 'Talent',
      ready: true,
      blurb: 'Objectives, KPIs, self-assessment and supervisor reviews.',
    },
    {
      key: 'compliance',
      label: 'Compliance',
      href: '/compliance.html',
      icon: icon.compliance,
      group: 'Employee Relations & Compliance',
      ready: true,
      blurb: 'Filing calendar, licence renewals, policy acknowledgements and audit export.',
    },
    {
      key: 'grievance',
      label: 'Grievance',
      href: '/grievance.html',
      icon: icon.grievance,
      group: 'Employee Relations & Compliance',
      ready: true,
      blurb: 'Confidential grievances and disciplinary cases with a party-only status view.',
    },
    {
      key: 'esign',
      label: 'E-sign',
      href: '/esign.html',
      icon: icon.esign,
      group: 'Employee Relations & Compliance',
      ready: true,
      blurb: 'Send a frozen document for signature. Signing is evidence — it never rewrites Core HR or payroll.',
    },
    {
      key: 'assets',
      label: 'Assets',
      href: '/assets.html',
      icon: icon.assets,
      group: 'Assets',
      ready: true,
      blurb: 'IT kit, ID cards, vehicles, shuttle seats and hostel rooms, with recovery on separation.',
    },
    {
      key: 'analytics',
      label: 'Analytics',
      href: '/analytics.html',
      icon: icon.analytics,
      group: 'Analytics',
      ready: true,
      blurb: 'Role-scoped dashboards, as-of headcount, data-quality exceptions, rule-based outlook and audited report export.',
    },
    {
      key: 'admin',
      label: 'Admin',
      href: '/admin.html',
      icon: icon.admin,
      group: 'Admin',
      ready: true,
      blurb: 'Tenant settings, role matrix, workflow designer, delegation, notifications and connectors.',
    },
  ];

  function chromeHtml() {
    return [
      '<aside id="sidebar" class="fixed inset-y-0 left-0 z-40 flex w-64 -translate-x-full flex-col border-r border-white/10 bg-[#101B33] transition-transform duration-200 lg:translate-x-0 dark:bg-[#141922]">',
      '  <div class="flex h-16 shrink-0 items-center gap-3 border-b border-white/10 px-6">',
      '    <div class="flex h-9 w-9 items-center justify-center rounded-lg bg-[#2054C9] text-sm font-bold text-white">P</div>',
      '    <div class="leading-tight">',
      '      <p class="text-sm font-semibold tracking-tight text-white">PortoHR</p>',
      '      <p class="text-xs text-slate-400">Workspace</p>',
      '    </div>',
      '  </div>',
      '  <div class="flex-1 overflow-y-auto px-3 py-4">',
      '    <nav id="sidebar-nav" class="space-y-4" aria-label="Main navigation"></nav>',
      '  </div>',
      '  <div class="shrink-0 border-t border-white/10 p-3">',
      '    <a href="#" data-action="logout" class="group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-slate-300 transition-colors hover:bg-white/10 hover:text-white">',
      svg(icon.logout, 'text-slate-400 group-hover:text-white'),
      '      <span>Sign out</span>',
      '    </a>',
      '  </div>',
      '</aside>',
      '<div id="sidebar-backdrop" class="fixed inset-0 z-30 hidden bg-slate-900/40 lg:hidden"></div>',

      '<header id="app-header" class="fixed inset-x-0 top-0 z-20 h-16 border-b border-slate-200 bg-white/90 backdrop-blur lg:pl-64 dark:border-[#2A2F3A] dark:bg-[#1A1E27]/90">',
      '  <div class="flex h-full items-center gap-4 px-4 sm:px-6">',
      '    <button id="sidebar-toggle" type="button" class="-ml-1 rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900 lg:hidden" aria-label="Toggle navigation">',
      '      <svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke-width="1.8" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" /></svg>',
      '    </button>',
      '    <div class="relative hidden max-w-xs flex-1 sm:block">',
      '      <svg class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" fill="none" viewBox="0 0 24 24" stroke-width="1.8" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" /></svg>',
      '      <input type="search" placeholder="Search employees, records…" class="w-full rounded-lg border border-slate-200 bg-slate-50 py-2 pl-9 pr-3 text-sm outline-none transition placeholder:text-slate-400 focus:border-slate-300 focus:bg-white focus:ring-2 focus:ring-slate-900/5" />',
      '    </div>',
      '    <div class="ml-auto flex items-center gap-1.5">',
      '      <button id="theme-toggle" type="button" class="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900" aria-label="Toggle theme" title="Theme"></button>',
      '      <button id="notifications-toggle" type="button" class="relative rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900" aria-label="Notifications">',
      '        <svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke-width="1.6" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" /></svg>',
      '        <span id="notifications-badge" class="absolute right-1.5 top-1.5 hidden min-w-[1rem] rounded-full bg-red-500 px-1 text-[10px] font-semibold leading-4 text-white">0</span>',
      '      </button>',
      '      <button id="approvals-toggle" type="button" class="relative rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900" aria-label="My approvals">',
      '        <svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke-width="1.6" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>',
      '        <span id="approvals-badge" class="absolute right-1.5 top-1.5 hidden min-w-[1rem] rounded-full bg-red-500 px-1 text-[10px] font-semibold leading-4 text-white">0</span>',
      '      </button>',
      '      <div class="h-6 w-px bg-slate-200"></div>',
      '      <div class="relative">',
      '        <button id="user-menu-button" type="button" class="flex items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-slate-100" aria-haspopup="true" aria-expanded="false">',
      '          <span id="user-initials" class="flex h-8 w-8 items-center justify-center rounded-full bg-[#2054C9] text-xs font-semibold text-white">–</span>',
      '          <span class="hidden text-left leading-tight sm:block">',
      '            <span id="user-name" class="block text-sm font-medium text-slate-900">Loading…</span>',
      '            <span id="user-role" class="block text-xs text-slate-500"></span>',
      '          </span>',
      '          <svg class="hidden h-4 w-4 text-slate-400 sm:block" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" /></svg>',
      '        </button>',
      '        <div id="user-menu" class="absolute right-0 z-30 mt-2 hidden w-56 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg" role="menu">',
      '          <div class="border-b border-slate-100 px-4 py-3">',
      '            <p class="text-xs text-slate-400">Employee ID</p>',
      '            <p id="user-employee-id" class="text-sm font-medium text-slate-900">—</p>',
      '          </div>',
      '          <a href="/core-hr.html" class="block px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50" role="menuitem">My profile</a>',
      '          <button type="button" data-action="cycle-theme" class="block w-full px-4 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-50" role="menuitem">Theme: <span id="theme-label">System</span></button>',
      '          <a href="#" data-action="logout" class="block border-t border-slate-100 px-4 py-2.5 text-sm font-medium text-red-600 hover:bg-red-50" role="menuitem">Sign out</a>',
      '        </div>',
      '      </div>',
      '    </div>',
      '  </div>',
      '</header>',

      '<div id="drawer-backdrop" class="fixed inset-0 z-40 hidden bg-slate-900/40"></div>',
      '<aside id="notifications-panel" class="fixed inset-y-0 right-0 z-50 w-full max-w-md translate-x-full border-l border-slate-200 bg-white shadow-xl transition-transform duration-200 dark:border-[#2A2F3A] dark:bg-[#1A1E27]" aria-hidden="true">',
      '  <div class="flex h-16 items-center justify-between border-b border-slate-200 px-5">',
      '    <div>',
      '      <h2 class="text-sm font-semibold text-slate-900">Notifications</h2>',
      '      <p id="notifications-count-label" class="text-xs text-slate-500">Loading…</p>',
      '    </div>',
      '    <div class="flex items-center gap-1">',
      '      <button id="notifications-read-all" type="button" class="rounded-lg px-2 py-1 text-xs font-medium text-slate-500 hover:bg-slate-100">Mark all read</button>',
      '      <button id="notifications-close" type="button" class="rounded-lg p-2 text-slate-500 hover:bg-slate-100" aria-label="Close notifications">',
      '        <svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke-width="1.8" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>',
      '      </button>',
      '    </div>',
      '  </div>',
      '  <div id="notifications-list" class="h-[calc(100%-4rem)] overflow-y-auto p-4"></div>',
      '</aside>',
      '<aside id="approvals-panel" class="fixed inset-y-0 right-0 z-50 w-full max-w-md translate-x-full border-l border-slate-200 bg-white shadow-xl transition-transform duration-200 dark:border-[#2A2F3A] dark:bg-[#1A1E27]" aria-hidden="true">',
      '  <div class="flex h-16 items-center justify-between border-b border-slate-200 px-5">',
      '    <div>',
      '      <h2 class="text-sm font-semibold text-slate-900">My approvals</h2>',
      '      <p id="approvals-count-label" class="text-xs text-slate-500">Loading…</p>',
      '    </div>',
      '    <button id="approvals-close" type="button" class="rounded-lg p-2 text-slate-500 hover:bg-slate-100" aria-label="Close approvals">',
      '      <svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke-width="1.8" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>',
      '    </button>',
      '  </div>',
      '  <div id="approvals-list" class="h-[calc(100%-4rem)] overflow-y-auto p-4"></div>',
      '</aside>',
    ].join('');
  }

  function renderChrome() {
    if (document.getElementById('sidebar')) return;
    var holder = document.createElement('div');
    holder.innerHTML = chromeHtml();
    var main = document.querySelector('main');
    while (holder.firstChild) {
      document.body.insertBefore(holder.firstChild, main || null);
    }
  }

  function svg(paths, extraClass) {
    return (
      '<svg class="h-5 w-5 shrink-0 ' +
      (extraClass || '') +
      '" fill="none" viewBox="0 0 24 24" stroke-width="1.6" stroke="currentColor" aria-hidden="true">' +
      paths +
      '</svg>'
    );
  }

  function initials(name) {
    return (name || '?')
      .split(' ')
      .filter(Boolean)
      .slice(0, 2)
      .map(function (part) {
        return part[0].toUpperCase();
      })
      .join('');
  }

  function escapeHtml(value) {
    return String(value === null || value === undefined ? '' : value).replace(/[&<>"']/g, function (char) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char];
    });
  }

  function storedTheme() {
    try {
      return window.localStorage.getItem(THEME_KEY) || 'system';
    } catch (err) {
      return 'system';
    }
  }

  function effectiveTheme(mode) {
    var chosen = mode || storedTheme();
    if (chosen === 'dark') return 'dark';
    if (chosen === 'light') return 'light';
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  function applyTheme(mode) {
    var chosen = mode || storedTheme();
    try {
      window.localStorage.setItem(THEME_KEY, chosen);
    } catch (err) {
      /* private mode */
    }
    document.documentElement.classList.toggle('dark', effectiveTheme(chosen) === 'dark');
    paintThemeControls(chosen);
  }

  function paintThemeControls(mode) {
    var chosen = mode || storedTheme();
    var button = document.getElementById('theme-toggle');
    var label = document.getElementById('theme-label');
    if (label) label.textContent = chosen.charAt(0).toUpperCase() + chosen.slice(1);
    if (button) {
      var dark = effectiveTheme(chosen) === 'dark';
      button.innerHTML =
        '<svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke-width="1.6" stroke="currentColor">' +
        (dark ? icon.sun : icon.moon) +
        '</svg>';
      button.title = 'Theme: ' + chosen;
    }
  }

  function cycleTheme() {
    var order = ['system', 'light', 'dark'];
    var current = storedTheme();
    applyTheme(order[(order.indexOf(current) + 1) % order.length]);
  }

  function renderNav(user, activeKey) {
    var nav = document.getElementById('sidebar-nav');
    if (!nav) return;

    var allowed = user.modules || [];
    var visible = NAV_ITEMS.filter(function (item) {
      return item.key === null || allowed.indexOf(item.key) !== -1;
    });

    var groups = [];
    visible.forEach(function (item) {
      var name = item.group || '';
      var last = groups[groups.length - 1];
      if (!last || last.label !== name) {
        groups.push({ label: name, items: [item] });
      } else {
        last.items.push(item);
      }
    });

    nav.innerHTML = groups
      .map(function (group) {
        var heading = group.label
          ? '<p class="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500">' +
            escapeHtml(group.label) +
            '</p>'
          : '';
        var links = group.items
          .map(function (item) {
            var isActive = (activeKey || 'dashboard') === (item.key || 'dashboard');
            var classes = isActive
              ? 'bg-[#2054C9] text-white font-semibold'
              : 'text-slate-300 hover:bg-white/10 hover:text-white';
            return (
              '<a href="' +
              item.href +
              '" class="group flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ' +
              classes +
              '"' +
              (isActive ? ' aria-current="page"' : '') +
              '>' +
              svg(item.icon, isActive ? 'text-white' : 'text-slate-400 group-hover:text-white') +
              '<span>' +
              item.label +
              '</span></a>'
            );
          })
          .join('');
        return '<div>' + heading + '<div class="space-y-0.5">' + links + '</div></div>';
      })
      .join('');
  }

  function renderHeader(user) {
    var set = function (id, value) {
      var el = document.getElementById(id);
      if (el) el.textContent = value;
    };
    set('user-name', user.fullName);
    set('user-role', user.roleLabel + (user.department ? ' · ' + user.department : ''));
    set('user-initials', initials(user.fullName));
    set('user-employee-id', user.employeeId);
  }

  function wireUserMenu() {
    var button = document.getElementById('user-menu-button');
    var menu = document.getElementById('user-menu');
    if (!button || !menu) return;

    var toggle = function (open) {
      menu.classList.toggle('hidden', !open);
      button.setAttribute('aria-expanded', String(open));
    };

    button.addEventListener('click', function (event) {
      event.stopPropagation();
      toggle(menu.classList.contains('hidden'));
    });
    document.addEventListener('click', function () {
      toggle(false);
    });
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') toggle(false);
    });
  }

  function wireLogout() {
    document.querySelectorAll('[data-action="logout"]').forEach(function (el) {
      el.addEventListener('click', async function (event) {
        event.preventDefault();
        await api.logout();
        session.clear();
        window.location.replace('/index.html');
      });
    });
  }

  function wireSidebarToggle() {
    var sidebar = document.getElementById('sidebar');
    var backdrop = document.getElementById('sidebar-backdrop');
    var toggle = document.getElementById('sidebar-toggle');
    if (!sidebar || !toggle) return;

    var setOpen = function (open) {
      sidebar.classList.toggle('-translate-x-full', !open);
      if (backdrop) backdrop.classList.toggle('hidden', !open);
    };

    toggle.addEventListener('click', function () {
      setOpen(sidebar.classList.contains('-translate-x-full'));
    });
    if (backdrop) backdrop.addEventListener('click', function () { setOpen(false); });
  }

  function wireTheme() {
    applyTheme(storedTheme());
    var button = document.getElementById('theme-toggle');
    if (button) button.addEventListener('click', cycleTheme);
    document.querySelectorAll('[data-action="cycle-theme"]').forEach(function (el) {
      el.addEventListener('click', function (event) {
        event.preventDefault();
        cycleTheme();
      });
    });
    if (window.matchMedia) {
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () {
        if (storedTheme() === 'system') applyTheme('system');
      });
    }
  }

  function drawerBackdrop() {
    return document.getElementById('drawer-backdrop');
  }

  function closeDrawers() {
    setApprovalsOpen(false);
    setNotificationsOpen(false);
  }

  function setDrawerBackdrop() {
    var backdrop = drawerBackdrop();
    if (!backdrop) return;
    var approvals = document.getElementById('approvals-panel');
    var notes = document.getElementById('notifications-panel');
    var open =
      (approvals && !approvals.classList.contains('translate-x-full')) ||
      (notes && !notes.classList.contains('translate-x-full'));
    backdrop.classList.toggle('hidden', !open);
  }

  function setPanelOpen(id, open) {
    var panel = document.getElementById(id);
    if (!panel) return;
    panel.classList.toggle('translate-x-full', !open);
    panel.setAttribute('aria-hidden', String(!open));
  }

  function setApprovalsOpen(open) {
    if (open) setPanelOpen('notifications-panel', false);
    setPanelOpen('approvals-panel', open);
    setDrawerBackdrop();
  }

  function setNotificationsOpen(open) {
    if (open) setPanelOpen('approvals-panel', false);
    setPanelOpen('notifications-panel', open);
    setDrawerBackdrop();
  }

  function paintApprovalsBadge(total) {
    var badge = document.getElementById('approvals-badge');
    var label = document.getElementById('approvals-count-label');
    if (badge) {
      badge.textContent = String(total);
      badge.classList.toggle('hidden', !total);
    }
    if (label) label.textContent = total ? total + ' waiting' : 'Nothing waiting';
  }

  function relativeTime(value) {
    var date = new Date(value);
    if (isNaN(date.getTime())) return '';
    var delta = Date.now() - date.getTime();
    var hours = Math.round(delta / 3600000);
    if (hours < 1) return 'just now';
    if (hours < 24) return hours + 'h ago';
    var days = Math.round(hours / 24);
    return days + 'd ago';
  }

  function renderApprovals(items) {
    var list = document.getElementById('approvals-list');
    if (!list) return;
    if (!items.length) {
      list.innerHTML =
        '<p class="rounded-lg border border-dashed border-slate-300 px-4 py-10 text-center text-sm text-slate-500">No pending approvals. New requests will land here.</p>';
      return;
    }

    list.innerHTML = items
      .map(function (item) {
        return (
          '<article class="mb-3 rounded-xl border border-slate-200 bg-slate-50 p-4" data-approval-id="' +
          escapeHtml(item.id) +
          '">' +
          '<div class="flex items-start justify-between gap-3">' +
          '<div>' +
          '<p class="text-sm font-medium text-slate-900">' +
          escapeHtml(item.title) +
          '</p>' +
          '<p class="mt-0.5 text-xs text-slate-500">' +
          escapeHtml(item.detail || '') +
          '</p>' +
          '<p class="mt-1 text-[11px] uppercase tracking-wide text-slate-400">' +
          escapeHtml(item.kind) +
          ' · ' +
          escapeHtml(relativeTime(item.submittedAt)) +
          '</p></div></div>' +
          '<div class="mt-3 flex flex-wrap gap-2">' +
          '<button type="button" data-approve="' +
          escapeHtml(item.decidePath) +
          '" class="rounded-lg bg-[#2054C9] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#173F9C]">Approve</button>' +
          '<button type="button" data-reject="' +
          escapeHtml(item.decidePath) +
          '" class="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-white">Reject</button>' +
          '<a href="' +
          escapeHtml(item.href) +
          '" class="rounded-lg px-3 py-1.5 text-xs font-medium text-slate-500 hover:text-slate-900">Open</a>' +
          '</div></article>'
        );
      })
      .join('');
  }

  async function refreshApprovals() {
    try {
      var payload = await api.get('/approvals');
      paintApprovalsBadge(payload.total || 0);
      renderApprovals(payload.items || []);
    } catch (err) {
      paintApprovalsBadge(0);
      var list = document.getElementById('approvals-list');
      if (list) {
        list.innerHTML =
          '<p class="text-sm text-slate-500">Could not load the approval inbox.</p>';
      }
    }
  }

  async function decideApproval(path, status) {
    var note = '';
    if (status === 'rejected') {
      note = window.prompt('Reason for rejecting this request?') || '';
      if (!note.trim()) return;
    }
    await api.request(path, { method: 'PATCH', body: { status: status, decisionNote: note } });
    await refreshApprovals();
  }

  function paintNotificationsBadge(unread) {
    var badge = document.getElementById('notifications-badge');
    var label = document.getElementById('notifications-count-label');
    if (badge) {
      badge.textContent = String(unread);
      badge.classList.toggle('hidden', !unread);
    }
    if (label) label.textContent = unread ? unread + ' unread' : 'Caught up';
  }

  function renderNotifications(items) {
    var list = document.getElementById('notifications-list');
    if (!list) return;
    if (!items.length) {
      list.innerHTML =
        '<p class="rounded-lg border border-dashed border-slate-300 px-4 py-10 text-center text-sm text-slate-500">No in-app notifications yet.</p>';
      return;
    }
    list.innerHTML = items
      .map(function (item) {
        var unread = !item.readAt;
        return (
          '<article class="mb-3 rounded-xl border p-4 ' +
          (unread ? 'border-[#2054C9]/30 bg-slate-50' : 'border-slate-200 bg-white') +
          '" data-note-id="' +
          escapeHtml(item.id) +
          '">' +
          '<p class="text-sm font-medium text-slate-900">' +
          escapeHtml(item.title) +
          '</p>' +
          '<p class="mt-1 text-xs text-slate-500">' +
          escapeHtml(item.body || '') +
          '</p>' +
          '<p class="mt-2 text-[11px] uppercase tracking-wide text-slate-400">' +
          escapeHtml(relativeTime(item.createdAt)) +
          (unread ? ' · Unread' : '') +
          '</p></article>'
        );
      })
      .join('');
  }

  async function refreshNotifications() {
    try {
      var payload = await api.get('/notifications');
      paintNotificationsBadge(payload.unread || 0);
      renderNotifications(payload.notifications || []);
    } catch (err) {
      paintNotificationsBadge(0);
    }
  }

  function wireNotifications() {
    var toggle = document.getElementById('notifications-toggle');
    var close = document.getElementById('notifications-close');
    var readAll = document.getElementById('notifications-read-all');
    var list = document.getElementById('notifications-list');

    if (toggle) {
      toggle.addEventListener('click', function () {
        var panel = document.getElementById('notifications-panel');
        var open = panel && panel.classList.contains('translate-x-full');
        setNotificationsOpen(open);
        if (open) refreshNotifications();
      });
    }
    if (close) close.addEventListener('click', function () { setNotificationsOpen(false); });
    if (readAll) {
      readAll.addEventListener('click', function () {
        api.request('/notifications/read-all', { method: 'PATCH' }).then(refreshNotifications);
      });
    }
    if (list) {
      list.addEventListener('click', function (event) {
        var article = event.target.closest('[data-note-id]');
        if (!article) return;
        api.request('/notifications/' + article.getAttribute('data-note-id') + '/read', { method: 'PATCH' }).then(
          refreshNotifications
        );
      });
    }

    refreshNotifications();
  }

  function wireApprovals() {
    var toggle = document.getElementById('approvals-toggle');
    var close = document.getElementById('approvals-close');
    var backdrop = drawerBackdrop();
    var list = document.getElementById('approvals-list');

    if (toggle) {
      toggle.addEventListener('click', function () {
        var panel = document.getElementById('approvals-panel');
        var open = panel && panel.classList.contains('translate-x-full');
        setApprovalsOpen(open);
        if (open) refreshApprovals();
      });
    }
    if (close) close.addEventListener('click', function () { setApprovalsOpen(false); });
    if (backdrop) backdrop.addEventListener('click', function () { closeDrawers(); });
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') closeDrawers();
    });

    if (list) {
      list.addEventListener('click', function (event) {
        var approve = event.target.closest('[data-approve]');
        var reject = event.target.closest('[data-reject]');
        if (approve) {
          decideApproval(approve.getAttribute('data-approve'), 'approved').catch(function (err) {
            window.alert(err.message || 'Could not approve');
          });
        }
        if (reject) {
          decideApproval(reject.getAttribute('data-reject'), 'rejected').catch(function (err) {
            window.alert(err.message || 'Could not reject');
          });
        }
      });
    }

    refreshApprovals();
  }

  function showOfflineBanner(message) {
    var main = document.querySelector('main');
    if (!main || document.getElementById('shell-banner')) return;
    var banner = document.createElement('div');
    banner.id = 'shell-banner';
    banner.className =
      'mx-auto mb-6 max-w-7xl rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800';
    banner.textContent = message;
    main.insertBefore(banner, main.firstChild);
  }

  function reveal() {
    wireUserMenu();
    wireLogout();
    wireSidebarToggle();
    wireTheme();
    wireApprovals();
    wireNotifications();
    document.body.classList.remove('invisible');
  }

  /**
   * Guards the page, then paints the shell. Pass the module key of the current
   * page so its sidebar entry is highlighted. Resolves to null when the visitor
   * is being redirected to the login page.
   */
  async function mount(activeKey) {
    if (!session.isAuthenticated()) {
      window.location.replace('/index.html');
      return null;
    }

    renderChrome();

    var cached = session.getUser();
    if (cached) {
      renderNav(cached, activeKey);
      renderHeader(cached);
    }

    var result;
    try {
      result = await api.me();
    } catch (err) {
      if (err.status === 401) return null;
      if (!cached) {
        window.location.replace('/index.html');
        return null;
      }
      reveal();
      showOfflineBanner('Could not reach the server — showing your last known session.');
      return cached;
    }

    session.save(session.getToken(), result.user);
    renderNav(result.user, activeKey);
    renderHeader(result.user);
    reveal();

    return result.user;
  }

  function setActiveModule(activeKey) {
    var user = session.getUser();
    if (user) renderNav(user, activeKey);
  }

  window.PortoHR.shell = {
    mount: mount,
    setActiveModule: setActiveModule,
    NAV_ITEMS: NAV_ITEMS,
    icon: icon,
    refreshApprovals: refreshApprovals,
    refreshNotifications: refreshNotifications,
  };
})(window, document);
