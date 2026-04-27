/**
 * EDUTRACK v2 — app.js
 * ─────────────────────────────────────────────────
 * All data starts EMPTY. You add students and attendance
 * through the UI. Saves to MongoDB via API (server.js),
 * falls back to localStorage if backend is offline.
 *
 * Set API_BASE to your backend URL when running server.js
 */

const API_BASE = 'http://localhost:3000/api';

// ─── IN-MEMORY STORE ────────────────────────────────────────
let DB = {
  students:   [],   // { id, name, studentId, class, roll, email, phone, addedAt }
  attendance: [],   // { id, studentId, studentName, date, subject, class, teacher, status, savedAt }
  activity:   []    // { type, text, time }
};

let apiOnline = false;
let pendingDeleteId = null;
let pendingDeleteType = null;

// ─── INIT ────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  setTodayDate();
  loadFromStorage();
  checkAPI();
  renderDashboard();
  renderRoster();
  renderRecords();
});

// ─── DATE HELPERS ────────────────────────────────────────────
function setTodayDate() {
  const today = new Date();
  document.getElementById('today-date').textContent =
    today.toLocaleDateString('en-GB', { weekday:'short', day:'numeric', month:'short', year:'numeric' });

  // Set default date fields
  const iso = today.toISOString().split('T')[0];
  const attDate = document.getElementById('att-date');
  if (attDate) attDate.value = iso;
}

function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' });
}

function now() { return new Date().toISOString(); }

// ─── LOCAL STORAGE ───────────────────────────────────────────
function saveToStorage() {
  try {
    localStorage.setItem('edutrack_db', JSON.stringify(DB));
  } catch(e) { /* ignore */ }
}

function loadFromStorage() {
  try {
    const raw = localStorage.getItem('edutrack_db');
    if (raw) {
      const parsed = JSON.parse(raw);
      DB.students   = parsed.students   || [];
      DB.attendance = parsed.attendance || [];
      DB.activity   = parsed.activity   || [];
    }
  } catch(e) { /* ignore */ }
}

// ─── API CHECK ───────────────────────────────────────────────
async function checkAPI() {
  try {
    const res = await fetch(`${API_BASE}/health`, { signal: AbortSignal.timeout(2000) });
    if (res.ok) {
      apiOnline = true;
      setDBStatus(true);
      await syncFromAPI();
    }
  } catch {
    apiOnline = false;
    setDBStatus(false);
  }
}

function setDBStatus(online) {
  const dot   = document.querySelector('.db-dot');
  const label = document.getElementById('db-label');
  if (online) {
    dot.classList.add('connected');
    dot.classList.remove('error');
    label.textContent = 'MongoDB connected';
  } else {
    dot.classList.remove('connected');
    label.textContent = 'Local storage (offline)';
  }
}

// ─── SYNC FROM API ───────────────────────────────────────────
async function syncFromAPI() {
  try {
    const [stuRes, attRes] = await Promise.all([
      fetch(`${API_BASE}/students`),
      fetch(`${API_BASE}/attendance`)
    ]);
    if (stuRes.ok)  DB.students   = await stuRes.json();
    if (attRes.ok)  DB.attendance = await attRes.json();
    saveToStorage();
    renderDashboard();
    renderRoster();
    renderRecords();
  } catch(e) { /* use local data */ }
}

// ─── NAVIGATION ──────────────────────────────────────────────
function switchTab(btn, tabId) {
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('tab-' + tabId).classList.add('active');

  const titles = { dashboard:'Dashboard', students:'Students', attendance:'Mark Attendance', records:'Records' };
  document.getElementById('topbar-title').textContent = titles[tabId] || tabId;

  if (tabId === 'dashboard') renderDashboard();
  if (tabId === 'students')  renderRoster();
  if (tabId === 'records')   renderRecords();
}

function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('open');
}

function toggleCollapse(bodyId) {
  const body    = document.getElementById(bodyId);
  const chevron = document.getElementById('chevron-' + bodyId);
  body.classList.toggle('collapsed');
  chevron && chevron.classList.toggle('open');
}

// ─── DASHBOARD ───────────────────────────────────────────────
function renderDashboard() {
  const today = new Date().toISOString().split('T')[0];
  const todayRecords = DB.attendance.filter(a => a.date === today);

  animNum('count-students', DB.students.length);
  animNum('count-present',  todayRecords.filter(r => r.status === 'Present').length);
  animNum('count-absent',   todayRecords.filter(r => r.status === 'Absent').length);

  // Average attendance
  if (DB.attendance.length > 0) {
    const pct = Math.round(
      (DB.attendance.filter(a => a.status === 'Present').length / DB.attendance.length) * 100
    );
    document.getElementById('count-rate').textContent = pct + '%';
  } else {
    document.getElementById('count-rate').textContent = '—';
  }

  // Activity
  const actEl = document.getElementById('recent-activity');
  if (!DB.activity.length) {
    actEl.className = 'empty-state';
    actEl.innerHTML = '<div class="empty-icon">📋</div><p>No activity yet. Add students and mark attendance to see data here.</p>';
    return;
  }
  actEl.className = '';
  actEl.innerHTML = '';
  [...DB.activity].reverse().slice(0, 12).forEach(a => {
    const div = document.createElement('div');
    div.className = 'activity-item';
    div.innerHTML = `
      <div class="activity-dot ${a.type}"></div>
      <div>
        <div class="activity-text">${a.text}</div>
        <div class="activity-time">${timeAgo(a.time)}</div>
      </div>`;
    actEl.appendChild(div);
  });
}

function animNum(id, target) {
  const el = document.getElementById(id);
  if (!el) return;
  let cur = 0;
  const step = Math.max(1, Math.ceil(target / 20));
  const iv = setInterval(() => {
    cur = Math.min(cur + step, target);
    el.textContent = cur;
    if (cur >= target) clearInterval(iv);
  }, 30);
}

function timeAgo(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins  = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days  = Math.floor(diff / 86400000);
  if (mins < 1)    return 'just now';
  if (mins < 60)   return `${mins}m ago`;
  if (hours < 24)  return `${hours}h ago`;
  return `${days}d ago`;
}

// ─── ADD STUDENT ─────────────────────────────────────────────
async function addStudent() {
  const name      = v('stu-name').trim();
  const studentId = v('stu-id').trim().toUpperCase();
  const cls       = v('stu-class').trim();
  const roll      = v('stu-roll').trim();
  const email     = v('stu-email').trim().toLowerCase();
  const phone     = v('stu-phone').trim();

  if (!name)      { toast('Full name is required', 'error'); return; }
  if (!studentId) { toast('Student ID is required', 'error'); return; }
  if (!cls)       { toast('Class is required', 'error'); return; }

  // Check duplicate ID
  if (DB.students.find(s => s.studentId === studentId)) {
    toast(`Student ID "${studentId}" already exists`, 'error'); return;
  }

  const student = { id: uid(), name, studentId, class: cls, roll, email, phone, addedAt: now() };

  // Try API
  if (apiOnline) {
    try {
      const res = await fetch(`${API_BASE}/students`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(student)
      });
      if (res.ok) {
        const saved = await res.json();
        student.id = saved._id || student.id;
      }
    } catch { /* offline */ }
  }

  DB.students.push(student);
  addActivity('add', `Added student <strong>${name}</strong> (${studentId})`);
  saveToStorage();

  // Clear form
  ['stu-name','stu-id','stu-class','stu-roll','stu-email','stu-phone'].forEach(id => {
    document.getElementById(id).value = '';
  });

  renderRoster();
  renderDashboard();
  toast(`${name} added successfully`, 'success');
}

// ─── RENDER STUDENT ROSTER ───────────────────────────────────
function renderRoster(filterText = '') {
  const container = document.getElementById('student-roster');
  let list = DB.students;

  if (filterText) {
    const q = filterText.toLowerCase();
    list = list.filter(s =>
      s.name.toLowerCase().includes(q) ||
      s.studentId.toLowerCase().includes(q) ||
      (s.class || '').toLowerCase().includes(q)
    );
  }

  if (!list.length) {
    container.className = 'empty-state';
    container.innerHTML = filterText
      ? `<div class="empty-icon">🔍</div><p>No students match "<strong>${filterText}</strong>".</p>`
      : '<div class="empty-icon">🎓</div><p>No students added yet. Use the form above to add your first student.</p>';
    return;
  }

  container.className = '';
  container.innerHTML = `
    <table class="roster-table">
      <thead>
        <tr>
          <th>Name</th>
          <th>Student ID</th>
          <th>Class</th>
          <th>Roll No.</th>
          <th>Email</th>
          <th>Added</th>
          <th></th>
        </tr>
      </thead>
      <tbody id="roster-tbody"></tbody>
    </table>`;

  const tbody = document.getElementById('roster-tbody');
  list.forEach((s, i) => {
    const tr = document.createElement('tr');
    tr.style.animationDelay = `${i * 0.04}s`;
    tr.innerHTML = `
      <td>
        <div class="student-name-cell">
          <div class="student-avatar">${initials(s.name)}</div>
          <span>${s.name}</span>
        </div>
      </td>
      <td><code style="font-size:0.83rem;color:var(--muted)">${s.studentId}</code></td>
      <td>${s.class || '—'}</td>
      <td>${s.roll || '—'}</td>
      <td style="color:var(--muted)">${s.email || '—'}</td>
      <td style="color:var(--muted)">${fmtDate(s.addedAt)}</td>
      <td>
        <button class="btn-icon" onclick="confirmDelete('student','${s.id}','${s.name}')" title="Delete student">
          <svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
        </button>
      </td>`;
    tbody.appendChild(tr);
  });
}

function filterStudents() {
  const q = document.getElementById('search-students').value;
  renderRoster(q);
}

// ─── LOAD CLASS STUDENTS FOR ATTENDANCE ──────────────────────
function loadClassStudents() {
  const cls = v('att-class').trim();
  if (!cls) {
    document.getElementById('attendance-panel').style.display = 'none';
    document.getElementById('att-empty').style.display = '';
    return;
  }

  const classStudents = DB.students.filter(s =>
    s.class.toLowerCase() === cls.toLowerCase()
  );

  if (!classStudents.length) {
    document.getElementById('attendance-panel').style.display = 'none';
    document.getElementById('att-empty').style.display = '';
    document.getElementById('att-empty').innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🔍</div>
        <p>No students found in class <strong>"${cls}"</strong>.<br/>Add students first from the Students tab.</p>
      </div>`;
    return;
  }

  document.getElementById('att-empty').style.display = 'none';
  document.getElementById('attendance-panel').style.display = '';
  document.getElementById('att-panel-title').textContent =
    `Class ${cls} — ${classStudents.length} student${classStudents.length > 1 ? 's' : ''}`;

  const list = document.getElementById('att-list');
  list.innerHTML = '';
  // Default all to Present
  classStudents.forEach((s, i) => {
    const row = document.createElement('div');
    row.className = 'att-row';
    row.style.animationDelay = `${i * 0.04}s`;
    row.dataset.studentId = s.id;
    row.innerHTML = `
      <div class="att-student">
        <span class="att-name">${s.name}</span>
        <span class="att-roll">${s.studentId}${s.roll ? ' · Roll ' + s.roll : ''}</span>
      </div>
      <div class="status-toggle">
        <button class="status-btn active-present" data-status="Present"
          onclick="setStatus(this,'${s.id}')">✓ Present</button>
        <button class="status-btn" data-status="Absent"
          onclick="setStatus(this,'${s.id}')">✗ Absent</button>
        <button class="status-btn" data-status="Late"
          onclick="setStatus(this,'${s.id}')">⏰ Late</button>
      </div>`;
    list.appendChild(row);
  });
}

function setStatus(btn, studentId) {
  const toggle = btn.closest('.status-toggle');
  toggle.querySelectorAll('.status-btn').forEach(b => {
    b.className = 'status-btn';
  });
  const st = btn.dataset.status;
  btn.classList.add(`active-${st.toLowerCase()}`);
}

function bulkMark(status) {
  document.querySelectorAll('.att-row').forEach(row => {
    const toggle = row.querySelector('.status-toggle');
    if (!toggle) return;
    toggle.querySelectorAll('.status-btn').forEach(b => b.className = 'status-btn');
    const target = toggle.querySelector(`[data-status="${status}"]`);
    if (target) target.classList.add(`active-${status.toLowerCase()}`);
  });
  toast(`All marked as ${status}`, 'info');
}

// ─── SUBMIT ATTENDANCE ───────────────────────────────────────
async function submitAttendance() {
  const date    = v('att-date');
  const subject = v('att-subject').trim();
  const cls     = v('att-class').trim();
  const teacher = v('att-teacher').trim();

  if (!date)    { toast('Please select a date', 'error'); return; }
  if (!subject) { toast('Please enter a subject', 'error'); return; }
  if (!cls)     { toast('Please enter a class', 'error'); return; }

  const rows = document.querySelectorAll('.att-row');
  if (!rows.length) { toast('No students loaded', 'error'); return; }

  const records = [];
  rows.forEach(row => {
    const studentId = row.dataset.studentId;
    const student   = DB.students.find(s => s.id === studentId);
    if (!student) return;

    const activeBtn = row.querySelector('.status-btn[class*="active-"]');
    const status    = activeBtn ? activeBtn.dataset.status : 'Present';

    records.push({
      id: uid(),
      studentId: student.id,
      studentName: student.name,
      rollNo: student.studentId,
      date, subject,
      class: cls,
      teacher: teacher || 'Unknown',
      status,
      savedAt: now()
    });
  });

  // Try API
  if (apiOnline) {
    try {
      await fetch(`${API_BASE}/attendance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ records })
      });
    } catch { /* offline */ }
  }

  // Remove existing records for same date/subject/class (upsert locally)
  DB.attendance = DB.attendance.filter(a =>
    !(a.date === date && a.subject === subject && a.class === cls)
  );
  DB.attendance.push(...records);

  const pCount = records.filter(r => r.status === 'Present').length;
  addActivity('att', `Attendance marked for <strong>${cls}</strong> — ${subject} on ${fmtDate(date)} (${pCount}/${records.length} present)`);
  saveToStorage();

  toast(`Attendance saved! ${pCount}/${records.length} present`, 'success');
  renderDashboard();
}

// ─── RECORDS ─────────────────────────────────────────────────
function renderRecords(filtered = null) {
  const data   = filtered !== null ? filtered : DB.attendance;
  const tbody  = document.getElementById('records-tbody');
  const badge  = document.getElementById('record-count');
  badge.textContent = `${data.length} record${data.length !== 1 ? 's' : ''}`;

  if (!data.length) {
    tbody.innerHTML = '<tr><td colspan="8" class="table-empty">No records found.</td></tr>';
    return;
  }

  const sorted = [...data].sort((a, b) => new Date(b.date) - new Date(a.date));
  tbody.innerHTML = '';
  sorted.forEach((r, i) => {
    const tr = document.createElement('tr');
    tr.style.animationDelay = `${i * 0.02}s`;
    tr.innerHTML = `
      <td>${fmtDate(r.date)}</td>
      <td><strong>${r.studentName}</strong></td>
      <td><code style="font-size:0.8rem;color:var(--muted)">${r.rollNo}</code></td>
      <td>${r.subject}</td>
      <td>${r.class}</td>
      <td><span class="pill ${r.status.toLowerCase()}">${r.status}</span></td>
      <td style="color:var(--muted)">${r.teacher || '—'}</td>
      <td>
        <button class="btn-icon" onclick="confirmDelete('record','${r.id}','this record')" title="Delete">
          <svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
        </button>
      </td>`;
    tbody.appendChild(tr);
  });
}

function applyFilters() {
  const stuId   = v('filter-student').trim().toLowerCase();
  const subject = v('filter-subject').trim().toLowerCase();
  const from    = v('filter-from');
  const to      = v('filter-to');

  let data = DB.attendance;
  if (stuId)   data = data.filter(r => r.rollNo.toLowerCase().includes(stuId) || r.studentName.toLowerCase().includes(stuId));
  if (subject) data = data.filter(r => r.subject.toLowerCase().includes(subject));
  if (from)    data = data.filter(r => r.date >= from);
  if (to)      data = data.filter(r => r.date <= to);

  renderRecords(data);
}

function clearFilters() {
  ['filter-student','filter-subject','filter-from','filter-to'].forEach(id => {
    document.getElementById(id).value = '';
  });
  renderRecords();
}

// ─── DELETE ──────────────────────────────────────────────────
function confirmDelete(type, id, label) {
  pendingDeleteId   = id;
  pendingDeleteType = type;
  document.getElementById('modal-title').textContent = type === 'student' ? 'Delete Student' : 'Delete Record';
  document.getElementById('modal-msg').textContent =
    `Are you sure you want to delete ${label}? This cannot be undone.`;
  document.getElementById('modal-confirm-btn').onclick = executeDelete;
  document.getElementById('modal-overlay').classList.add('open');
}

async function executeDelete() {
  closeModal();
  if (!pendingDeleteId) return;

  if (pendingDeleteType === 'student') {
    // Also remove related attendance
    const stu = DB.students.find(s => s.id === pendingDeleteId);
    const name = stu ? stu.name : 'Student';
    DB.students   = DB.students.filter(s => s.id !== pendingDeleteId);
    DB.attendance = DB.attendance.filter(a => a.studentId !== pendingDeleteId);
    addActivity('del', `Removed student <strong>${name}</strong> and their attendance records`);

    if (apiOnline) {
      try { await fetch(`${API_BASE}/students/${pendingDeleteId}`, { method: 'DELETE' }); } catch {}
    }
    renderRoster();
    renderRecords();
    renderDashboard();
    toast('Student deleted', 'info');
  } else {
    DB.attendance = DB.attendance.filter(r => r.id !== pendingDeleteId);
    addActivity('del', 'Deleted an attendance record');

    if (apiOnline) {
      try { await fetch(`${API_BASE}/attendance/${pendingDeleteId}`, { method: 'DELETE' }); } catch {}
    }
    renderRecords();
    renderDashboard();
    toast('Record deleted', 'info');
  }

  saveToStorage();
  pendingDeleteId = pendingDeleteType = null;
}

function closeModal() {
  document.getElementById('modal-overlay').classList.remove('open');
}

// ─── ACTIVITY LOG ────────────────────────────────────────────
function addActivity(type, text) {
  DB.activity.push({ type, text, time: now() });
  if (DB.activity.length > 50) DB.activity = DB.activity.slice(-50);
}

// ─── HELPERS ─────────────────────────────────────────────────
function v(id) {
  return (document.getElementById(id)?.value || '');
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function initials(name) {
  return name.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase();
}

let toastTimer;
function toast(msg, type = 'info') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className   = `toast ${type} show`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3000);
}

// Close sidebar when clicking outside on mobile
document.addEventListener('click', e => {
  const sidebar = document.getElementById('sidebar');
  if (sidebar.classList.contains('open') &&
      !sidebar.contains(e.target) &&
      !e.target.closest('.menu-btn')) {
    sidebar.classList.remove('open');
  }
});
