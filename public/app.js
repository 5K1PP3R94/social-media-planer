const state = {
  posts: [],
  summary: null,
  activePage: 'planer',
  editingPost: null,
  currentUser: null,
  users: [],
};

const channelLabels = {
  facebook: 'FB', instagram: 'IG', linkedin: 'LI', tiktok: 'TT', website: 'WEB',
};
const statusLabels = {
  idea: 'Idee', in_progress: 'In Arbeit', planned: 'Geplant', published: 'Veröffentlicht',
};
const channelClasses = {
  facebook: 'fb', instagram: 'ig', linkedin: 'li', tiktok: 'tt', website: 'web',
};

const els = {
  shell: document.querySelector('.shell'),
  navLinks: document.querySelectorAll('.nav-link'),
  pages: document.querySelectorAll('.page'),
  plannerRows: document.getElementById('planner-rows'),
  ideaCards: document.getElementById('idea-cards'),
  overviewList: document.getElementById('overview-list'),
  messageArea: document.getElementById('message-area'),
  quickPlanSelect: document.getElementById('quick-plan-select'),
  nextSteps: document.getElementById('next-steps'),
  ideaForm: document.getElementById('idea-form'),
  quickPlanForm: document.getElementById('quick-plan-form'),
  refreshBtn: document.getElementById('refresh-btn'),
  editDialog: document.getElementById('edit-dialog'),
  editForm: document.getElementById('edit-form'),
  closeDialog: document.getElementById('close-dialog'),
  deletePostBtn: document.getElementById('delete-post'),
  statPlanner: document.getElementById('stat-planner'),
  statIdeas: document.getElementById('stat-ideas'),
  statProgress: document.getElementById('stat-progress'),
  statChannels: document.getElementById('stat-channels'),
  navPlannerCount: document.getElementById('nav-planner-count'),
  navIdeaCount: document.getElementById('nav-idea-count'),
  loginDialog: document.getElementById('login-dialog'),
  loginForm: document.getElementById('login-form'),
  accountDialog: document.getElementById('account-dialog'),
  accountBtn: document.getElementById('account-btn'),
  closeAccountDialog: document.getElementById('close-account-dialog'),
  accountChip: document.getElementById('account-chip'),
  accountSummary: document.getElementById('account-summary'),
  changePasswordForm: document.getElementById('change-password-form'),
  logoutBtn: document.getElementById('logout-btn'),
  adminSection: document.getElementById('admin-section'),
  createUserForm: document.getElementById('create-user-form'),
  userList: document.getElementById('user-list'),
};

function showMessage(text, type = 'success') {
  const div = document.createElement('div');
  div.className = `notice${type === 'error' ? ' error' : ''}`;
  div.textContent = text;
  els.messageArea.innerHTML = '';
  els.messageArea.appendChild(div);
  setTimeout(() => { if (div.parentNode) div.remove(); }, 3500);
}

function formatDate(dateStr) {
  if (!dateStr) return '—';
  const [year, month, day] = dateStr.split('-');
  return `${day}.${month}.`;
}
function weekdayShort(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(`${dateStr}T12:00:00`);
  return new Intl.DateTimeFormat('de-AT', { weekday: 'short' }).format(d);
}
function escapeHtml(value = '') {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}
function badgeMarkup(channels = []) {
  if (!channels.length) return '<span class="muted">—</span>';
  return channels.map((channel) => `<span class="badge ${channelClasses[channel]}">${channelLabels[channel]}</span>`).join('');
}
function compactChannels(channels = []) {
  return channels.length ? channels.map((channel) => channelLabels[channel]).join(' ') : '—';
}
function setActivePage(pageId) {
  state.activePage = pageId;
  els.pages.forEach((page) => page.classList.toggle('active', page.id === pageId));
  els.navLinks.forEach((link) => link.classList.toggle('active', link.dataset.page === pageId));
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    credentials: 'same-origin',
    ...options,
  });
  if (!response.ok) {
    let message = 'Ein Fehler ist aufgetreten.';
    try {
      const data = await response.json();
      message = data.error || message;
    } catch (_err) {}
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }
  if (response.status === 204) return null;
  return response.json();
}

async function requireSession() {
  try {
    const data = await api('/api/auth/me');
    state.currentUser = data.user;
    renderAccount();
    if (els.loginDialog.open) els.loginDialog.close();
    await loadData();
  } catch (error) {
    state.currentUser = null;
    renderAccount();
    els.loginDialog.showModal();
  }
}

async function loadUsers() {
  if (!state.currentUser || state.currentUser.role !== 'admin') return;
  const data = await api('/api/users');
  state.users = data.users;
  renderUsers();
}

async function loadData() {
  const [posts, summary] = await Promise.all([api('/api/posts'), api('/api/posts/summary')]);
  state.posts = posts;
  state.summary = summary;
  render();
}

function renderSummary() {
  if (!state.summary) return;
  els.statPlanner.textContent = state.summary.planner;
  els.statIdeas.textContent = state.summary.ideas;
  els.statProgress.textContent = state.summary.in_progress;
  els.statChannels.textContent = state.summary.channels;
  els.navPlannerCount.textContent = `${state.summary.planner} Posts`;
  els.navIdeaCount.textContent = `${state.summary.ideas} Ideen`;
}

function renderPlanner() {
  const plannerPosts = state.posts.filter((post) => post.location === 'planner').sort((a, b) => (a.planned_date || '').localeCompare(b.planned_date || ''));
  const header = `<div class="row-head"><div>Tag</div><div>Datum</div><div>Content</div><div>Kategorie</div><div>Art</div><div>Kanäle</div><div>Aktionen</div></div>`;
  const rows = plannerPosts.map((post) => `
    <div class="row">
      <div><span class="day-chip">${escapeHtml(weekdayShort(post.planned_date))}</span></div>
      <div>${escapeHtml(formatDate(post.planned_date))}</div>
      <div><div class="title">${escapeHtml(post.title)}</div><div class="status ${post.status}">${statusLabels[post.status]}</div></div>
      <div class="muted">${escapeHtml(post.category || '—')}</div>
      <div class="muted">${escapeHtml(post.content_type || '—')}</div>
      <div class="badges">${badgeMarkup(post.channels)}</div>
      <div class="row-actions"><button class="action-btn" data-edit-id="${post.id}">Bearbeiten</button><button class="action-btn" data-unplan-id="${post.id}">Zurück</button></div>
    </div>`).join('');
  els.plannerRows.innerHTML = header + (rows || '<div class="empty-state">Noch nichts im Planer.</div>');
  els.nextSteps.innerHTML = plannerPosts.slice(0, 4).map((post) => `<div class="mini-item"><span>${escapeHtml(formatDate(post.planned_date))} ${escapeHtml(post.title)}</span><span class="status ${post.status}">${statusLabels[post.status]}</span></div>`).join('') || '<div class="empty-state">Noch keine Termine im Planer.</div>';
}

function renderIdeas() {
  const ideas = state.posts.filter((post) => post.location === 'idea_pool');
  els.quickPlanSelect.innerHTML = ideas.length ? ideas.map((post) => `<option value="${post.id}">${escapeHtml(post.title)}</option>`).join('') : '<option value="">Keine Ideen vorhanden</option>';
  els.ideaCards.innerHTML = ideas.length ? ideas.map((post) => `
    <article class="idea-card">
      <div><h5>${escapeHtml(post.title)}</h5><p>${escapeHtml(post.description || 'Noch keine Beschreibung hinterlegt.')}</p></div>
      <div class="card-actions">
        <div class="badges"><span class="badge">${escapeHtml(post.category || 'Ohne Kategorie')}</span><span class="badge">${escapeHtml(post.content_type || 'Offen')}</span></div>
        <div class="row-actions"><button class="action-btn" data-edit-id="${post.id}">Bearbeiten</button><button class="action-btn" data-prepare-id="${post.id}">Einplanen</button></div>
      </div>
    </article>`).join('') : '<div class="empty-state">Keine Ideen im Pool. Das ist entweder sehr gut oder sehr gefährlich.</div>';
}

function renderOverview() {
  const plannerPosts = state.posts.filter((post) => post.location === 'planner').sort((a, b) => (a.planned_date || '').localeCompare(b.planned_date || ''));
  const header = `<div class="compact-row head"><div>Datum</div><div>Titel</div><div>Kategorie</div><div>Art</div><div>Kanäle</div><div>Status</div></div>`;
  const rows = plannerPosts.map((post) => `
    <div class="compact-row">
      <div class="compact-date">${escapeHtml(formatDate(post.planned_date))}</div>
      <div class="compact-name">${escapeHtml(post.title)}</div>
      <div class="muted">${escapeHtml(post.category || '—')}</div>
      <div class="muted">${escapeHtml(post.content_type || '—')}</div>
      <div class="compact-channels">${escapeHtml(compactChannels(post.channels))}</div>
      <span class="status ${post.status}">${statusLabels[post.status]}</span>
    </div>`).join('');
  els.overviewList.innerHTML = header + (rows || '<div class="empty-state">Noch keine geplanten Inhalte.</div>');
}

function renderAccount() {
  if (!state.currentUser) {
    els.accountChip.textContent = 'Nicht angemeldet';
    els.accountSummary.innerHTML = '<span>Kein aktiver Login</span>';
    els.adminSection.classList.add('hidden');
    return;
  }
  els.accountChip.textContent = `${state.currentUser.username} · ${state.currentUser.role}`;
  els.accountSummary.innerHTML = `<span>${escapeHtml(state.currentUser.username)}</span><span class="status planned">${escapeHtml(state.currentUser.role)}</span>`;
  els.adminSection.classList.toggle('hidden', state.currentUser.role !== 'admin');
}

function renderUsers() {
  if (!state.currentUser || state.currentUser.role !== 'admin') return;
  els.userList.innerHTML = state.users.map((user) => `
    <div class="mini-item account-user-row">
      <span>${escapeHtml(user.username)} <small class="muted">(${escapeHtml(user.role)})</small></span>
      <div class="row-actions">
        <button class="action-btn" data-reset-user-id="${user.id}">Passwort</button>
        ${user.id === state.currentUser.id ? '' : `<button class="action-btn" data-delete-user-id="${user.id}">Löschen</button>`}
      </div>
    </div>`).join('') || '<div class="empty-state">Keine Benutzer gefunden.</div>';
}

function render() { renderSummary(); renderPlanner(); renderIdeas(); renderOverview(); renderAccount(); }

function openEditDialog(id) {
  const post = state.posts.find((item) => item.id === Number(id));
  if (!post) return;
  state.editingPost = post;
  const form = els.editForm;
  form.id.value = post.id;
  form.title.value = post.title || '';
  form.description.value = post.description || '';
  form.category.value = post.category || '';
  form.content_type.value = post.content_type || '';
  form.status.value = post.status || 'idea';
  form.planned_date.value = post.planned_date || '';
  form.notes.value = post.notes || '';
  form.querySelectorAll('input[name="channels"]').forEach((box) => { box.checked = post.channels.includes(box.value); });
  els.editDialog.showModal();
}
function closeEditDialog() { els.editDialog.close(); state.editingPost = null; }
function collectChannels(form) { return Array.from(form.querySelectorAll('input[name="channels"]:checked')).map((el) => el.value); }

async function submitIdeaForm(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const payload = { title: form.title.value, description: form.description.value, category: form.category.value, content_type: form.content_type.value, status: 'idea', location: 'idea_pool', channels: [] };
  try { await api('/api/posts', { method: 'POST', body: JSON.stringify(payload) }); form.reset(); showMessage('Idee gespeichert.'); await loadData(); } catch (error) { showMessage(error.message, 'error'); }
}
async function submitQuickPlanForm(event) {
  event.preventDefault(); const form = event.currentTarget;
  if (!form.postId.value) return showMessage('Keine Idee ausgewählt.', 'error');
  const payload = { planned_date: form.planned_date.value, status: form.status.value, channels: collectChannels(form) };
  try { await api(`/api/posts/${form.postId.value}/plan`, { method: 'POST', body: JSON.stringify(payload) }); form.reset(); showMessage('Idee wurde in den Planer übernommen.'); setActivePage('planer'); await loadData(); } catch (error) { showMessage(error.message, 'error'); }
}
async function submitEditForm(event) {
  event.preventDefault(); const form = event.currentTarget;
  const payload = { title: form.title.value, description: form.description.value, category: form.category.value, content_type: form.content_type.value, status: form.status.value, planned_date: form.planned_date.value || null, notes: form.notes.value, channels: collectChannels(form), location: form.planned_date.value ? 'planner' : 'idea_pool' };
  try { await api(`/api/posts/${form.id.value}`, { method: 'PUT', body: JSON.stringify(payload) }); closeEditDialog(); showMessage('Post gespeichert.'); await loadData(); } catch (error) { showMessage(error.message, 'error'); }
}
async function deleteEditingPost() {
  if (!state.editingPost || !confirm(`"${state.editingPost.title}" wirklich löschen?`)) return;
  try { await api(`/api/posts/${state.editingPost.id}`, { method: 'DELETE' }); closeEditDialog(); showMessage('Post gelöscht.'); await loadData(); } catch (error) { showMessage(error.message, 'error'); }
}

async function submitLoginForm(event) {
  event.preventDefault();
  const form = event.currentTarget;
  try {
    const data = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: form.username.value, password: form.password.value }) });
    state.currentUser = data.user;
    form.reset();
    renderAccount();
    els.loginDialog.close();
    showMessage('Anmeldung erfolgreich.');
    await loadData();
    if (state.currentUser.role === 'admin') await loadUsers();
  } catch (error) {
    showMessage(error.message, 'error');
  }
}

async function submitChangePassword(event) {
  event.preventDefault();
  const form = event.currentTarget;
  try {
    await api('/api/users/change-password', { method: 'POST', body: JSON.stringify({ current_password: form.current_password.value, new_password: form.new_password.value }) });
    form.reset();
    showMessage('Passwort geändert.');
  } catch (error) { showMessage(error.message, 'error'); }
}

async function submitCreateUser(event) {
  event.preventDefault();
  const form = event.currentTarget;
  try {
    await api('/api/users', { method: 'POST', body: JSON.stringify({ username: form.username.value, password: form.password.value, role: form.role.value }) });
    form.reset();
    showMessage('Benutzer angelegt.');
    await loadUsers();
  } catch (error) { showMessage(error.message, 'error'); }
}

async function logout() {
  try { await api('/api/auth/logout', { method: 'POST', body: JSON.stringify({}) }); } catch (_error) {}
  state.currentUser = null;
  state.posts = [];
  state.summary = null;
  renderAccount();
  els.accountDialog.close();
  els.loginDialog.showModal();
}

async function handleClick(event) {
  const editId = event.target.closest('[data-edit-id]')?.dataset.editId;
  const unplanId = event.target.closest('[data-unplan-id]')?.dataset.unplanId;
  const prepareId = event.target.closest('[data-prepare-id]')?.dataset.prepareId;
  const jumpPage = event.target.closest('[data-page-jump]')?.dataset.pageJump;
  const deleteUserId = event.target.closest('[data-delete-user-id]')?.dataset.deleteUserId;
  const resetUserId = event.target.closest('[data-reset-user-id]')?.dataset.resetUserId;

  if (jumpPage) return setActivePage(jumpPage);
  if (editId) return openEditDialog(editId);
  if (unplanId) {
    try { await api(`/api/posts/${unplanId}/unplan`, { method: 'POST', body: JSON.stringify({}) }); showMessage('Post zurück in die Ideensammlung verschoben.'); await loadData(); } catch (error) { showMessage(error.message, 'error'); }
    return;
  }
  if (prepareId) { els.quickPlanSelect.value = prepareId; setActivePage('planer'); window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
  if (deleteUserId) {
    if (!confirm('Benutzer wirklich löschen?')) return;
    try { await api(`/api/users/${deleteUserId}`, { method: 'DELETE' }); showMessage('Benutzer gelöscht.'); await loadUsers(); } catch (error) { showMessage(error.message, 'error'); }
    return;
  }
  if (resetUserId) {
    const newPassword = prompt('Neues Passwort für diesen Benutzer (mind. 8 Zeichen):');
    if (!newPassword) return;
    try { await api(`/api/users/${resetUserId}/reset-password`, { method: 'POST', body: JSON.stringify({ new_password: newPassword }) }); showMessage('Passwort zurückgesetzt.'); } catch (error) { showMessage(error.message, 'error'); }
  }
}

function bindEvents() {
  els.navLinks.forEach((link) => link.addEventListener('click', (event) => { event.preventDefault(); setActivePage(link.dataset.page); }));
  document.addEventListener('click', handleClick);
  els.ideaForm.addEventListener('submit', submitIdeaForm);
  els.quickPlanForm.addEventListener('submit', submitQuickPlanForm);
  els.editForm.addEventListener('submit', submitEditForm);
  els.closeDialog.addEventListener('click', closeEditDialog);
  els.deletePostBtn.addEventListener('click', deleteEditingPost);
  els.refreshBtn.addEventListener('click', async () => { try { await loadData(); showMessage('Daten aktualisiert.'); } catch (error) { showMessage(error.message, 'error'); } });
  els.loginForm.addEventListener('submit', submitLoginForm);
  els.accountBtn.addEventListener('click', async () => { els.accountDialog.showModal(); if (state.currentUser?.role === 'admin') await loadUsers(); });
  els.closeAccountDialog.addEventListener('click', () => els.accountDialog.close());
  els.changePasswordForm.addEventListener('submit', submitChangePassword);
  els.logoutBtn.addEventListener('click', logout);
  els.createUserForm?.addEventListener('submit', submitCreateUser);
}

bindEvents();
requireSession().catch((error) => showMessage(error.message, 'error'));
