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
    reports:
      '<path stroke-linecap="round" stroke-linejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />',
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
      key: 'company',
      label: 'Company Hub',
      href: '/company.html',
      icon: '<path stroke-linecap="round" stroke-linejoin="round" d="M2.25 21h19.5M3.75 21V4.875c0-.621.504-1.125 1.125-1.125h8.25c.621 0 1.125.504 1.125 1.125V21m0 0h5.25V9.375c0-.621-.504-1.125-1.125-1.125H14.25M7.5 7.5h3m-3 3h3m-3 3h3m-3 3h3" />',
      group: 'Company',
      ready: true,
      blurb: 'Announcements, who is who, upcoming birthdays and anniversaries, the org chart, and offboarding.',
    },
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
      label: 'Performance',
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
      key: 'reports',
      label: 'Reports',
      href: '/reports.html',
      icon: icon.reports,
      group: 'Analytics',
      ready: true,
      blurb: 'A full report for any employee, a library of ready-made reports, and a builder that turns any HR data into a table, chart or CSV.',
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

  /**
   * Work areas: the top tier of navigation. Each area's modules appear as tabs in the second tier, so
   * wherever you are you can see the pages next to it. The order here is the order on screen.
   */
  var AREAS = [
    { id: 'home', label: 'Home', blurb: 'Your day, company news and people.', keys: ['dashboard', 'company'] },
    { id: 'people', label: 'People', blurb: 'Employee records, organisation and equipment.', keys: ['core_hr', 'assets'] },
    { id: 'time', label: 'Time', blurb: 'Attendance, shifts and leave.', keys: ['attendance', 'leave'] },
    { id: 'pay', label: 'Pay', blurb: 'Payroll, compensation, loans and benefits.', keys: ['payroll', 'compensation', 'loans', 'benefits'] },
    { id: 'talent', label: 'Talent', blurb: 'Hiring, performance and learning.', keys: ['recruitment', 'pms', 'lms'] },
    { id: 'governance', label: 'Governance', blurb: 'Compliance filings, employee relations and signatures.', keys: ['compliance', 'grievance', 'esign'] },
    { id: 'insights', label: 'Insights', blurb: 'Reports and analytics.', keys: ['reports', 'analytics'] },
    { id: 'admin', label: 'Admin', blurb: 'Settings, access and workflows.', keys: ['admin'] },
  ];
  var AREA_ICON = {
    home: '<path stroke-linecap="round" stroke-linejoin="round" d="M2.25 12l8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" />',
    pay: '<path stroke-linecap="round" stroke-linejoin="round" d="M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75M15 10.5a3 3 0 11-6 0 3 3 0 016 0zm3 0h.008v.008H18V10.5zm-12 0h.008v.008H6V10.5z" />',
    talent: '<path stroke-linecap="round" stroke-linejoin="round" d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z" />',
    governance: '<path stroke-linecap="round" stroke-linejoin="round" d="M12 3v17.25m0 0c-1.472 0-2.882.265-4.185.75M12 20.25c1.472 0 2.882.265 4.185.75M18.75 4.97A48.416 48.416 0 0012 4.5c-2.291 0-4.545.16-6.75.47m13.5 0c1.01.143 2.01.317 3 .52m-3-.52l2.62 10.726c.122.499-.106 1.028-.589 1.202a5.988 5.988 0 01-2.031.352 5.988 5.988 0 01-2.031-.352c-.483-.174-.711-.703-.59-1.202L18.75 4.971zm-16.5.52c.99-.203 1.99-.377 3-.52m0 0l2.62 10.726c.122.499-.106 1.028-.589 1.202a5.989 5.989 0 01-2.031.352 5.989 5.989 0 01-2.031-.352c-.483-.174-.711-.703-.59-1.202L5.25 4.971z" />',
  };
  var keyOf = function (item) { return item.key || 'dashboard'; };
  var areaOf = function (key) {
    return AREAS.filter(function (a) { return a.keys.indexOf(key) !== -1; })[0] || AREAS[0];
  };
  var ORDER = [];
  AREAS.forEach(function (a) { ORDER = ORDER.concat(a.keys); });
  // The mobile drawer groups by the same areas, so both menus read the same way.
  NAV_ITEMS.forEach(function (item) { item.group = keyOf(item) === 'dashboard' ? null : areaOf(keyOf(item)).label; });
  var byArea = function (items) {
    return items.slice().sort(function (a, b) { return ORDER.indexOf(keyOf(a)) - ORDER.indexOf(keyOf(b)); });
  };

  var GROUPS_KEY = 'portohr.nav.closedGroups';

  var extraIcon = {
    search:
      '<path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-5.2-5.2m2.2-5.3a7.5 7.5 0 11-15 0 7.5 7.5 0 0115 0z" />',
    chevron: '<path stroke-linecap="round" stroke-linejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />',
    collapse:
      '<path stroke-linecap="round" stroke-linejoin="round" d="M18.75 19.5l-7.5-7.5 7.5-7.5m-6 15L5.25 12l7.5-7.5" />',
    menu: '<path stroke-linecap="round" stroke-linejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />',
    bell: '<path stroke-linecap="round" stroke-linejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />',
    check:
      '<path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />',
    close: '<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />',
    user: '<path stroke-linecap="round" stroke-linejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.5 20.118a7.5 7.5 0 0115 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.5-1.632z" />',
    arrow: '<path stroke-linecap="round" stroke-linejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />',
  };

  function sIcon(paths, cls, width) {
    return (
      '<svg class="' +
      (cls || 'h-5 w-5') +
      '" fill="none" viewBox="0 0 24 24" stroke-width="' +
      (width || 1.6) +
      '" stroke="currentColor" aria-hidden="true">' +
      paths +
      '</svg>'
    );
  }

  function chromeHtml() {
    return [
      '<aside id="sidebar" class="sb" aria-label="Primary">',
      '  <div class="sb-brand">',
      '    <div class="sb-logo">P</div>',
      '    <div class="sb-brand-text"><p>PortoHR</p><span>People &amp; payroll</span></div>',
      '  </div>',
      '  <div class="sb-scroll"><nav id="sidebar-nav" aria-label="Main navigation"></nav></div>',
      '  <div class="sb-foot">',
      '    <div class="sb-user" id="sb-user">',
      '      <span id="sb-initials" class="sb-avatar">–</span>',
      '      <span class="sb-user-text"><b id="sb-name">Loading…</b><i id="sb-role"></i></span>',
      '    </div>',
      '  </div>',
      '</aside>',
      '<div id="sidebar-backdrop" class="fixed inset-0 z-[55] hidden bg-slate-900/50 backdrop-blur-sm lg:hidden"></div>',

      '<header id="app-header" class="topbar">',
      '<div class="tb-bar">',
      '  <button id="sidebar-toggle" type="button" class="tb-btn tb-burger" aria-label="Open navigation">' + sIcon(extraIcon.menu) + '</button>',
      '  <a href="/dashboard.html" class="tb-brand" aria-label="PortoHR home"><span class="tb-logo">P</span><span class="tb-brand-text">Porto<em>HR</em></span></a>',
      '  <nav id="topnav" class="topnav" aria-label="Main"></nav>',
      '  <button id="palette-open" type="button" class="tb-search" aria-label="Search or jump to">',
      sIcon(extraIcon.search, 'h-4 w-4', 1.8),
      '    <span class="tb-search-text">Search</span>',
      '    <kbd id="palette-kbd">Ctrl K</kbd>',
      '  </button>',
      '  <div class="tb-actions">',
      '    <div class="relative">',
      '      <button id="quick-new" type="button" class="tb-cta" title="New request" aria-haspopup="true" aria-expanded="false">' + sIcon('<path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" />', 'h-4 w-4', 2.2) + '<span>New request</span></button>',
      '      <div id="quick-menu" class="menu menu-new hidden" role="menu"></div>',
      '    </div>',
      '    <button id="theme-toggle" type="button" class="tb-btn" aria-label="Toggle theme" title="Theme"></button>',
      '    <button id="notifications-toggle" type="button" class="tb-btn relative" aria-label="Notifications" title="Notifications">',
      sIcon(extraIcon.bell),
      '      <span id="notifications-badge" class="tb-badge hidden">0</span>',
      '    </button>',
      '    <button id="approvals-toggle" type="button" class="tb-btn relative" aria-label="My approvals" title="My approvals">',
      sIcon(extraIcon.check),
      '      <span id="approvals-badge" class="tb-badge hidden">0</span>',
      '    </button>',
      '    <span class="tb-sep"></span>',
      '    <div class="relative">',
      '      <button id="user-menu-button" type="button" class="tb-user" title="Account" aria-haspopup="true" aria-expanded="false">',
      '        <span id="user-initials" class="sb-avatar">–</span>',
      '        <span class="tb-user-text"><b id="user-name">Loading…</b><i id="user-role"></i></span>',
      sIcon(extraIcon.chevron, 'hidden h-4 w-4 opacity-50 sm:block', 2),
      '      </button>',
      '      <div id="user-menu" class="menu hidden" role="menu">',
      '        <div class="menu-head"><span>Employee ID</span><b id="user-employee-id">—</b></div>',
      '        <a href="/core-hr.html" role="menuitem">My profile</a>',
      '        <button type="button" data-action="change-password" role="menuitem">Change password</button>',
      '        <button type="button" data-action="cycle-theme" role="menuitem">Theme: <span id="theme-label">System</span></button>',
      '        <button type="button" data-action="cycle-palette" role="menuitem">Colours: <span id="palette-label">Navy &amp; gold</span><span id="palette-dot" class="palette-dot"></span></button>',
      '        <button type="button" data-action="logout-all" role="menuitem">Sign out other devices</button>',
      '        <a href="#" data-action="logout" role="menuitem" class="danger">Sign out</a>',
      '      </div>',
      '    </div>',
      '  </div>',
      '</div>',
      '<div class="tb-sub"><div class="tb-sub-in">',
      '  <div id="subnav-crumb" class="sub-crumb"></div>',
      '  <nav id="subnav" class="subnav" aria-label="Pages in this area"></nav>',
      '</div></div>',
      '</header>',

      '<div id="palette" class="palette hidden" role="dialog" aria-modal="true" aria-label="Command palette">',
      '  <div class="palette-box">',
      '    <div class="palette-input">' + sIcon(extraIcon.search, 'h-5 w-5', 1.8),
      '      <input id="palette-q" type="text" autocomplete="off" spellcheck="false" placeholder="Jump to a module, find an employee, run an action…" />',
      '      <kbd>Esc</kbd>',
      '    </div>',
      '    <div id="palette-list" class="palette-list" role="listbox"></div>',
      '    <div class="palette-foot"><span><kbd>↑</kbd><kbd>↓</kbd> navigate</span><span><kbd>↵</kbd> open</span><span><kbd>Esc</kbd> close</span></div>',
      '  </div>',
      '</div>',

      '<div id="pw-modal" class="modal hidden" role="dialog" aria-modal="true" aria-labelledby="pw-title">',
      '  <form id="pw-form" class="modal-box" novalidate>',
      '    <h2 id="pw-title">Change your password</h2>',
      '    <p id="pw-intro" class="modal-sub">Use at least 8 characters with letters and numbers.</p>',
      '    <div id="pw-error" class="modal-error hidden" role="alert"></div>',
      '    <label>Current password<input id="pw-current" type="password" autocomplete="current-password" required /></label>',
      '    <label>New password<input id="pw-new" type="password" autocomplete="new-password" required /></label>',
      '    <label>Confirm new password<input id="pw-confirm" type="password" autocomplete="new-password" required /></label>',
      '    <div class="modal-actions">',
      '      <button type="button" id="pw-cancel" class="btn btn-secondary">Cancel</button>',
      '      <button type="submit" id="pw-submit" class="btn btn-primary">Update password</button>',
      '    </div>',
      '  </form>',
      '</div>',

      '<div id="drawer-backdrop" class="fixed inset-0 z-[62] hidden bg-slate-900/40 backdrop-blur-[2px]"></div>',
      '<aside id="notifications-panel" class="drawer translate-x-full" aria-hidden="true">',
      '  <div class="drawer-head">',
      '    <div><h2>Notifications</h2><p id="notifications-count-label">Loading…</p></div>',
      '    <div class="flex items-center gap-1">',
      '      <button id="notifications-read-all" type="button" class="btn-ghost">Mark all read</button>',
      '      <button id="notifications-close" type="button" class="tb-btn" aria-label="Close notifications">' + sIcon(extraIcon.close, 'h-5 w-5', 1.8) + '</button>',
      '    </div>',
      '  </div>',
      '  <div id="notifications-list" class="drawer-body"></div>',
      '</aside>',
      '<aside id="approvals-panel" class="drawer translate-x-full" aria-hidden="true">',
      '  <div class="drawer-head">',
      '    <div><h2>My approvals</h2><p id="approvals-count-label">Loading…</p></div>',
      '    <button id="approvals-close" type="button" class="tb-btn" aria-label="Close approvals">' + sIcon(extraIcon.close, 'h-5 w-5', 1.8) + '</button>',
      '  </div>',
      '  <div id="approvals-list" class="drawer-body"></div>',
      '</aside>',
    ].join('');
  }

  function renderChrome() {
    if (document.getElementById('sidebar')) return;
    document.body.classList.add('has-shell');
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

  function readJson(key, fallback) {
    try {
      var value = JSON.parse(window.localStorage.getItem(key));
      return value === null || value === undefined ? fallback : value;
    } catch (err) {
      return fallback;
    }
  }

  function writeJson(key, value) {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch (err) {
      /* private mode */
    }
  }

  function visibleNav(user) {
    var allowed = (user && user.modules) || [];
    return NAV_ITEMS.filter(function (item) {
      return item.key === null || allowed.indexOf(item.key) !== -1;
    });
  }

  function groupNav(items) {
    var groups = [];
    items.forEach(function (item) {
      var name = item.group || '';
      var last = groups[groups.length - 1];
      if (!last || last.label !== name) groups.push({ label: name, items: [item] });
      else last.items.push(item);
    });
    return groups;
  }

  function renderNav(user, activeKey) {
    var nav = document.getElementById('sidebar-nav');
    if (!nav) return;

    var active = activeKey || 'dashboard';
    var closed = readJson(GROUPS_KEY, []);

    nav.innerHTML = groupNav(byArea(visibleNav(user)))
      .map(function (group) {
        var holdsActive = group.items.some(function (item) {
          return (item.key || 'dashboard') === active;
        });
        var isClosed = Boolean(group.label) && closed.indexOf(group.label) !== -1 && !holdsActive;

        var heading = group.label
          ? '<button type="button" class="sb-group-btn" data-group="' +
            escapeHtml(group.label) +
            '" aria-expanded="' +
            String(!isClosed) +
            '"><span>' +
            escapeHtml(group.label) +
            '</span>' +
            sIcon(extraIcon.chevron, 'sb-chev h-3.5 w-3.5', 2.2) +
            '</button>'
          : '';

        var links = group.items
          .map(function (item) {
            var isActive = (item.key || 'dashboard') === active;
            return (
              '<a href="' +
              item.href +
              '" class="sb-link' +
              (isActive ? ' is-active' : '') +
              '" data-tip="' +
              escapeHtml(item.label) +
              '"' +
              (isActive ? ' aria-current="page"' : '') +
              '>' +
              svg(item.icon) +
              '<span class="sb-label">' +
              item.label +
              '</span></a>'
            );
          })
          .join('');

        return (
          '<div class="sb-group' +
          (isClosed ? ' is-closed' : '') +
          '">' +
          heading +
          '<div class="sb-items">' +
          links +
          '</div></div>'
        );
      })
      .join('');

    renderBreadcrumbs(user, active);
    renderTopNav(user, active);
  }

  /* ---------- Top navigation: links, grouped mega-menus, and a "More" overflow ---------- */

  var topnav = { entries: [], active: null, user: null, timer: null, hoverTimer: null };

  /** The areas this user can reach, each with the modules they may open, in screen order. */
  function areasFor(user) {
    var visible = visibleNav(user);
    return AREAS.map(function (area) {
      var items = area.keys
        .map(function (k) { return visible.filter(function (item) { return keyOf(item) === k; })[0]; })
        .filter(Boolean);
      return { area: area, items: items };
    }).filter(function (entry) { return entry.items.length; });
  }

  function cardHtml(item, active) {
    var isActive = keyOf(item) === active;
    return (
      '<a class="tn-card' + (isActive ? ' is-active' : '') + '" href="' + item.href + '" role="menuitem"' + (isActive ? ' aria-current="page"' : '') + '>' +
      '<span class="tn-ico">' + svg(item.icon, 'h-5 w-5') + '</span>' +
      '<span class="min-w-0"><b>' + escapeHtml(item.label) + '</b>' + (item.blurb ? '<small>' + escapeHtml(item.blurb) + '</small>' : '') + '</span></a>'
    );
  }

  function areaHtml(entry, index, active) {
    var isActive = entry.items.some(function (item) { return keyOf(item) === active; });
    var first = entry.items[0];
    // Hovering an area previews its pages; clicking the area opens its first page.
    var panel = entry.items.length > 1
      ? '<div class="tn-panel' + (entry.items.length > 3 ? ' cols-2' : '') + '" role="menu">' +
        '<div class="tn-panel-h"><b>' + escapeHtml(entry.area.label) + '</b><span>' + escapeHtml(entry.area.blurb) + '</span></div>' +
        entry.items.map(function (item) { return cardHtml(item, active); }).join('') + '</div>'
      : '';
    return (
      '<div class="tn-wrap"' + (panel ? ' data-tn-wrap="' + index + '"' : '') + '>' +
      '<a class="tn-item' + (isActive ? ' is-active' : '') + '" href="' + first.href + '"' + (isActive ? ' aria-current="true"' : '') + '>' +
      svg(AREA_ICON[entry.area.id] || first.icon, 'tn-glyph') + '<span>' + escapeHtml(entry.area.label) + '</span></a>' + panel + '</div>'
    );
  }

  function renderSubnav(entries, active) {
    var host = document.getElementById('subnav');
    var crumb = document.getElementById('subnav-crumb');
    if (!host || !crumb) return;
    var current = entries.filter(function (e) { return e.items.some(function (item) { return keyOf(item) === active; }); })[0] || entries[0];
    if (!current) return;
    var page = current.items.filter(function (item) { return keyOf(item) === active; })[0];
    crumb.innerHTML = '<span class="sub-area">' + svg(AREA_ICON[current.area.id] || current.items[0].icon, 'sub-ico') + escapeHtml(current.area.label) + '</span>' +
      (page ? sIcon('<path stroke-linecap="round" stroke-linejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />', 'sub-chev', 2.2) + '<span class="sub-page">' + escapeHtml(page.label) + '</span>' : '');
    host.innerHTML = current.items.map(function (item) {
      var on = keyOf(item) === active;
      return '<a class="sn-item' + (on ? ' is-active' : '') + '" href="' + item.href + '"' + (on ? ' aria-current="page"' : '') + '>' + svg(item.icon, 'h-4 w-4') + '<span>' + escapeHtml(item.label) + '</span></a>';
    }).join('');
  }

  function fitTopNav() {
    /* The areas always fit; nothing to collapse into an overflow menu any more. */
  }

  function renderTopNav(user, active) {
    topnav.user = user;
    topnav.active = active;
    var entries = areasFor(user);
    topnav.entries = entries;
    var host = document.getElementById('topnav');
    if (host) host.innerHTML = entries.map(function (entry, i) { return areaHtml(entry, i, active); }).join('');
    renderSubnav(entries, active);
  }

  function closeTopMenus(except) {
    document.querySelectorAll('.tn-wrap.is-open').forEach(function (wrap) {
      if (wrap === except) return;
      wrap.classList.remove('is-open');
      var button = wrap.querySelector('[data-tn]');
      if (button) button.setAttribute('aria-expanded', 'false');
    });
  }

  function openTopMenu(wrap) {
    closeTopMenus(wrap);
    wrap.classList.add('is-open');
    var button = wrap.querySelector('[data-tn]');
    if (button) button.setAttribute('aria-expanded', 'true');
    var panel = wrap.querySelector('.tn-panel');
    if (panel) {
      panel.style.left = '';
      panel.style.right = '';
      var rect = panel.getBoundingClientRect();
      if (rect.right > window.innerWidth - 16) {
        panel.style.left = 'auto';
        panel.style.right = '0';
      }
    }
  }

  function wireTopNav() {
    var host = document.getElementById('topnav');
    if (!host || host.dataset.wired) return;
    host.dataset.wired = '1';

    host.addEventListener('click', function (event) {
      var button = event.target.closest('[data-tn]');
      if (!button) return;
      event.stopPropagation();
      var wrap = button.closest('.tn-wrap');
      // A menu the pointer already opened by hovering stays open on click
      // (otherwise the click would close it the instant it appeared).
      if (wrap.classList.contains('is-open') && wrap.dataset.by === 'click') closeTopMenus();
      else {
        openTopMenu(wrap);
        wrap.dataset.by = 'click';
      }
    });

    // Hover opens a menu on devices that have a pointer; touch uses taps.
    var canHover = window.matchMedia && window.matchMedia('(hover: hover)').matches;
    if (canHover) {
      host.addEventListener('mouseover', function (event) {
        var wrap = event.target.closest('[data-tn-wrap]');
        window.clearTimeout(topnav.hoverTimer);
        if (!wrap || wrap.classList.contains('is-open')) return;
        topnav.hoverTimer = window.setTimeout(function () {
          openTopMenu(wrap);
          wrap.dataset.by = 'hover';
        }, 240);
      });
      host.addEventListener('mouseleave', function () {
        window.clearTimeout(topnav.hoverTimer);
        topnav.hoverTimer = window.setTimeout(function () { closeTopMenus(); }, 220);
      });
      host.addEventListener('mouseenter', function () { window.clearTimeout(topnav.hoverTimer); });
    }

    document.addEventListener('click', function () { closeTopMenus(); });
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') closeTopMenus();
    });
    window.addEventListener('resize', function () {
      window.clearTimeout(topnav.timer);
      topnav.timer = window.setTimeout(fitTopNav, 120);
    });
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(fitTopNav);
  }

  function renderBreadcrumbs(user, active) {
    var host = document.getElementById('breadcrumbs');
    if (!host) return;
    var item = NAV_ITEMS.filter(function (entry) {
      return (entry.key || 'dashboard') === active;
    })[0];
    if (!item) {
      host.innerHTML = '<span class="crumb-current">PortoHR</span>';
      return;
    }
    var parts = ['<a href="/dashboard.html" class="crumb">Home</a>'];
    if (item.group) parts.push('<span class="crumb-sep">/</span><span class="crumb">' + escapeHtml(item.group) + '</span>');
    if (item.key) parts.push('<span class="crumb-sep">/</span><span class="crumb-current">' + escapeHtml(item.label) + '</span>');
    else parts = ['<span class="crumb-current">Home</span>'];
    host.innerHTML = parts.join('');
  }

  function openPasswordModal(forced) {
    var modal = document.getElementById('pw-modal');
    if (!modal) return;
    modal.dataset.forced = forced ? '1' : '';
    document.getElementById('pw-cancel').classList.toggle('hidden', Boolean(forced));
    document.getElementById('pw-intro').textContent = forced
      ? 'You are using a temporary password. Choose your own before continuing.'
      : 'Use at least 8 characters with letters and numbers.';
    document.getElementById('pw-form').reset();
    document.getElementById('pw-error').classList.add('hidden');
    modal.classList.remove('hidden');
    document.getElementById('pw-current').focus();
  }

  function wirePasswordModal() {
    var modal = document.getElementById('pw-modal');
    var form = document.getElementById('pw-form');
    if (!modal || !form) return;
    var close = function () {
      if (modal.dataset.forced) return;
      modal.classList.add('hidden');
    };
    document.getElementById('pw-cancel').addEventListener('click', close);
    modal.addEventListener('mousedown', function (event) {
      if (event.target === modal) close();
    });
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && !modal.classList.contains('hidden')) close();
    });
    document.querySelectorAll('[data-action="change-password"]').forEach(function (el) {
      el.addEventListener('click', function () { openPasswordModal(false); });
    });

    form.addEventListener('submit', async function (event) {
      event.preventDefault();
      var error = document.getElementById('pw-error');
      var show = function (message) {
        error.textContent = message;
        error.classList.remove('hidden');
      };
      var next = document.getElementById('pw-new').value;
      if (next !== document.getElementById('pw-confirm').value) return show('The new passwords do not match.');
      var button = document.getElementById('pw-submit');
      button.disabled = true;
      try {
        var result = await api.request('/auth/change-password', {
          method: 'POST',
          body: { currentPassword: document.getElementById('pw-current').value, newPassword: next },
        });
        session.save(result.token, result.user);
        modal.dataset.forced = '';
        modal.classList.add('hidden');
      } catch (err) {
        show(err.message || 'Could not change the password.');
      } finally {
        button.disabled = false;
      }
    });
  }

  function wireNavGroups() {
    var nav = document.getElementById('sidebar-nav');
    if (!nav || nav.dataset.wired) return;
    nav.dataset.wired = '1';
    nav.addEventListener('click', function (event) {
      var button = event.target.closest('.sb-group-btn');
      if (!button) return;
      var group = button.parentNode;
      var name = button.getAttribute('data-group');
      var nowClosed = !group.classList.contains('is-closed');
      group.classList.toggle('is-closed', nowClosed);
      button.setAttribute('aria-expanded', String(!nowClosed));
      var closed = readJson(GROUPS_KEY, []).filter(function (entry) {
        return entry !== name;
      });
      if (nowClosed) closed.push(name);
      writeJson(GROUPS_KEY, closed);
    });
  }

  /* ---------- Command palette ---------- */

  var paletteState = { items: [], index: 0, token: 0, timer: null };

  function paletteBase(user) {
    var entries = visibleNav(user).map(function (item) {
      return {
        kind: 'Go to',
        title: item.label,
        hint: item.group || 'Home',
        href: item.href,
        icon: item.icon,
        words: (item.label + ' ' + (item.group || '') + ' ' + (item.blurb || '')).toLowerCase(),
      };
    });
    entries.push(
      { kind: 'Action', title: 'Open my approvals', hint: 'Inbox', action: 'approvals', icon: '<path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />', words: 'approvals inbox pending decide' },
      { kind: 'Action', title: 'Open notifications', hint: 'Inbox', action: 'notifications', icon: extraIcon.bell, words: 'notifications alerts unread' },
      { kind: 'Action', title: 'Switch theme', hint: 'Appearance', action: 'theme', icon: icon.moon, words: 'theme dark light appearance mode' },
      { kind: 'Action', title: 'Sign out', hint: 'Account', action: 'logout', icon: icon.logout, words: 'logout sign out exit' }
    );
    return entries;
  }

  function paletteRender() {
    var list = document.getElementById('palette-list');
    if (!list) return;
    if (!paletteState.items.length) {
      list.innerHTML = '<p class="palette-empty">No matches. Try a module name or an employee.</p>';
      return;
    }
    var lastKind = null;
    list.innerHTML = paletteState.items
      .map(function (entry, i) {
        var head = entry.kind !== lastKind ? '<p class="palette-kind">' + escapeHtml(entry.kind) + '</p>' : '';
        lastKind = entry.kind;
        return (
          head +
          '<button type="button" role="option" class="palette-item' +
          (i === paletteState.index ? ' is-sel' : '') +
          '" data-i="' +
          i +
          '">' +
          '<span class="palette-ico">' +
          sIcon(entry.icon || extraIcon.user, 'h-4 w-4') +
          '</span><span class="palette-title">' +
          escapeHtml(entry.title) +
          '</span><span class="palette-hint">' +
          escapeHtml(entry.hint || '') +
          '</span></button>'
        );
      })
      .join('');
    var sel = list.querySelector('.is-sel');
    if (sel && sel.scrollIntoView) sel.scrollIntoView({ block: 'nearest' });
  }

  function paletteQuery(term) {
    var user = session.getUser();
    var q = term.trim().toLowerCase();
    var base = paletteBase(user);
    paletteState.items = q
      ? base.filter(function (entry) {
          return q.split(/\s+/).every(function (piece) {
            return entry.words.indexOf(piece) !== -1;
          });
        })
      : base.slice(0, 12);
    paletteState.index = 0;
    paletteRender();

    var canSearchPeople = user && (user.modules || []).indexOf('core_hr') !== -1;
    clearTimeout(paletteState.timer);
    if (q.length < 2 || !canSearchPeople) return;
    var token = ++paletteState.token;
    paletteState.timer = setTimeout(function () {
      api
        .get('/employees?limit=6&q=' + encodeURIComponent(term.trim()))
        .then(function (payload) {
          if (token !== paletteState.token) return;
          var people = (payload.employees || []).map(function (row) {
            return {
              kind: 'People',
              title: row.fullName,
              hint: [row.employeeCode, row.designation].filter(Boolean).join(' · '),
              href: '/core-hr.html#/employee/' + row.id,
              icon: extraIcon.user,
            };
          });
          if (!people.length) return;
          paletteState.items = paletteState.items.concat(people);
          paletteRender();
        })
        .catch(function () {
          /* people search is best effort */
        });
    }, 200);
  }

  function paletteOpen(open) {
    var el = document.getElementById('palette');
    var input = document.getElementById('palette-q');
    if (!el || !input) return;
    el.classList.toggle('hidden', !open);
    if (open) {
      closeDrawers();
      input.value = '';
      paletteQuery('');
      input.focus();
    }
  }

  function paletteRun(entry) {
    if (!entry) return;
    paletteOpen(false);
    if (entry.href) {
      window.location.href = entry.href;
      return;
    }
    if (entry.action === 'approvals') {
      setApprovalsOpen(true);
      refreshApprovals();
    } else if (entry.action === 'notifications') {
      setNotificationsOpen(true);
      refreshNotifications();
    } else if (entry.action === 'theme') {
      cycleTheme();
    } else if (entry.action === 'logout') {
      var link = document.querySelector('[data-action="logout"]');
      if (link) link.click();
    }
  }

  function wirePalette() {
    var open = document.getElementById('palette-open');
    var el = document.getElementById('palette');
    var input = document.getElementById('palette-q');
    var list = document.getElementById('palette-list');
    var kbd = document.getElementById('palette-kbd');
    if (!open || !el || !input) return;

    if (kbd && /Mac|iPhone|iPad/.test(navigator.platform || '')) kbd.textContent = '⌘ K';

    open.addEventListener('click', function () { paletteOpen(true); });
    el.addEventListener('mousedown', function (event) {
      if (event.target === el) paletteOpen(false);
    });
    input.addEventListener('input', function () { paletteQuery(input.value); });
    list.addEventListener('click', function (event) {
      var row = event.target.closest('[data-i]');
      if (row) paletteRun(paletteState.items[Number(row.getAttribute('data-i'))]);
    });
    list.addEventListener('mousemove', function (event) {
      var row = event.target.closest('[data-i]');
      if (!row) return;
      var i = Number(row.getAttribute('data-i'));
      if (i === paletteState.index) return;
      paletteState.index = i;
      list.querySelectorAll('.palette-item').forEach(function (node, n) {
        node.classList.toggle('is-sel', n === i);
      });
    });

    input.addEventListener('keydown', function (event) {
      var count = paletteState.items.length;
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        if (!count) return;
        paletteState.index = (paletteState.index + (event.key === 'ArrowDown' ? 1 : count - 1)) % count;
        paletteRender();
      } else if (event.key === 'Enter') {
        event.preventDefault();
        paletteRun(paletteState.items[paletteState.index]);
      }
    });

    document.addEventListener('keydown', function (event) {
      var typing = /^(INPUT|TEXTAREA|SELECT)$/.test((event.target && event.target.tagName) || '') || (event.target && event.target.isContentEditable);
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        paletteOpen(el.classList.contains('hidden'));
      } else if (event.key === '/' && !typing && el.classList.contains('hidden')) {
        event.preventDefault();
        paletteOpen(true);
      } else if (event.key === 'Escape' && !el.classList.contains('hidden')) {
        paletteOpen(false);
      }
    });
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
    set('sb-name', user.fullName);
    set('sb-role', user.roleLabel);
    set('sb-initials', initials(user.fullName));
    renderQuickMenu(user);
  }

  var QUICK_ACTIONS = [
    { module: 'leave', label: 'Apply for leave', hint: 'Time off request', href: '/leave.html?apply=1', icon: '<path stroke-linecap="round" stroke-linejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 8.25h18M4.5 6.75h15A1.5 1.5 0 0121 8.25v11.25A1.5 1.5 0 0119.5 21h-15A1.5 1.5 0 013 19.5V8.25A1.5 1.5 0 014.5 6.75zM12 12v6m-3-3h6" />' },
    { module: 'loans', label: 'Request a loan', hint: 'Salary advance', href: '/finance.html#loans', icon: '<path stroke-linecap="round" stroke-linejoin="round" d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />' },
    { module: 'compensation', label: 'Claim an allowance', hint: 'Travel and benefits', href: '/finance.html#compensation', icon: '<path stroke-linecap="round" stroke-linejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25z" />' },
    { module: 'lms', label: 'Join a course', hint: 'Learning catalogue', href: '/lms.html', icon: '<path stroke-linecap="round" stroke-linejoin="round" d="M4.26 10.147a60.436 60.436 0 00-.491 6.347A48.627 48.627 0 0112 20.904a48.627 48.627 0 018.232-4.41 60.46 60.46 0 00-.491-6.347m-15.482 0a50.57 50.57 0 00-2.658-.813A59.905 59.905 0 0112 3.493a59.902 59.902 0 0110.399 5.84c-.896.248-1.783.52-2.658.814m-15.482 0A50.697 50.697 0 0112 13.489a50.702 50.702 0 017.74-3.342" />' },
    { module: 'grievance', label: 'Raise a concern', hint: 'Confidential', href: '/grievance.html', icon: '<path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />' },
  ];

  function renderQuickMenu(user) {
    var menu = document.getElementById('quick-menu');
    var button = document.getElementById('quick-new');
    if (!menu || !button) return;
    var allowed = (user && user.modules) || [];
    var items = QUICK_ACTIONS.filter(function (item) { return allowed.indexOf(item.module) !== -1; });
    button.classList.toggle('hidden', !items.length);
    menu.innerHTML = items
      .map(function (item) {
        return (
          '<a href="' + item.href + '" role="menuitem"><span class="menu-ico">' + sIcon(item.icon, 'h-4 w-4') + '</span>' +
          '<span class="min-w-0"><span class="block">' + escapeHtml(item.label) + '</span><span class="block text-[11px] font-normal text-slate-400">' + escapeHtml(item.hint) + '</span></span></a>'
        );
      })
      .join('');
  }

  function wireQuickMenu() {
    var button = document.getElementById('quick-new');
    var menu = document.getElementById('quick-menu');
    if (!button || !menu) return;
    var toggle = function (open) {
      menu.classList.toggle('hidden', !open);
      button.setAttribute('aria-expanded', String(open));
    };
    button.addEventListener('click', function (event) {
      event.stopPropagation();
      toggle(menu.classList.contains('hidden'));
    });
    document.addEventListener('click', function () { toggle(false); });
    document.addEventListener('keydown', function (event) { if (event.key === 'Escape') toggle(false); });
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

  function wireLogoutAll() {
    document.querySelectorAll('[data-action="logout-all"]').forEach(function (el) {
      el.addEventListener('click', async function () {
        if (!window.confirm('Sign out of every other device? This device stays signed in.')) return;
        try {
          var result = await api.request('/auth/logout-all', { method: 'POST' });
          session.save(result.token, result.user);
          window.alert('Done. Every other session has been ended.');
        } catch (err) {
          window.alert(err.message || 'Could not sign out other devices');
        }
      });
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
      sidebar.classList.toggle('is-open', open);
      if (backdrop) backdrop.classList.toggle('hidden', !open);
    };

    toggle.addEventListener('click', function () {
      setOpen(!sidebar.classList.contains('is-open'));
    });
    if (backdrop) backdrop.addEventListener('click', function () { setOpen(false); });
    sidebar.addEventListener('click', function (event) {
      if (event.target.closest('a.sb-link')) setOpen(false);
    });
  }

  /* Colour palettes. theme-early.js applies the saved one before first paint; this lets people change it. */
  var PALETTES = [
    { id: 'navy', label: 'Navy & gold' },
    { id: 'lagoon', label: 'Lagoon teal' },
    { id: 'indigo', label: 'Indigo' },
    { id: 'graphite', label: 'Graphite & coral' },
  ];
  function currentPalette() {
    return document.documentElement.getAttribute('data-palette') || 'lagoon';
  }
  function paintPalette() {
    var p = PALETTES.filter(function (x) { return x.id === currentPalette(); })[0] || PALETTES[0];
    var label = document.getElementById('palette-label');
    if (label) label.textContent = p.label;
  }
  function cyclePalette() {
    var ids = PALETTES.map(function (p) { return p.id; });
    var next = ids[(ids.indexOf(currentPalette()) + 1) % ids.length];
    if (next === 'lagoon') document.documentElement.removeAttribute('data-palette');
    else document.documentElement.setAttribute('data-palette', next);
    try { window.localStorage.setItem('portohr.palette', next); } catch (err) { /* not remembered, still applied */ }
    paintPalette();
  }

  function wireTheme() {
    applyTheme(storedTheme());
    paintPalette();
    document.querySelectorAll('[data-action="cycle-palette"]').forEach(function (el) {
      el.addEventListener('click', function (event) {
        event.preventDefault();
        event.stopPropagation();
        cyclePalette();
      });
    });
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
        '<p class="empty-note">No pending approvals. New requests will land here.</p>';
      return;
    }

    list.innerHTML = items
      .map(function (item) {
        return (
          '<article class="drawer-card" data-approval-id="' +
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
          '" class="btn btn-primary btn-sm">Approve</button>' +
          '<button type="button" data-reject="' +
          escapeHtml(item.decidePath) +
          '" class="btn btn-secondary btn-sm">Reject</button>' +
          '<a href="' +
          escapeHtml(item.href) +
          '" class="btn btn-ghost btn-sm">Open</a>' +
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
        '<p class="empty-note">No in-app notifications yet.</p>';
      return;
    }
    list.innerHTML = items
      .map(function (item) {
        var unread = !item.readAt;
        return (
          '<article class="drawer-card ' +
          (unread ? 'is-unread' : '') +
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

  var revealed = false;
  function reveal() {
    if (revealed) return;
    revealed = true;
    wireUserMenu();
    wireLogout();
    wireLogoutAll();
    wireSidebarToggle();
    wireTheme();
    wireApprovals();
    wireNotifications();
    wireNavGroups();
    wireTopNav();
    fitTopNav();
    wireQuickMenu();
    wirePasswordModal();
    wirePalette();
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
      // Show the page now, from the saved session, instead of waiting for the server's answer.
      // The server still decides: a revoked or expired session is sent to sign-in just below.
      reveal();
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
    if (result.user.mustChangePassword) openPasswordModal(true);

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
