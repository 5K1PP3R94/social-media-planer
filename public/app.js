const STATUS_OPTIONS = [
  { value: 'idea', label: 'Idee' },
  { value: 'work', label: 'In Arbeit' },
  { value: 'planned', label: 'Geplant' },
  { value: 'published', label: 'Veröffentlicht' }
];
const state = {
  bootstrap: { categories: [], types: [], channels: [] },
  planner: [], ideas: [], editPlannerId: null, editIdeaId: null,
  user: null, users: [], calendarDate: new Date(), combos: {}
};
const el = (id) => document.getElementById(id);
async function api(path, opts={}) {
  const res = await fetch(path, { headers:{'Content-Type':'application/json'}, credentials:'same-origin', ...opts });
  if (res.status === 401) { location.href='/login'; return; }
  const data = await res.json().catch(()=>({}));
  if (!res.ok) throw new Error(data.error || 'Fehler');
  return data;
}
function statusLabel(status){ return STATUS_OPTIONS.find(x => x.value === status)?.label || status; }
function roleLabel(role){ return {admin:'Admin', editor:'Editor', viewer:'Viewer'}[role] || role; }
function fmtDate(iso){ if(!iso) return '—'; const d=new Date(iso); if(isNaN(d)) return iso; return d.toLocaleDateString('de-AT',{day:'2-digit',month:'2-digit'}); }
function fullDate(iso){ if(!iso) return '—'; const d=new Date(iso); if(isNaN(d)) return iso; return d.toLocaleDateString('de-AT',{weekday:'short', day:'2-digit',month:'2-digit',year:'numeric'}); }
function dayName(iso){ if(!iso) return '—'; const d=new Date(iso); if(isNaN(d)) return '—'; return ['So','Mo','Di','Mi','Do','Fr','Sa'][d.getDay()]; }
function isViewer(){ return state.user?.role === 'viewer'; }
function isAdmin(){ return state.user?.role === 'admin'; }
function showMessage(id, msg, type='ok'){ const node = el(id); if (!node) return; node.textContent = msg || ''; node.className = `inline-message ${msg ? 'show ' + type : ''}`; }
function openModal(id){ el(id).classList.remove('hidden'); }
function closeModal(id){ el(id).classList.add('hidden'); }
function escapeHtml(text=''){ return text.replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }

function renderChannelChips(containerId, prefix, selected=[]) {
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
function selectedChannels(containerId){ return [...el(containerId).querySelectorAll('input:checked')].map(i=>i.value); }

function setupCombo({ inputId, menuId, getItems, allowCreate=true, readOnly=false, onSelect=null }) {
  const input = el(inputId); const menu = el(menuId); if (!input || !menu) return;
  if (readOnly) input.readOnly = true;
  state.combos[inputId] = { input, menu, getItems, allowCreate, readOnly, onSelect };

  function renderMenu(filter='') {
    const items = getItems().filter(Boolean);
    const norm = filter.trim().toLowerCase();
    const matches = items.filter(item => item.label.toLowerCase().includes(norm));
    const exact = items.some(item => item.label.toLowerCase() === norm && norm);
    const html = [
      ...matches.map(item => `<button type="button" class="combo-option ${item.value===input.value ? 'selected' : ''}" data-value="${escapeHtml(item.value)}">${escapeHtml(item.label)}</button>`),
      ...(allowCreate && norm && !exact ? [`<button type="button" class="combo-option create" data-value="${escapeHtml(filter.trim())}">+ „${escapeHtml(filter.trim())}“ anlegen</button>`] : [])
    ].join('') || `<div class="combo-empty">Keine Treffer</div>`;
    menu.innerHTML = html;
    menu.classList.remove('hidden');
  }

  input.addEventListener('focus', () => renderMenu(input.value));
  input.addEventListener('click', () => renderMenu(input.value));
  if (!readOnly) input.addEventListener('input', () => renderMenu(input.value));
  menu.addEventListener('click', (e) => {
    const option = e.target.closest('.combo-option');
    if (!option) return;
    input.value = option.dataset.value || '';
    menu.classList.add('hidden');
    if (onSelect) onSelect(input.value);
  });
}

function refreshComboMenus(){
  Object.values(state.combos).forEach(combo => {
    if (!combo.menu.classList.contains('hidden')) {
      const evt = new Event('focus');
      combo.input.dispatchEvent(evt);
    }
  });
}

function renderOverview(summary){
  el('stat-planner').textContent = summary.stats.planner;
  el('stat-ideas').textContent = summary.stats.ideas;
  el('stat-work').textContent = summary.stats.work;
  el('stat-channels').textContent = summary.stats.channels;
  el('stat-channel-names').textContent = summary.stats.channel_names?.join(', ') || '–';
  el('overview-list').innerHTML = `<div class="compact-row head"><div>Datum</div><div>Titel</div><div>Kategorie</div><div>Art</div><div>Kanäle</div><div>Status</div></div>` +
    summary.upcoming.map(item => `<div class="compact-row"><div class="compact-date">${fmtDate(item.planned_date)}</div><div class="compact-name">${escapeHtml(item.title)}</div><div class="muted">${escapeHtml(item.category || '—')}</div><div class="muted">${escapeHtml(item.content_type || '—')}</div><div class="compact-channels">${(item.channels || []).map(escapeHtml).join(' · ') || '—'}</div><span class="status ${item.status}">${statusLabel(item.status)}</span></div>`).join('');
  el('todo-list').innerHTML = summary.todos.length ? summary.todos.map(todo => `<div class="todo-item"><div><strong>${escapeHtml(todo.text)}</strong><div class="small">${escapeHtml(todo.detail || '')}</div></div><span class="status ${todo.kind}">${statusLabel(todo.kind)}</span></div>`).join('') : `<div class="empty-state">Keine offenen To-dos. Ein seltener, fast mythischer Zustand.</div>`;
  el('open-ideas-list').innerHTML = summary.openIdeas.map(item => `<div class="todo-item"><span>${escapeHtml(item.title)}</span>${isViewer() ? '' : `<button class="btn btn-secondary" onclick="moveToPlanner(${item.id})">Einplanen</button>`}</div>`).join('');
}
function plannerActions(item){
  if (isViewer()) return '<span class="small">Nur lesen</span>';
  return `<div class="badges"><button class="icon-btn" onclick="editPlanner(${item.id})">Bearbeiten</button><button class="icon-btn" onclick="moveToIdeas(${item.id})">Zurück zu Ideen</button><button class="icon-btn" onclick="deletePost(${item.id})">Löschen</button></div>`;
}
function renderPlanner(){
  el('planner-rows').innerHTML = state.planner.map(item => `<div class="row"><div><span class="day-chip">${dayName(item.planned_date)}</span></div><div>${fmtDate(item.planned_date)}</div><div class="title">${escapeHtml(item.title)}</div><div class="muted">${escapeHtml(item.category || '—')}</div><div class="muted">${escapeHtml(item.content_type || '—')}</div><div class="badges">${(item.channels || []).map(ch=>`<span class="badge">${escapeHtml(ch)}</span>`).join('')}</div><div><span class="status ${item.status}">${statusLabel(item.status)}</span></div><div>${plannerActions(item)}</div></div>`).join('');
}
function renderIdeas(){
  el('idea-cards').innerHTML = state.ideas.map(item => `<article class="idea-card" draggable="${!isViewer()}" data-idea-id="${item.id}"><div><h5>${escapeHtml(item.title)}</h5><p>${escapeHtml(item.notes || 'Noch keine Notizen.')}</p></div><div class="card-actions"><div class="badges"><span class="badge">${escapeHtml(item.category || 'Ohne Kategorie')}</span><span class="badge">${escapeHtml(item.content_type || 'Ohne Art')}</span></div><div class="badges">${isViewer() ? '<span class="small">Nur lesen</span>' : `<button class="icon-btn" onclick="editIdea(${item.id})">Bearbeiten</button><button class="btn btn-primary" onclick="moveToPlanner(${item.id})">In Planer</button>`}</div></div></article>`).join('');
  document.querySelectorAll('.idea-card[draggable="true"]').forEach(card => {
    card.addEventListener('dragstart', e => e.dataTransfer.setData('text/plain', card.dataset.ideaId));
  });
}
function applyRoleUi(){
  const viewer = isViewer();
  document.querySelectorAll('.editor-only').forEach(node => node.classList.toggle('hidden', viewer));
  el('planner-viewer-lock')?.classList.toggle('hidden', !viewer);
  el('ideas-viewer-lock')?.classList.toggle('hidden', !viewer);
  document.querySelectorAll('.admin-only').forEach(node => node.classList.toggle('hidden', !isAdmin()));
}

function setStatusInputs(){
  if (!el('planner-status').value) el('planner-status').value = 'Idee';
  if (!el('idea-status').value) el('idea-status').value = 'Idee';
}
function statusValueFromInput(id){
  const label = el(id).value;
  return STATUS_OPTIONS.find(x => x.label === label)?.value || 'idea';
}
function setStatusByValue(id, value){ el(id).value = statusLabel(value); }

function renderChannelAdminList(){
  const wrap = el('channel-admin-list'); if (!wrap) return;
  wrap.innerHTML = state.bootstrap.channels.map(ch => `<div class="channel-admin-item"><span>${escapeHtml(ch)}</span>${isViewer() ? '' : `<button class="icon-btn danger-btn" onclick="removeChannel('${escapeHtml(ch)}')">Löschen</button>`}</div>`).join('');
}

function renderCalendar(){
  const grid = el('calendar-grid');
  const current = new Date(state.calendarDate.getFullYear(), state.calendarDate.getMonth(), 1);
  const monthName = current.toLocaleDateString('de-AT', { month:'long', year:'numeric' });
  el('calendar-title').textContent = monthName.charAt(0).toUpperCase() + monthName.slice(1);
  const firstWeekday = (current.getDay() + 6) % 7;
  const daysInMonth = new Date(current.getFullYear(), current.getMonth()+1, 0).getDate();
  const prevDays = new Date(current.getFullYear(), current.getMonth(), 0).getDate();
  const itemsByDay = {};
  state.planner.forEach(item => {
    if (!item.planned_date) return;
    const d = new Date(item.planned_date);
    if (d.getFullYear() === current.getFullYear() && d.getMonth() === current.getMonth()) {
      const key = d.getDate();
      itemsByDay[key] = itemsByDay[key] || [];
      itemsByDay[key].push(item);
    }
  });
  const cells = [];
  for (let i = 0; i < firstWeekday; i++) {
    cells.push(`<div class="calendar-cell muted-day"><div class="calendar-date">${prevDays - firstWeekday + i + 1}</div></div>`);
  }
  for (let day = 1; day <= daysInMonth; day++) {
    const items = itemsByDay[day] || [];
    const today = new Date();
    const isToday = today.getFullYear()===current.getFullYear() && today.getMonth()===current.getMonth() && today.getDate()===day;
    cells.push(`<div class="calendar-cell ${isToday ? 'today' : ''}" data-date="${current.toISOString().slice(0,7)}-${String(day).padStart(2,'0')}">
      <div class="calendar-date">${day}</div>
      <div class="calendar-items">${items.slice(0,3).map(item => `<button class="calendar-item ${item.status}" onclick="editPlanner(${item.id})">${escapeHtml(item.title)}</button>`).join('')}${items.length > 3 ? `<div class="calendar-more">+${items.length - 3} mehr</div>` : ''}</div>
    </div>`);
  }
  while (cells.length % 7 !== 0) cells.push(`<div class="calendar-cell muted-day"></div>`);
  grid.innerHTML = cells.join('');
  grid.querySelectorAll('.calendar-cell').forEach(cell => {
    cell.addEventListener('dragover', e => { if (!isViewer()) { e.preventDefault(); cell.classList.add('dragover'); } });
    cell.addEventListener('dragleave', () => cell.classList.remove('dragover'));
    cell.addEventListener('drop', async e => {
      if (isViewer()) return;
      e.preventDefault(); cell.classList.remove('dragover');
      const id = Number(e.dataTransfer.getData('text/plain')); const date = cell.dataset.date;
      if (!id || !date) return;
      await moveToPlanner(id, date);
    });
  });
}

async function loadAll(){
  const me = await api('/api/me');
  state.user = me.user;
  el('user-pill').textContent = state.user ? `${state.user.username} · ${roleLabel(state.user.role)}` : '';
  applyRoleUi();
  state.bootstrap = await api('/api/bootstrap');
  state.planner = await api('/api/posts?location=planner');
  state.ideas = await api('/api/posts?location=ideas');
  renderChannelChips('planner-channels','planner');
  renderChannelChips('idea-channels','idea');
  renderChannelAdminList();
  renderPlanner();
  renderIdeas();
  renderCalendar();
  refreshComboMenus();
  const summary = await api('/api/summary');
  renderOverview(summary);
  if (isAdmin()) await loadUsers();
}
function resetPlannerForm(){ state.editPlannerId = null; el('planner-title').value=''; el('planner-date').value=''; el('planner-category').value=''; el('planner-type').value=''; el('planner-notes').value=''; setStatusByValue('planner-status','idea'); renderChannelChips('planner-channels','planner'); }
function resetIdeaForm(){ state.editIdeaId = null; el('idea-title').value=''; el('idea-category').value=''; el('idea-type').value=''; el('idea-notes').value=''; setStatusByValue('idea-status','idea'); renderChannelChips('idea-channels','idea'); }
async function savePlanner(){
  const payload = { title: el('planner-title').value.trim(), planned_date: el('planner-date').value || null, category: el('planner-category').value.trim(), content_type: el('planner-type').value.trim(), notes: el('planner-notes').value.trim(), status: statusValueFromInput('planner-status'), channels: selectedChannels('planner-channels'), location:'planner' };
  if (!payload.title) return alert('Titel fehlt');
  if (state.editPlannerId) await api(`/api/posts/${state.editPlannerId}`, {method:'PUT', body: JSON.stringify(payload)}); else await api('/api/posts', {method:'POST', body: JSON.stringify(payload)});
  resetPlannerForm(); await loadAll();
}
async function saveIdea(){
  const payload = { title: el('idea-title').value.trim(), planned_date: null, category: el('idea-category').value.trim(), content_type: el('idea-type').value.trim(), notes: el('idea-notes').value.trim(), status: statusValueFromInput('idea-status'), channels: selectedChannels('idea-channels'), location:'ideas' };
  if (!payload.title) return alert('Titel fehlt');
  if (state.editIdeaId) await api(`/api/posts/${state.editIdeaId}`, {method:'PUT', body: JSON.stringify(payload)}); else await api('/api/posts', {method:'POST', body: JSON.stringify(payload)});
  resetIdeaForm(); await loadAll();
}
window.editPlanner = function(id){ const item = state.planner.find(x=>x.id===id); if(!item) return; state.editPlannerId = id; el('planner-title').value=item.title; el('planner-date').value=item.planned_date || ''; el('planner-category').value=item.category||''; el('planner-type').value=item.content_type||''; el('planner-notes').value=item.notes||''; setStatusByValue('planner-status',item.status); renderChannelChips('planner-channels','planner',item.channels||[]); activate('planner'); window.scrollTo({top:0, behavior:'smooth'}); };
window.editIdea = function(id){ const item = state.ideas.find(x=>x.id===id); if(!item) return; state.editIdeaId = id; el('idea-title').value=item.title; el('idea-category').value=item.category||''; el('idea-type').value=item.content_type||''; el('idea-notes').value=item.notes||''; setStatusByValue('idea-status',item.status); renderChannelChips('idea-channels','idea',item.channels||[]); activate('ideas'); window.scrollTo({top:0, behavior:'smooth'}); };
window.moveToPlanner = async function(id, forcedDate=null){ const item = [...state.ideas, ...state.planner].find(x=>x.id===id); if(!item) return; const payload = {...item, location:'planner', planned_date: forcedDate || item.planned_date || new Date().toISOString().slice(0,10)}; await api(`/api/posts/${id}`, {method:'PUT', body: JSON.stringify(payload)}); await loadAll(); activate('planner'); };
window.moveToIdeas = async function(id){ const item = state.planner.find(x=>x.id===id); if(!item) return; const payload = {...item, location:'ideas', planned_date: null, status:'idea'}; await api(`/api/posts/${id}`, {method:'PUT', body: JSON.stringify(payload)}); await loadAll(); activate('ideas'); };
window.deletePost = async function(id){ if(!confirm('Beitrag wirklich löschen?')) return; await api(`/api/posts/${id}`, {method:'DELETE'}); await loadAll(); };
window.removeChannel = async function(name){ if(!confirm(`Kanal ${name} wirklich löschen?`)) return; await api(`/api/channels/${encodeURIComponent(name)}`, { method:'DELETE' }); await loadAll(); };
async function loadUsers(){
  state.users = await api('/api/users');
  const list = el('users-list');
  list.innerHTML = state.users.map(user => `
    <div class="user-row">
      <div>
        <div class="user-name-row"><strong>${escapeHtml(user.username)}</strong><span class="status ${user.is_active ? 'planned' : 'idea'}">${user.is_active ? 'Aktiv' : 'Inaktiv'}</span></div>
        <div class="small">${roleLabel(user.role)} · erstellt ${new Date(user.created_at).toLocaleDateString('de-AT')}</div>
      </div>
      <div class="user-controls">
        <select class="select compact-select" onchange="changeUserRole(${user.id}, this.value, ${user.is_active ? 'true' : 'false'})">
          <option value="admin" ${user.role === 'admin' ? 'selected' : ''}>Admin</option>
          <option value="editor" ${user.role === 'editor' ? 'selected' : ''}>Editor</option>
          <option value="viewer" ${user.role === 'viewer' ? 'selected' : ''}>Viewer</option>
        </select>
        <label class="switch"><input type="checkbox" ${user.is_active ? 'checked' : ''} onchange="toggleUserActive(${user.id}, '${user.role}', this.checked)"><span>Aktiv</span></label>
        <button class="icon-btn" onclick="resetUserPassword(${user.id}, '${escapeHtml(user.username)}')">Passwort reset</button>
        <button class="icon-btn danger-btn" onclick="removeUser(${user.id}, '${escapeHtml(user.username)}')">Löschen</button>
      </div>
    </div>
  `).join('');
}
window.changeUserRole = async function(userId, role, isActive){ try { await api(`/api/users/${userId}`, {method:'PUT', body: JSON.stringify({role, is_active: isActive})}); await loadUsers(); } catch(err){ alert(err.message); await loadUsers(); } };
window.toggleUserActive = async function(userId, role, checked){ try { await api(`/api/users/${userId}`, {method:'PUT', body: JSON.stringify({role, is_active: checked})}); await loadUsers(); } catch(err){ alert(err.message); await loadUsers(); } };
window.resetUserPassword = async function(userId, username){ const pw = prompt(`Neues Passwort für ${username}:`); if(!pw) return; try { await api(`/api/users/${userId}/reset-password`, {method:'POST', body: JSON.stringify({new_password: pw})}); alert('Passwort zurückgesetzt.'); } catch(err){ alert(err.message); } };
window.removeUser = async function(userId, username){ if(!confirm(`Benutzer ${username} wirklich löschen?`)) return; try { await api(`/api/users/${userId}`, {method:'DELETE'}); await loadUsers(); } catch(err){ alert(err.message); } };
function activate(pageId){ document.querySelectorAll('.page').forEach(p=>p.classList.toggle('active', p.id===pageId)); document.querySelectorAll('.nav-link').forEach(a=>a.classList.toggle('active', a.dataset.page===pageId)); }

document.addEventListener('click', e => {
  document.querySelectorAll('.combo-menu').forEach(menu => {
    if (!menu.parentElement.contains(e.target)) menu.classList.add('hidden');
  });
});
document.querySelectorAll('.nav-link').forEach(a=>a.addEventListener('click', e=>{ e.preventDefault(); activate(a.dataset.page); }));
document.querySelectorAll('[data-close]').forEach(btn => btn.addEventListener('click', () => closeModal(btn.dataset.close)));
document.querySelectorAll('.modal-backdrop').forEach(bg => bg.addEventListener('click', (e) => { if (e.target === bg) bg.classList.add('hidden'); }));
el('planner-save').addEventListener('click', savePlanner); el('idea-save').addEventListener('click', saveIdea); el('planner-reset').addEventListener('click', resetPlannerForm); el('idea-reset').addEventListener('click', resetIdeaForm);
el('logout-btn').addEventListener('click', async()=>{ await api('/api/logout',{method:'POST'}); location.href='/login'; });
el('change-password-btn').addEventListener('click', () => { showMessage('pw-message', ''); el('pw-current').value=''; el('pw-new').value=''; el('pw-new-2').value=''; openModal('password-modal'); });
el('manage-users-btn').addEventListener('click', async() => { await loadUsers(); openModal('users-modal'); });
el('pw-save').addEventListener('click', async() => {
  const current = el('pw-current').value;
  const next = el('pw-new').value;
  const repeat = el('pw-new-2').value;
  if (next !== repeat) { showMessage('pw-message', 'Die neuen Passwörter stimmen nicht überein', 'error'); return; }
  try { await api('/api/account/password', {method:'POST', body: JSON.stringify({current_password: current, new_password: next})}); showMessage('pw-message', 'Passwort erfolgreich geändert', 'success'); setTimeout(() => closeModal('password-modal'), 900); } catch(err){ showMessage('pw-message', err.message, 'error'); }
});
el('create-user-btn').addEventListener('click', async() => {
  try {
    await api('/api/users', {method:'POST', body: JSON.stringify({username: el('new-username').value.trim(), password: el('new-password').value, role: el('new-role').value})});
    el('new-username').value=''; el('new-password').value=''; el('new-role').value='editor';
    showMessage('users-create-message', 'Benutzer angelegt', 'success');
    await loadUsers();
  } catch(err){ showMessage('users-create-message', err.message, 'error'); }
});
el('add-channel-btn').addEventListener('click', async () => {
  const name = el('new-channel-name').value.trim();
  if (!name) return;
  try {
    await api('/api/channels', { method:'POST', body: JSON.stringify({ name }) });
    el('new-channel-name').value = '';
    await loadAll();
  } catch(err) { alert(err.message); }
});
el('calendar-prev').addEventListener('click', () => { state.calendarDate = new Date(state.calendarDate.getFullYear(), state.calendarDate.getMonth()-1, 1); renderCalendar(); });
el('calendar-next').addEventListener('click', () => { state.calendarDate = new Date(state.calendarDate.getFullYear(), state.calendarDate.getMonth()+1, 1); renderCalendar(); });

setupCombo({ inputId:'planner-category', menuId:'planner-category-menu', getItems:() => state.bootstrap.categories.map(v => ({value:v,label:v})) });
setupCombo({ inputId:'planner-type', menuId:'planner-type-menu', getItems:() => state.bootstrap.types.map(v => ({value:v,label:v})) });
setupCombo({ inputId:'idea-category', menuId:'idea-category-menu', getItems:() => state.bootstrap.categories.map(v => ({value:v,label:v})) });
setupCombo({ inputId:'idea-type', menuId:'idea-type-menu', getItems:() => state.bootstrap.types.map(v => ({value:v,label:v})) });
setupCombo({ inputId:'planner-status', menuId:'planner-status-menu', getItems:() => STATUS_OPTIONS.map(x => ({value:x.label,label:x.label})), allowCreate:false, readOnly:true });
setupCombo({ inputId:'idea-status', menuId:'idea-status-menu', getItems:() => STATUS_OPTIONS.filter(x => x.value !== 'published').map(x => ({value:x.label,label:x.label})), allowCreate:false, readOnly:true });
setStatusInputs();
loadAll().catch(err=>{ console.error(err); location.href='/login'; });
