// RandomChat Admin Dashboard
// All dynamic content uses textContent to prevent XSS.

(function () {
  'use strict';

  var REFRESH_INTERVAL_MS = 30000;
  var refreshTimer = null;

  // Element refs
  var el = {
    refreshBtn: document.getElementById('refreshBtn'),
    logoutLink: document.getElementById('logoutLink'),
    statReports: document.getElementById('statReports'),
    statBans: document.getElementById('statBans'),
    tabReports: document.getElementById('tabReports'),
    tabBans: document.getElementById('tabBans'),
    panelReports: document.getElementById('panelReports'),
    panelBans: document.getElementById('panelBans'),
    reportsBody: document.getElementById('reportsBody'),
    reportsEmpty: document.getElementById('reportsEmpty'),
    reportsError: document.getElementById('reportsError'),
    reportsTable: document.getElementById('reportsTable'),
    bansBody: document.getElementById('bansBody'),
    bansEmpty: document.getElementById('bansEmpty'),
    bansError: document.getElementById('bansError'),
    bansTable: document.getElementById('bansTable')
  };

  // ---- Utility ----
  function formatTime(ms) {
    if (ms == null) return '';
    var n = Number(ms);
    if (!isFinite(n)) return '';
    try {
      return new Date(n).toLocaleString();
    } catch (e) {
      return '';
    }
  }

  function clearChildren(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function makeCell(text, className) {
    var td = document.createElement('td');
    if (className) td.className = className;
    td.textContent = text == null ? '' : String(text);
    return td;
  }

  // ---- Tabs ----
  function showTab(tabName) {
    if (tabName !== 'reports' && tabName !== 'bans') tabName = 'reports';

    if (tabName === 'reports') {
      el.tabReports.classList.add('active');
      el.tabBans.classList.remove('active');
      el.panelReports.classList.remove('hidden');
      el.panelBans.classList.add('hidden');
    } else {
      el.tabBans.classList.add('active');
      el.tabReports.classList.remove('active');
      el.panelBans.classList.remove('hidden');
      el.panelReports.classList.add('hidden');
    }

    if (window.location.hash !== '#' + tabName) {
      try { history.replaceState(null, '', '#' + tabName); } catch (e) {
        window.location.hash = '#' + tabName;
      }
    }
  }

  function currentTabFromHash() {
    var h = (window.location.hash || '').replace(/^#/, '').toLowerCase();
    return h === 'bans' ? 'bans' : 'reports';
  }

  // ---- Reports ----
  async function fetchReports() {
    try {
      var res = await fetch('/api/admin/reports?limit=200', {
        credentials: 'same-origin',
        headers: { 'Accept': 'application/json' }
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      var data = await res.json();
      var reports = (data && Array.isArray(data.reports)) ? data.reports : [];
      renderReports(reports);
      el.reportsError.classList.add('hidden');
    } catch (err) {
      renderReports([]);
      el.reportsError.textContent = 'Failed to load reports: ' + (err && err.message ? err.message : 'unknown error');
      el.reportsError.classList.remove('hidden');
      el.reportsEmpty.classList.add('hidden');
      el.reportsTable.classList.add('hidden');
    }
  }

  function renderReports(reports) {
    clearChildren(el.reportsBody);
    el.statReports.textContent = String(reports.length);

    if (!reports.length) {
      el.reportsTable.classList.add('hidden');
      el.reportsEmpty.classList.remove('hidden');
      return;
    }

    el.reportsTable.classList.remove('hidden');
    el.reportsEmpty.classList.add('hidden');

    for (var i = 0; i < reports.length; i++) {
      var r = reports[i] || {};
      var tr = document.createElement('tr');
      tr.appendChild(makeCell(formatTime(r.created_at), 'time-cell'));
      tr.appendChild(makeCell(r.reporter_ip, 'ip-cell'));
      tr.appendChild(makeCell(r.target_ip, 'ip-cell'));
      tr.appendChild(makeCell(r.reason, 'reason-cell'));
      el.reportsBody.appendChild(tr);
    }
  }

  // ---- Bans ----
  async function fetchBans() {
    try {
      var res = await fetch('/api/admin/bans', {
        credentials: 'same-origin',
        headers: { 'Accept': 'application/json' }
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      var data = await res.json();
      var bans = (data && Array.isArray(data.bans)) ? data.bans : [];
      renderBans(bans);
      el.bansError.classList.add('hidden');
    } catch (err) {
      renderBans([]);
      el.bansError.textContent = 'Failed to load bans: ' + (err && err.message ? err.message : 'unknown error');
      el.bansError.classList.remove('hidden');
      el.bansEmpty.classList.add('hidden');
      el.bansTable.classList.add('hidden');
    }
  }

  function renderBans(bans) {
    clearChildren(el.bansBody);
    el.statBans.textContent = String(bans.length);

    if (!bans.length) {
      el.bansTable.classList.add('hidden');
      el.bansEmpty.classList.remove('hidden');
      return;
    }

    el.bansTable.classList.remove('hidden');
    el.bansEmpty.classList.add('hidden');

    for (var i = 0; i < bans.length; i++) {
      var b = bans[i] || {};
      var tr = document.createElement('tr');

      tr.appendChild(makeCell(b.ip, 'ip-cell'));
      tr.appendChild(makeCell(b.reason, 'reason-cell'));
      tr.appendChild(makeCell(formatTime(b.created_at), 'time-cell'));

      var expiresTd = document.createElement('td');
      if (b.expires_at == null) {
        expiresTd.className = 'expires-cell expires-permanent';
        expiresTd.textContent = 'Permanent';
      } else {
        expiresTd.className = 'expires-cell';
        expiresTd.textContent = formatTime(b.expires_at);
      }
      tr.appendChild(expiresTd);

      var actionTd = document.createElement('td');
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn-unban';
      btn.textContent = 'Unban';
      // Attach the IP via closure — no interpolation into markup.
      (function (ip, buttonEl) {
        buttonEl.addEventListener('click', function () {
          unban(ip, buttonEl);
        });
      })(b.ip, btn);
      actionTd.appendChild(btn);
      tr.appendChild(actionTd);

      el.bansBody.appendChild(tr);
    }
  }

  async function unban(ip, buttonEl) {
    if (ip == null || ip === '') {
      alert('Cannot unban: missing IP');
      return;
    }
    var ok = window.confirm('Unban ' + ip + '?');
    if (!ok) return;

    if (buttonEl) {
      buttonEl.disabled = true;
      buttonEl.textContent = 'Unbanning...';
    }

    try {
      var res = await fetch('/api/admin/unban', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({ ip: ip })
      });

      var data = null;
      try { data = await res.json(); } catch (e) { data = null; }

      if (!res.ok || !data || data.ok !== true) {
        var errMsg = (data && data.error) ? data.error : ('HTTP ' + res.status);
        throw new Error(errMsg);
      }

      await fetchBans();
    } catch (err) {
      alert('Unban failed: ' + (err && err.message ? err.message : 'unknown error'));
      if (buttonEl) {
        buttonEl.disabled = false;
        buttonEl.textContent = 'Unban';
      }
    }
  }

  // ---- Refresh ----
  function refreshAll() {
    fetchReports();
    fetchBans();
  }

  function startAutoRefresh() {
    stopAutoRefresh();
    if (document.hidden) return;
    refreshTimer = setInterval(refreshAll, REFRESH_INTERVAL_MS);
  }

  function stopAutoRefresh() {
    if (refreshTimer != null) {
      clearInterval(refreshTimer);
      refreshTimer = null;
    }
  }

  // Pause polling while the tab is hidden; resume + refresh on focus.
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      stopAutoRefresh();
    } else {
      refreshAll();
      startAutoRefresh();
    }
  });

  // ---- Logout ----
  function handleLogout(e) {
    if (e) e.preventDefault();
    // Trick browsers into dropping the Basic Auth credential cache by sending
    // a request with a bogus Authorization header, then navigate away.
    fetch('/api/admin/reports', {
      headers: { 'Authorization': 'Basic logout' },
      credentials: 'same-origin'
    }).catch(function () { /* expected to fail */ }).finally(function () {
      window.location.href = '/';
    });
  }

  // ---- Init ----
  function init() {
    // Tab click handlers
    el.tabReports.addEventListener('click', function () { showTab('reports'); });
    el.tabBans.addEventListener('click', function () { showTab('bans'); });

    // Hash change (back/forward)
    window.addEventListener('hashchange', function () {
      showTab(currentTabFromHash());
    });

    // Refresh button
    el.refreshBtn.addEventListener('click', refreshAll);

    // Logout
    el.logoutLink.addEventListener('click', handleLogout);

    // Unload cleanup
    window.addEventListener('beforeunload', stopAutoRefresh);

    // Initial tab from hash
    showTab(currentTabFromHash());

    // Initial data load
    refreshAll();

    // Auto-refresh
    startAutoRefresh();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
