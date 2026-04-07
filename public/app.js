const STATUS_OPTIONS = [
  { value: 'idea', label: 'Idee' },
  { value: 'work', label: 'In Arbeit' },
  { value: 'planned', label: 'Geplant' },
  { value: 'published', label: 'Veröffentlicht' }
];

const state = {
  bootstrap: { categories: [], types: [], channels: [] },
  planner: [], ideas: [], users: [], user: null,
  editPlannerId: null, editIdeaId: null,
  calendarDate: new Date(), calendarMode: 'month',
  combos: {}, csrfToken: '',
  filters: { plannerSearch: '', plannerStatus: '', plannerChannel: '', ideaSearch: '' }
};

const el = (id) => document.getElementById(id);

async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  if (opts.method && opts.method !== 'GET' && state.csrfToken) headers['X-CSRF-Token'] = state.csrfToken;
  const res = await fetch(path, { ...opts, headers, credentials: 'same-origin' });
  if (res.status === 401) { location.href = '/login'; return; }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Fehler');
  return data;
}

function escapeHtml(text = '') { return String(text).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m])); }
function statusLabel(status) { return STATUS_OPTIONS.find(x => x.value === status)?.label || status; }
function roleLabel(role) { return { admin: 'Admin', editor: 'Editor', viewer: 'Viewer' }[role] || role; }
function fmtDate(iso) { if (!iso) return '—'; const d = new Date(iso); return isNaN(d) ? iso : d.toLocaleDateString('de-AT', { day: '2-digit', month: '2-digit' }); }
function dayName(iso) { if (!iso) return '—'; const d = new Date(iso); return isNaN(d) ? '—' : ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'][d.getDay()]; }
function fullDate(iso) { if (!iso) return '—'; const d = new Date(iso); return isNaN(d) ? iso : d.toLocaleDateString('de-AT', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' }); }
function isViewer() { return state.user?.role === 'viewer'; }
function isAdmin() { return state.user?.role === 'admin'; }

function showMessage(id, msg, type = 'ok') {
  const node = el(id); if (!node) return;
  node.textContent = msg || '';
  node.className = `inline-message ${msg ? 'show ' + type : ''}`;
}
function openModal(id) { el(id)?.classList.remove('hidden'); }
function closeModal(id) { el(id)?.classList.add('hidden'); }
function setLoading(btn, loading, originalText) {
  if (!btn) return;
  btn.disabled = loading;
  btn.textContent = loading ? 'Wird gespeichert…' : originalText;
  btn.style.opacity = loading ? '0.65' : '';
}
function showDefaultPasswordWarning(show) { el('default-pw-banner')?.classList.toggle('hidden', !show); }

function showToast(msg, type = 'success') {
  const container = el('toast-container'); if (!container) return;
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = msg;
  container.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('visible'));
  setTimeout(() => {
    toast.classList.remove('visible');
    setTimeout(() => toast.remove(), 280);
  }, 3000);
}

function renderChannelChips(containerId, prefix, selected = []) {
  const container = el(containerId); if (!container) return;
  container.innerHTML = '';
  state.bootstrap.channels.forEach(ch => {
    const safe = ch.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
    const id = `${prefix}-${safe}`;
    const wrap = document.createElement('label');
    wrap.className = 'channel-chip';
    wrap.innerHTML = `<input type="checkbox" value="${escapeHtml(ch)}" id="${id}" ${selected.includes(ch) ? 'checked' : ''}><span>${escapeHtml(ch)}</span>`;
    container.appendChild(wrap);
  });
}
function selectedChannels(containerId) { return [...el(containerId).querySelectorAll('input:checked')].map(i => i.value); }

function setupCombo({ inputId, menuId, getItems, allowCreate = true, readOnly = false, onSelect = null }) {
  const input = el(inputId), menu = el(menuId);
  if (!input || !menu) return;
  if (readOnly) input.readOnly = true;
  state.combos[inputId] = { input, menu, getItems, allowCreate, readOnly, onSelect };

  function renderMenu(filter = '') {
    const items = getItems().filter(Boolean);
    const norm = filter.trim().toLowerCase();
    const matches = items.filter(item => item.label.toLowerCase().includes(norm));
    const exact = items.some(item => item.label.toLowerCase() === norm && norm);
    menu.innerHTML = ([
      ...matches.map(item => `<button type="button" class="combo-option ${item.value === input.value ? 'selected' : ''}" data-value="${escapeHtml(item.value)}">${escapeHtml(item.label)}</button>`),
      ...(allowCreate && norm && !exact ? [`<button type="button" class="combo-option create" data-value="${escapeHtml(filter.trim())}">+ „${escapeHtml(filter.trim())}" anlegen</button>`] : [])
    ].join('')) || `<div class="combo-empty">Keine Treffer</div>`;
    menu.classList.remove('hidden');
  }
  input.addEventListener('focus', () => renderMenu(input.value));
  input.addEventListener('click', () => renderMenu(input.value));
  if (!readOnly) input.addEventListener('input', () => renderMenu(input.value));
  menu.addEventListener('click', (e) => {
    const opt = e.target.closest('.combo-option'); if (!opt) return;
    input.value = opt.dataset.value || '';
    menu.classList.add('hidden');
    onSelect?.(input.value);
  });
}

function refreshComboMenus() {
  Object.values(state.combos).forEach(combo => {
    if (!combo.menu.classList.contains('hidden')) combo.input.dispatchEvent(new Event('focus'));
  });
}

function setStatusByValue(id, value) { el(id).value = STATUS_OPTIONS.find(x => x.value === value)?.label || 'Idee'; }
function statusValueFromInput(id) { return STATUS_OPTIONS.find(x => x.label === el(id).value)?.value || 'idea'; }
function setStatusInputs() { setStatusByValue('planner-status', 'idea'); setStatusByValue('idea-status', 'idea'); }

function applyRoleUi() {
  const viewer = isViewer();
  document.querySelectorAll('.editor-only').forEach(node => node.classList.toggle('hidden', viewer));
  el('planner-viewer-lock')?.classList.toggle('hidden', !viewer);
  el('ideas-viewer-lock')?.classList.toggle('hidden', !viewer);
  document.querySelectorAll('.admin-only').forEach(node => node.classList.toggle('hidden', !isAdmin()));
}

function todoPriorityLabel(priority) {
  return { high: 'Hoch', medium: 'Mittel', low: 'Niedrig' }[priority] || 'Info';
}

function renderOverview(summary) {
  el('stat-planner').textContent = summary.stats.planner;
  el('stat-ideas').textContent = summary.stats.ideas;
  el('stat-work').textContent = summary.stats.work;
  el('stat-channels').textContent = summary.stats.channels;
  el('stat-channel-names').textContent = summary.stats.channel_names?.join(', ') || '–';

  const overviewList = el('overview-list');
  if (!summary.upcoming.length) {
    overviewList.innerHTML = `<div class="empty-state">Noch keine Beiträge im Planer. Leg los! 🚀</div>`;
  } else {
    overviewList.innerHTML = `<div class="compact-row head"><div>Datum</div><div>Titel</div><div>Kategorie</div><div>Art</div><div>Kanäle</div><div>Status</div></div>` +
      summary.upcoming.map(item => `<div class="compact-row"><div class="compact-date">${fmtDate(item.planned_date)}</div><div class="compact-name">${escapeHtml(item.title)}</div><div class="muted">${escapeHtml(item.category || '—')}</div><div class="muted">${escapeHtml(item.content_type || '—')}</div><div class="compact-channels">${(item.channels || []).map(escapeHtml).join(' · ') || '—'}</div><span class="status ${item.status}">${statusLabel(item.status)}</span></div>`).join('');
  }

  el('todo-list').innerHTML = summary.todos.length ? summary.todos.map(todo => `
    <div class="todo-item todo-priority-${todo.priority || 'low'}">
      <div>
        <div class="todo-topline"><span class="todo-priority-badge ${todo.priority || 'low'}">${todoPriorityLabel(todo.priority)}</span></div>
        <strong>${escapeHtml(todo.text)}</strong>
        <div class="small">${escapeHtml(todo.detail || '')}</div>
      </div>
      <span class="status ${todo.kind}">${statusLabel(todo.kind)}</span>
    </div>`).join('') : `<div class="empty-state">Keine offenen To-dos. Ein fast schon verdächtiger Zustand.</div>`;

  el('open-ideas-list').innerHTML = summary.openIdeas.length ? summary.openIdeas.map(item => `
    <div class="todo-item"><span>${escapeHtml(item.title)}</span>${isViewer() ? '' : `<button class="btn btn-secondary" onclick="moveToPlanner(${item.id})">Einplanen</button>`}</div>`).join('') : `<div class="empty-state">Keine offenen Ideen.</div>`;
}

function filteredPlannerItems() {
  const search = state.filters.plannerSearch.trim().toLowerCase();
  return state.planner.filter(item => {
    const hay = [item.title, item.category, item.content_type, item.notes, ...(item.channels || [])].join(' ').toLowerCase();
    const searchOk = !search || hay.includes(search);
    const statusOk = !state.filters.plannerStatus || item.status === state.filters.plannerStatus;
    const channelOk = !state.filters.plannerChannel || (item.channels || []).includes(state.filters.plannerChannel);
    return searchOk && statusOk && channelOk;
  });
}

function filteredIdeas() {
  const search = state.filters.ideaSearch.trim().toLowerCase();
  return state.ideas.filter(item => !search || [item.title, item.category, item.content_type, item.notes].join(' ').toLowerCase().includes(search));
}

function plannerActions(item) {
  if (isViewer()) return '<span class="small muted">Nur lesen</span>';
  return `<div class="badges"><button class="icon-btn" onclick="editPlanner(${item.id})">✏️ Bearbeiten</button><button class="icon-btn" onclick="moveToIdeas(${item.id})">💡 Zurück</button><button class="icon-btn danger-btn" onclick="confirmDelete(${item.id}, 'post')">🗑 Löschen</button></div>`;
}

function renderPlanner() {
  const rows = el('planner-rows');
  const items = filteredPlannerItems();
  if (!items.length) {
    rows.innerHTML = `<div class="empty-state" style="padding:24px">Keine Treffer. Entweder sind die Filter zu streng oder NØRA möchte Drama.</div>`;
    return;
  }
  rows.innerHTML = items.map(item => `<div class="row"><div><span class="day-chip">${dayName(item.planned_date)}</span></div><div>${fmtDate(item.planned_date)}</div><div class="title">${escapeHtml(item.title)}</div><div class="muted">${escapeHtml(item.category || '—')}</div><div class="muted">${escapeHtml(item.content_type || '—')}</div><div class="badges">${(item.channels || []).map(ch => `<span class="badge">${escapeHtml(ch)}</span>`).join('')}</div><div><span class="status ${item.status}">${statusLabel(item.status)}</span></div><div>${plannerActions(item)}</div></div>`).join('');
}

function renderIdeas() {
  const cards = el('idea-cards');
  const items = filteredIdeas();
  if (!items.length) {
    cards.innerHTML = `<div class="empty-state" style="grid-column:1/-1;padding:24px">Keine passenden Ideen gefunden.</div>`;
    return;
  }
  cards.innerHTML = items.map(item => `<article class="idea-card" draggable="${!isViewer()}" data-idea-id="${item.id}"><div><h5>${escapeHtml(item.title)}</h5><p>${escapeHtml(item.notes || 'Noch keine Notizen.')}</p></div><div class="card-actions"><div class="badges"><span class="badge">${escapeHtml(item.category || 'Ohne Kategorie')}</span><span class="badge">${escapeHtml(item.content_type || 'Ohne Art')}</span></div><div class="badges">${isViewer() ? '<span class="small muted">Nur lesen</span>' : `<button class="icon-btn" onclick="editIdea(${item.id})">✏️ Bearbeiten</button><button class="btn btn-primary" onclick="moveToPlanner(${item.id})">In Planer</button>`}</div></div></article>`).join('');
  document.querySelectorAll('.idea-card[draggable="true"]').forEach(card => card.addEventListener('dragstart', e => e.dataTransfer.setData('text/plain', card.dataset.ideaId)));
}

function renderChannelAdminList() {
  const wrap = el('channel-admin-list'); if (!wrap) return;
  wrap.innerHTML = state.bootstrap.channels.map(ch => `
    <div class="channel-admin-item">
      <span>${escapeHtml(ch)}</span>
      ${isViewer() ? '' : `<button class="icon-btn" onclick="openRenameChannelModal('${escapeHtml(ch)}')">Umbenennen</button><button class="icon-btn danger-btn" onclick="confirmDelete('${escapeHtml(ch)}', 'channel')">Löschen</button>`}
    </div>`).join('');
}

function calendarItemsForDate(dateObj) {
  const y = dateObj.getFullYear(), m = dateObj.getMonth(), d = dateObj.getDate();
  return state.planner.filter(item => {
    if (!item.planned_date) return false;
    const x = new Date(item.planned_date);
    return x.getFullYear() === y && x.getMonth() === m && x.getDate() === d;
  });
}

function attachCalendarDnD(grid) {
  grid.querySelectorAll('.calendar-cell').forEach(cell => {
    cell.addEventListener('dragover', e => { if (!isViewer()) { e.preventDefault(); cell.classList.add('dragover'); } });
    cell.addEventListener('dragleave', () => cell.classList.remove('dragover'));
    cell.addEventListener('drop', async e => {
      if (isViewer()) return;
      e.preventDefault(); cell.classList.remove('dragover');
      const date = cell.dataset.date; if (!date) return;
      const plannerId = e.dataTransfer.getData('planner-id');
      if (plannerId) {
        const item = state.planner.find(x => x.id === Number(plannerId));
        if (!item) return;
        await api(`/api/posts/${plannerId}`, { method: 'PUT', body: JSON.stringify({ ...item, planned_date: date }) });
        await loadPosts();
        return;
      }
      const ideaId = Number(e.dataTransfer.getData('text/plain'));
      if (ideaId) await moveToPlanner(ideaId, date);
    });
  });
  grid.querySelectorAll('.calendar-item[draggable="true"]').forEach(btn => btn.addEventListener('dragstart', e => {
    e.stopPropagation();
    e.dataTransfer.setData('planner-id', btn.dataset.plannerId);
  }));
}

function renderCalendar() {
  const grid = el('calendar-grid');
  const current = new Date(state.calendarDate.getFullYear(), state.calendarDate.getMonth(), 1);
  el('calendar-mode-month').classList.toggle('active', state.calendarMode === 'month');
  el('calendar-mode-week').classList.toggle('active', state.calendarMode === 'week');

  if (state.calendarMode === 'week') {
    const today = new Date(state.calendarDate);
    const weekday = (today.getDay() + 6) % 7;
    const monday = new Date(today); monday.setDate(today.getDate() - weekday);
    const sunday = new Date(monday); sunday.setDate(monday.getDate() + 6);
    el('calendar-title').textContent = `${fullDate(monday.toISOString().slice(0,10))} – ${fullDate(sunday.toISOString().slice(0,10))}`;
    const cells = [];
    for (let i = 0; i < 7; i++) {
      const day = new Date(monday); day.setDate(monday.getDate() + i);
      const items = calendarItemsForDate(day);
      const dateStr = day.toISOString().slice(0, 10);
      const isToday = new Date().toDateString() === day.toDateString();
      cells.push(`<div class="calendar-cell ${isToday ? 'today' : ''}" data-date="${dateStr}"><div class="calendar-date">${day.toLocaleDateString('de-AT', { weekday: 'short', day: '2-digit', month: '2-digit' })}</div><div class="calendar-items">${items.map(item => `<button class="calendar-item ${item.status}" draggable="${!isViewer()}" data-planner-id="${item.id}" onclick="editPlanner(${item.id})">${escapeHtml(item.title)}</button>`).join('') || '<div class="calendar-more">Nichts geplant</div>'}</div></div>`);
    }
    grid.classList.add('week-view');
    grid.innerHTML = cells.join('');
    attachCalendarDnD(grid);
    return;
  }

  grid.classList.remove('week-view');
  const monthName = current.toLocaleDateString('de-AT', { month: 'long', year: 'numeric' });
  el('calendar-title').textContent = monthName.charAt(0).toUpperCase() + monthName.slice(1);
  const firstWeekday = (current.getDay() + 6) % 7;
  const daysInMonth = new Date(current.getFullYear(), current.getMonth() + 1, 0).getDate();
  const prevDays = new Date(current.getFullYear(), current.getMonth(), 0).getDate();
  const cells = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(`<div class="calendar-cell muted-day"><div class="calendar-date">${prevDays - firstWeekday + i + 1}</div></div>`);
  for (let day = 1; day <= daysInMonth; day++) {
    const dateObj = new Date(current.getFullYear(), current.getMonth(), day);
    const items = calendarItemsForDate(dateObj);
    const isToday = new Date().toDateString() === dateObj.toDateString();
    const dateStr = `${current.toISOString().slice(0, 7)}-${String(day).padStart(2, '0')}`;
    cells.push(`<div class="calendar-cell ${isToday ? 'today' : ''}" data-date="${dateStr}"><div class="calendar-date">${day}</div><div class="calendar-items">${items.slice(0, 4).map(item => `<button class="calendar-item ${item.status}" draggable="${!isViewer()}" data-planner-id="${item.id}" onclick="editPlanner(${item.id})">${escapeHtml(item.title)}</button>`).join('')}${items.length > 4 ? `<div class="calendar-more">+${items.length - 4} mehr</div>` : ''}</div></div>`);
  }
  while (cells.length % 7 !== 0) cells.push('<div class="calendar-cell muted-day"></div>');
  grid.innerHTML = cells.join('');
  attachCalendarDnD(grid);
}

async function loadUsers() {
  state.users = await api('/api/users');
  el('users-list').innerHTML = state.users.map(user => `
    <div class="user-row"><div><div class="user-name-row"><strong>${escapeHtml(user.username)}</strong><span class="status ${user.is_active ? 'planned' : 'idea'}">${user.is_active ? 'Aktiv' : 'Inaktiv'}</span></div><div class="small">${roleLabel(user.role)} · erstellt ${new Date(user.created_at).toLocaleDateString('de-AT')}</div></div><div class="user-controls"><select class="select compact-select" onchange="changeUserRole(${user.id}, this.value, ${user.is_active ? 'true' : 'false'})"><option value="admin" ${user.role === 'admin' ? 'selected' : ''}>Admin</option><option value="editor" ${user.role === 'editor' ? 'selected' : ''}>Editor</option><option value="viewer" ${user.role === 'viewer' ? 'selected' : ''}>Viewer</option></select><label class="switch"><input type="checkbox" ${user.is_active ? 'checked' : ''} onchange="toggleUserActive(${user.id}, '${user.role}', this.checked)"><span>Aktiv</span></label><button class="icon-btn" onclick="openResetPasswordModal(${user.id}, '${escapeHtml(user.username)}')">🔑 Passwort</button><button class="icon-btn danger-btn" onclick="removeUser(${user.id}, '${escapeHtml(user.username)}')">🗑 Löschen</button></div></div>`).join('');
}

async function loadPosts() {
  [state.planner, state.ideas] = await Promise.all([api('/api/posts?location=planner'), api('/api/posts?location=ideas')]);
  renderChannelChips('planner-channels', 'planner');
  renderChannelChips('idea-channels', 'idea');
  renderChannelAdminList();
  renderPlanner();
  renderIdeas();
  renderCalendar();
  refreshComboMenus();
  const summary = await api('/api/summary');
  renderOverview(summary);
}

async function loadAll() {
  const me = await api('/api/me');
  state.user = me.user;
  state.csrfToken = me.csrf_token || '';
  el('user-pill').textContent = state.user ? `${state.user.username} · ${roleLabel(state.user.role)}` : '';
  applyRoleUi();
  showDefaultPasswordWarning(me.default_password);
  state.bootstrap = await api('/api/bootstrap');
  await loadPosts();
  if (isAdmin()) await loadUsers();
}

async function savePlanner() {
  const btn = el('planner-save'), orig = btn.textContent;
  const payload = {
    title: el('planner-title').value.trim(),
    planned_date: el('planner-date').value || null,
    category: el('planner-category').value.trim(),
    content_type: el('planner-type').value.trim(),
    notes: el('planner-notes').value.trim(),
    status: statusValueFromInput('planner-status'),
    channels: selectedChannels('planner-channels'),
    location: 'planner'
  };
  if (!payload.title) return showToast('Titel fehlt', 'error');
  setLoading(btn, true, orig);
  try {
    if (state.editPlannerId) await api(`/api/posts/${state.editPlannerId}`, { method: 'PUT', body: JSON.stringify(payload) });
    else await api('/api/posts', { method: 'POST', body: JSON.stringify(payload) });
    showToast('Beitrag gespeichert ✓');
    resetPlannerForm();
    await loadPosts();
  } catch (err) { showToast(err.message, 'error'); } finally { setLoading(btn, false, orig); }
}

async function saveIdea() {
  const btn = el('idea-save'), orig = btn.textContent;
  const payload = {
    title: el('idea-title').value.trim(),
    planned_date: null,
    category: el('idea-category').value.trim(),
    content_type: el('idea-type').value.trim(),
    notes: el('idea-notes').value.trim(),
    status: statusValueFromInput('idea-status'),
    channels: selectedChannels('idea-channels'),
    location: 'ideas'
  };
  if (!payload.title) return showToast('Titel fehlt', 'error');
  setLoading(btn, true, orig);
  try {
    if (state.editIdeaId) await api(`/api/posts/${state.editIdeaId}`, { method: 'PUT', body: JSON.stringify(payload) });
    else await api('/api/posts', { method: 'POST', body: JSON.stringify(payload) });
    showToast('Idee gespeichert ✓');
    resetIdeaForm();
    await loadPosts();
  } catch (err) { showToast(err.message, 'error'); } finally { setLoading(btn, false, orig); }
}

function resetPlannerForm() {
  state.editPlannerId = null;
  ['planner-title', 'planner-date', 'planner-category', 'planner-type', 'planner-notes'].forEach(id => el(id).value = '');
  setStatusByValue('planner-status', 'idea');
  renderChannelChips('planner-channels', 'planner');
}
function resetIdeaForm() {
  state.editIdeaId = null;
  ['idea-title', 'idea-category', 'idea-type', 'idea-notes'].forEach(id => el(id).value = '');
  setStatusByValue('idea-status', 'idea');
  renderChannelChips('idea-channels', 'idea');
}

window.editPlanner = function(id) {
  const item = state.planner.find(x => x.id === id); if (!item) return;
  state.editPlannerId = id;
  el('planner-title').value = item.title; el('planner-date').value = item.planned_date || '';
  el('planner-category').value = item.category || ''; el('planner-type').value = item.content_type || '';
  el('planner-notes').value = item.notes || ''; setStatusByValue('planner-status', item.status);
  renderChannelChips('planner-channels', 'planner', item.channels || []);
  activate('planner'); window.scrollTo({ top: 0, behavior: 'smooth' });
};
window.editIdea = function(id) {
  const item = state.ideas.find(x => x.id === id); if (!item) return;
  state.editIdeaId = id;
  el('idea-title').value = item.title; el('idea-category').value = item.category || ''; el('idea-type').value = item.content_type || '';
  el('idea-notes').value = item.notes || ''; setStatusByValue('idea-status', item.status);
  renderChannelChips('idea-channels', 'idea', item.channels || []);
  activate('ideas'); window.scrollTo({ top: 0, behavior: 'smooth' });
};
window.moveToPlanner = async function(id, forcedDate = null) {
  const item = [...state.ideas, ...state.planner].find(x => x.id === id); if (!item) return;
  await api(`/api/posts/${id}`, { method: 'PUT', body: JSON.stringify({ ...item, location: 'planner', planned_date: forcedDate || item.planned_date || new Date().toISOString().slice(0, 10) }) });
  await loadPosts(); activate('planner');
};
window.moveToIdeas = async function(id) {
  const item = state.planner.find(x => x.id === id); if (!item) return;
  await api(`/api/posts/${id}`, { method: 'PUT', body: JSON.stringify({ ...item, location: 'ideas', planned_date: null, status: 'idea' }) });
  await loadPosts(); activate('ideas');
};

window.confirmDelete = function(id, type, label = '') {
  const modal = el('confirm-modal');
  const msg = el('confirm-message');
  const shown = label || id;
  msg.textContent = type === 'channel' ? `Kanal „${shown}” wirklich löschen? Er verschwindet aus allen Beiträgen.` : type === 'user' ? `Benutzer „${shown}” wirklich löschen?` : 'Beitrag wirklich löschen? Diese Aktion kann nicht rückgängig gemacht werden.';
  modal.dataset.pendingId = id; modal.dataset.pendingType = type; openModal('confirm-modal');
};

window.openRenameChannelModal = function(name) {
  el('rename-channel-old').textContent = name;
  el('rename-channel-new').value = name;
  el('rename-channel-modal').dataset.oldName = name;
  showMessage('rename-channel-message', '');
  openModal('rename-channel-modal');
};

async function handleConfirmOk() {
  const modal = el('confirm-modal');
  const id = modal.dataset.pendingId, type = modal.dataset.pendingType;
  closeModal('confirm-modal');
  try {
    if (type === 'post') { await api(`/api/posts/${id}`, { method: 'DELETE' }); showToast('Beitrag gelöscht'); await loadPosts(); }
    else if (type === 'channel') { await api(`/api/channels/${encodeURIComponent(id)}`, { method: 'DELETE' }); showToast('Kanal gelöscht'); state.bootstrap = await api('/api/bootstrap'); await loadPosts(); }
    else if (type === 'user') { await api(`/api/users/${id}`, { method: 'DELETE' }); showToast('Benutzer gelöscht'); await loadUsers(); }
  } catch (err) { showToast(err.message, 'error'); }
}

window.changeUserRole = async function(userId, role, isActive) {
  try { await api(`/api/users/${userId}`, { method: 'PUT', body: JSON.stringify({ role, is_active: isActive }) }); showToast('Rolle aktualisiert'); await loadUsers(); }
  catch (err) { showToast(err.message, 'error'); await loadUsers(); }
};
window.toggleUserActive = async function(userId, role, checked) {
  try { await api(`/api/users/${userId}`, { method: 'PUT', body: JSON.stringify({ role, is_active: checked }) }); showToast(checked ? 'Benutzer aktiviert' : 'Benutzer deaktiviert'); await loadUsers(); }
  catch (err) { showToast(err.message, 'error'); await loadUsers(); }
};
window.openResetPasswordModal = function(userId, username) {
  el('reset-pw-username').textContent = username; el('reset-pw-new').value = ''; el('reset-pw-new-2').value = ''; showMessage('reset-pw-message', '');
  el('reset-pw-modal').dataset.userId = userId; openModal('reset-pw-modal');
};
window.removeUser = function(userId, username) { confirmDelete(userId, 'user', username); };

function activate(pageId) {
  document.querySelectorAll('.page').forEach(p => p.classList.toggle('active', p.id === pageId));
  document.querySelectorAll('.nav-link').forEach(a => a.classList.toggle('active', a.dataset.page === pageId));
}

function bindEvents() {
  document.addEventListener('click', e => document.querySelectorAll('.combo-menu').forEach(menu => { if (!menu.parentElement.contains(e.target)) menu.classList.add('hidden'); }));
  document.querySelectorAll('.nav-link').forEach(a => a.addEventListener('click', e => { e.preventDefault(); activate(a.dataset.page); }));
  document.querySelectorAll('[data-close]').forEach(btn => btn.addEventListener('click', () => closeModal(btn.dataset.close)));
  document.querySelectorAll('.modal-backdrop').forEach(bg => bg.addEventListener('click', e => { if (e.target === bg) bg.classList.add('hidden'); }));

  el('planner-save').addEventListener('click', savePlanner);
  el('idea-save').addEventListener('click', saveIdea);
  el('planner-reset').addEventListener('click', resetPlannerForm);
  el('idea-reset').addEventListener('click', resetIdeaForm);
  el('confirm-ok').addEventListener('click', handleConfirmOk);
  el('confirm-cancel').addEventListener('click', () => closeModal('confirm-modal'));

  el('logout-btn').addEventListener('click', async () => { await api('/api/logout', { method: 'POST' }); location.href = '/login'; });
  el('change-password-btn').addEventListener('click', () => { showMessage('pw-message', ''); ['pw-current', 'pw-new', 'pw-new-2'].forEach(id => el(id).value = ''); openModal('password-modal'); });
  el('manage-users-btn').addEventListener('click', async () => { await loadUsers(); openModal('users-modal'); });
  el('default-pw-banner-btn')?.addEventListener('click', () => { showMessage('pw-message', ''); ['pw-current', 'pw-new', 'pw-new-2'].forEach(id => el(id).value = ''); openModal('password-modal'); });

  el('pw-save').addEventListener('click', async () => {
    if (el('pw-new').value !== el('pw-new-2').value) return showMessage('pw-message', 'Die neuen Passwörter stimmen nicht überein', 'error');
    const btn = el('pw-save'), orig = btn.textContent; setLoading(btn, true, orig);
    try { await api('/api/account/password', { method: 'POST', body: JSON.stringify({ current_password: el('pw-current').value, new_password: el('pw-new').value }) }); showMessage('pw-message', 'Passwort erfolgreich geändert', 'success'); setTimeout(() => closeModal('password-modal'), 900); }
    catch (err) { showMessage('pw-message', err.message, 'error'); } finally { setLoading(btn, false, orig); }
  });

  el('create-user-btn').addEventListener('click', async () => {
    const btn = el('create-user-btn'), orig = btn.textContent; setLoading(btn, true, orig);
    try { await api('/api/users', { method: 'POST', body: JSON.stringify({ username: el('new-username').value.trim(), password: el('new-password').value, role: el('new-role').value }) }); el('new-username').value = ''; el('new-password').value = ''; el('new-role').value = 'editor'; showMessage('users-create-message', 'Benutzer angelegt', 'success'); await loadUsers(); }
    catch (err) { showMessage('users-create-message', err.message, 'error'); } finally { setLoading(btn, false, orig); }
  });

  el('reset-pw-save').addEventListener('click', async () => {
    if (el('reset-pw-new').value !== el('reset-pw-new-2').value) return showMessage('reset-pw-message', 'Passwörter stimmen nicht überein', 'error');
    const btn = el('reset-pw-save'), orig = btn.textContent; setLoading(btn, true, orig);
    try { await api(`/api/users/${el('reset-pw-modal').dataset.userId}/reset-password`, { method: 'POST', body: JSON.stringify({ new_password: el('reset-pw-new').value }) }); showToast('Passwort zurückgesetzt ✓'); closeModal('reset-pw-modal'); }
    catch (err) { showMessage('reset-pw-message', err.message, 'error'); } finally { setLoading(btn, false, orig); }
  });

  el('add-channel-btn').addEventListener('click', async () => {
    const name = el('new-channel-name').value.trim(); if (!name) return;
    const btn = el('add-channel-btn'), orig = btn.textContent; setLoading(btn, true, orig);
    try { await api('/api/channels', { method: 'POST', body: JSON.stringify({ name }) }); el('new-channel-name').value = ''; state.bootstrap = await api('/api/bootstrap'); showToast('Kanal angelegt ✓'); await loadPosts(); }
    catch (err) { showToast(err.message, 'error'); } finally { setLoading(btn, false, orig); }
  });

  el('rename-channel-save').addEventListener('click', async () => {
    const oldName = el('rename-channel-modal').dataset.oldName;
    const newName = el('rename-channel-new').value.trim();
    if (!newName) return showMessage('rename-channel-message', 'Bitte einen Namen eingeben', 'error');
    const btn = el('rename-channel-save'), orig = btn.textContent; setLoading(btn, true, orig);
    try { await api(`/api/channels/${encodeURIComponent(oldName)}`, { method: 'PUT', body: JSON.stringify({ name: newName }) }); state.bootstrap = await api('/api/bootstrap'); showToast('Kanal umbenannt ✓'); closeModal('rename-channel-modal'); await loadPosts(); }
    catch (err) { showMessage('rename-channel-message', err.message, 'error'); } finally { setLoading(btn, false, orig); }
  });

  el('calendar-prev').addEventListener('click', () => {
    if (state.calendarMode === 'month') state.calendarDate = new Date(state.calendarDate.getFullYear(), state.calendarDate.getMonth() - 1, 1);
    else state.calendarDate = new Date(state.calendarDate.getFullYear(), state.calendarDate.getMonth(), state.calendarDate.getDate() - 7);
    renderCalendar();
  });
  el('calendar-next').addEventListener('click', () => {
    if (state.calendarMode === 'month') state.calendarDate = new Date(state.calendarDate.getFullYear(), state.calendarDate.getMonth() + 1, 1);
    else state.calendarDate = new Date(state.calendarDate.getFullYear(), state.calendarDate.getMonth(), state.calendarDate.getDate() + 7);
    renderCalendar();
  });
  el('calendar-mode-month').addEventListener('click', () => { state.calendarMode = 'month'; renderCalendar(); });
  el('calendar-mode-week').addEventListener('click', () => { state.calendarMode = 'week'; renderCalendar(); });

  el('planner-search').addEventListener('input', e => { state.filters.plannerSearch = e.target.value; renderPlanner(); });
  el('idea-search').addEventListener('input', e => { state.filters.ideaSearch = e.target.value; renderIdeas(); });
  el('planner-clear-filters').addEventListener('click', () => {
    state.filters.plannerSearch = ''; state.filters.plannerStatus = ''; state.filters.plannerChannel = '';
    el('planner-search').value = ''; el('planner-filter-status').value = ''; el('planner-filter-channel').value = '';
    renderPlanner(); refreshComboMenus();
  });
}

setupCombo({ inputId: 'planner-category', menuId: 'planner-category-menu', getItems: () => state.bootstrap.categories.map(v => ({ value: v, label: v })) });
setupCombo({ inputId: 'planner-type', menuId: 'planner-type-menu', getItems: () => state.bootstrap.types.map(v => ({ value: v, label: v })) });
setupCombo({ inputId: 'idea-category', menuId: 'idea-category-menu', getItems: () => state.bootstrap.categories.map(v => ({ value: v, label: v })) });
setupCombo({ inputId: 'idea-type', menuId: 'idea-type-menu', getItems: () => state.bootstrap.types.map(v => ({ value: v, label: v })) });
setupCombo({ inputId: 'planner-status', menuId: 'planner-status-menu', getItems: () => STATUS_OPTIONS.map(x => ({ value: x.label, label: x.label })), allowCreate: false, readOnly: true });
setupCombo({ inputId: 'idea-status', menuId: 'idea-status-menu', getItems: () => STATUS_OPTIONS.filter(x => x.value !== 'published').map(x => ({ value: x.label, label: x.label })), allowCreate: false, readOnly: true });
setupCombo({ inputId: 'planner-filter-status', menuId: 'planner-filter-status-menu', getItems: () => [{ value: '', label: 'Alle Status' }, ...STATUS_OPTIONS.map(x => ({ value: x.value, label: x.label }))], allowCreate: false, readOnly: true, onSelect: value => { state.filters.plannerStatus = value; el('planner-filter-status').value = value ? statusLabel(value) : 'Alle Status'; renderPlanner(); } });
setupCombo({ inputId: 'planner-filter-channel', menuId: 'planner-filter-channel-menu', getItems: () => [{ value: '', label: 'Alle Kanäle' }, ...state.bootstrap.channels.map(x => ({ value: x, label: x }))], allowCreate: false, readOnly: true, onSelect: value => { state.filters.plannerChannel = value; el('planner-filter-channel').value = value || 'Alle Kanäle'; renderPlanner(); } });

bindEvents();
setStatusInputs();
loadAll().catch(err => { console.error(err); location.href = '/login'; });
