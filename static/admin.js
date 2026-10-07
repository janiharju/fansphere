// FanSphere Admin Console Client Logic

const adminState = {
  token: localStorage.getItem('fansphere_admin_token') || sessionStorage.getItem('fansphere_admin_token') || null,
  realms: [],
  ws: null,
  deleteTarget: null
};

// ==================== INITIALIZATION ====================

document.addEventListener('DOMContentLoaded', async () => {
  initIcons();
  setupEventListeners();
  setupLivePreview();
  setupWebSocket();

  // Check if existing token is valid
  if (adminState.token) {
    const isValid = await verifyAdminAuth();
    if (isValid) {
      showDashboard();
      await loadDashboardData();
    } else {
      logoutAdmin(false);
      showLogin();
    }
  } else {
    showLogin();
  }
});

function initIcons() {
  if (window.lucide) {
    window.lucide.createIcons();
  }
}

// ==================== AUTHENTICATION ====================

async function verifyAdminAuth() {
  if (!adminState.token) return false;
  try {
    const res = await fetch('/api/admin/check', {
      headers: {
        'x-admin-token': adminState.token,
        'Authorization': `Bearer ${adminState.token}`
      }
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function loginAdmin(password) {
  const errBox = document.getElementById('loginError');
  const errText = document.getElementById('loginErrorText');
  const submitBtn = document.getElementById('loginSubmitBtn');

  if (errBox) errBox.classList.add('hidden');
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<span>Verifying...</span>';
  }

  try {
    const res = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password })
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      throw new Error(data.detail || 'Incorrect administrator password');
    }

    // Success
    adminState.token = data.token;
    localStorage.setItem('fansphere_admin_token', data.token);
    sessionStorage.setItem('fansphere_admin_token', data.token);

    showToast('Admin login successful!', 'success');
    showDashboard();
    await loadDashboardData();
  } catch (err) {
    if (errBox && errText) {
      errText.textContent = err.message || 'Incorrect administrator password';
      errBox.classList.remove('hidden');
    }
    showToast(err.message || 'Login failed', 'error');
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = '<span>Authenticate & Enter</span><i data-lucide="arrow-right" class="w-4 h-4"></i>';
      initIcons();
    }
  }
}

async function logoutAdmin(notifyServer = true) {
  if (notifyServer && adminState.token) {
    try {
      await fetch('/api/admin/logout', {
        method: 'POST',
        headers: {
          'x-admin-token': adminState.token,
          'Authorization': `Bearer ${adminState.token}`
        }
      });
    } catch {}
  }

  adminState.token = null;
  localStorage.removeItem('fansphere_admin_token');
  sessionStorage.removeItem('fansphere_admin_token');

  showLogin();
  showToast('Logged out of Admin Console', 'info');
}

function showLogin() {
  document.getElementById('loginView')?.classList.remove('hidden');
  document.getElementById('dashboardView')?.classList.add('hidden');
  document.getElementById('headerLogoutBtn')?.classList.add('hidden');
  const pwdInput = document.getElementById('adminPasswordInput');
  if (pwdInput) {
    pwdInput.value = '';
    pwdInput.focus();
  }
}

function showDashboard() {
  document.getElementById('loginView')?.classList.add('hidden');
  document.getElementById('dashboardView')?.classList.remove('hidden');
  document.getElementById('headerLogoutBtn')?.classList.remove('hidden');
  initIcons();
}

// ==================== DASHBOARD DATA & REALMS ====================

async function loadDashboardData() {
  await Promise.all([
    loadRealms(),
    loadMetrics()
  ]);
}

async function loadMetrics() {
  try {
    const [postsRes, presRes] = await Promise.all([
      fetch('/api/posts').then(r => r.json()).catch(() => []),
      fetch('/api/presence').then(r => r.json()).catch(() => ({ online_count: 0 }))
    ]);

    const statPosts = document.getElementById('statPostsCount');
    if (statPosts) {
      statPosts.textContent = Array.isArray(postsRes) ? postsRes.length : 0;
    }

    const statOnline = document.getElementById('statOnlineCount');
    if (statOnline) {
      statOnline.textContent = presRes.online_count || 1;
    }
  } catch (err) {
    console.debug('Error loading admin stats', err);
  }
}

async function loadRealms() {
  const container = document.getElementById('realmsListContainer');
  try {
    const res = await fetch('/api/realms');
    if (!res.ok) throw new Error('Failed to load realms');
    const data = await res.json();
    adminState.realms = Array.isArray(data.realms) ? data.realms : [];

    const countEl = document.getElementById('statRealmsCount');
    const badgeCountEl = document.getElementById('realmsBadgeCount');
    if (countEl) countEl.textContent = adminState.realms.length;
    if (badgeCountEl) badgeCountEl.textContent = adminState.realms.length;

    renderRealmsList();
  } catch (err) {
    if (container) {
      container.innerHTML = `
        <div class="p-4 rounded-xl bg-red-950/40 border border-red-900/40 text-red-300 text-xs text-center">
          Failed to load club realms. Please refresh.
        </div>
      `;
    }
  }
}

function renderRealmsList() {
  const container = document.getElementById('realmsListContainer');
  if (!container) return;

  if (adminState.realms.length === 0) {
    container.innerHTML = `
      <div class="text-center py-8 text-slate-500 text-xs">
        No club realms configured yet. Use the form on the left to add one.
      </div>
    `;
    return;
  }

  container.innerHTML = '';

  adminState.realms.forEach(realm => {
    const card = document.createElement('div');
    card.className = 'p-3.5 sm:p-4 rounded-2xl bg-slate-950/80 border border-slate-800 hover:border-slate-700/80 transition flex items-center justify-between gap-3 shadow-sm';
    card.dataset.realmId = realm.id;

    const isOfficial = realm.name.toLowerCase().includes('arsefinland');

    card.innerHTML = `
      <div class="flex items-center gap-3 min-w-0">
        <div class="w-10 h-10 rounded-xl flex items-center justify-center text-lg shrink-0 shadow-inner" style="background-color: ${realm.badge_color || '#EF4444'}20; border: 1px solid ${realm.badge_color || '#EF4444'}40">
          <span>${escapeHtml(realm.icon || '🛡️')}</span>
        </div>
        <div class="min-w-0">
          <div class="flex items-center gap-2 flex-wrap">
            <span class="font-bold text-sm text-slate-100 truncate">${escapeHtml(realm.name)}</span>
            <span class="text-[10px] font-semibold px-2 py-0.5 rounded-md text-white shadow-xs shrink-0" style="background-color: ${realm.badge_color || '#EF4444'}">
              ${escapeHtml(realm.icon || '🛡️')} ${escapeHtml(realm.name)}
            </span>
            ${isOfficial ? '<span class="text-[9px] font-bold uppercase tracking-wider bg-red-950/80 text-red-300 border border-red-800/60 px-1.5 py-0.2 rounded shrink-0">Official Club</span>' : ''}
          </div>
          <div class="flex items-center gap-2 mt-0.5 text-[10px] text-slate-400">
            <span class="font-mono text-slate-500 truncate">ID: ${escapeHtml(realm.id)}</span>
            ${realm.description ? `<span class="hidden sm:inline text-slate-500">•</span><span class="truncate hidden sm:inline text-slate-400">${escapeHtml(realm.description)}</span>` : ''}
          </div>
        </div>
      </div>

      <div class="flex items-center gap-2 shrink-0">
        <a 
          href="/?realm=${encodeURIComponent(realm.name)}" 
          target="_blank" 
          class="text-xs text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-750 p-2 rounded-xl border border-slate-700 transition"
          title="Open this realm in FanSphere main view"
        >
          <i data-lucide="external-link" class="w-3.5 h-3.5"></i>
        </a>
        <button 
          type="button" 
          class="delete-realm-btn text-xs text-red-400 hover:text-white hover:bg-red-600 bg-red-950/40 border border-red-900/60 p-2 rounded-xl transition cursor-pointer"
          data-id="${realm.id}"
          data-name="${escapeHtml(realm.name)}"
          title="Delete this club realm"
        >
          <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
        </button>
      </div>
    `;

    container.appendChild(card);
  });

  initIcons();

  // Attach delete handlers
  container.querySelectorAll('.delete-realm-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const id = btn.getAttribute('data-id');
      const name = btn.getAttribute('data-name');
      promptDeleteRealm(id, name);
    });
  });
}

function promptDeleteRealm(id, name) {
  adminState.deleteTarget = { id, name };
  const modal = document.getElementById('deleteConfirmModal');
  const targetNameEl = document.getElementById('deleteTargetName');
  if (targetNameEl) targetNameEl.textContent = name;
  if (modal) modal.showModal();
}

async function confirmDeleteRealm() {
  if (!adminState.deleteTarget || !adminState.token) return;
  const { id, name } = adminState.deleteTarget;

  const modal = document.getElementById('deleteConfirmModal');
  const btn = document.getElementById('confirmDeleteBtn');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Deleting...';
  }

  try {
    const res = await fetch(`/api/admin/realms/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: {
        'x-admin-token': adminState.token,
        'Authorization': `Bearer ${adminState.token}`
      }
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      throw new Error(data.detail || 'Failed to delete club realm');
    }

    if (modal) modal.close();
    showToast(`Club realm "${name}" removed successfully`, 'success');
    if (data.realms) {
      adminState.realms = data.realms;
      renderRealmsList();
    } else {
      await loadRealms();
    }
  } catch (err) {
    showToast(err.message || 'Error deleting realm', 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Delete Realm';
    }
    adminState.deleteTarget = null;
  }
}

async function createRealm(e) {
  e.preventDefault();
  if (!adminState.token) {
    showToast('Admin authentication required', 'error');
    showLogin();
    return;
  }

  const nameInput = document.getElementById('realmNameInput');
  const colorInput = document.getElementById('realmColorHex');
  const iconInput = document.getElementById('realmIconInput');
  const descInput = document.getElementById('realmDescriptionInput');
  const submitBtn = document.getElementById('createRealmBtn');

  if (!nameInput) return;
  const name = nameInput.value.trim();
  const badge_color = colorInput ? colorInput.value.trim() : '#EF4444';
  const icon = iconInput ? iconInput.value.trim() : '🛡️';
  const description = descInput ? descInput.value.trim() : '';

  if (name.length < 2) {
    showToast('Realm name must be at least 2 characters', 'error');
    return;
  }

  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<span>Creating...</span>';
  }

  try {
    const res = await fetch('/api/admin/realms', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-token': adminState.token,
        'Authorization': `Bearer ${adminState.token}`
      },
      body: JSON.stringify({ name, badge_color, icon, description })
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      throw new Error(data.detail || 'Failed to create club realm');
    }

    showToast(`Club realm "${name}" created successfully!`, 'success');

    // Reset Form
    nameInput.value = '';
    if (descInput) descInput.value = '';
    if (colorInput) colorInput.value = '#EF4444';
    const picker = document.getElementById('realmColorPicker');
    if (picker) picker.value = '#EF4444';
    if (iconInput) iconInput.value = '🛡️';
    updateLivePreview();

    if (data.realms) {
      adminState.realms = data.realms;
      renderRealmsList();
    } else {
      await loadRealms();
    }
  } catch (err) {
    showToast(err.message || 'Error creating realm', 'error');
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = '<i data-lucide="plus-circle" class="w-4 h-4"></i><span>Create Club Realm</span>';
      initIcons();
    }
  }
}

// ==================== LIVE PREVIEW & FORM HELPERS ====================

function setupLivePreview() {
  const nameInput = document.getElementById('realmNameInput');
  const colorPicker = document.getElementById('realmColorPicker');
  const colorHex = document.getElementById('realmColorHex');
  const iconInput = document.getElementById('realmIconInput');

  if (nameInput) nameInput.addEventListener('input', updateLivePreview);
  if (iconInput) iconInput.addEventListener('input', updateLivePreview);

  if (colorPicker && colorHex) {
    colorPicker.addEventListener('input', (e) => {
      colorHex.value = e.target.value.toUpperCase();
      updateLivePreview();
    });
    colorHex.addEventListener('input', (e) => {
      const val = e.target.value;
      if (/^#[0-9A-Fa-f]{6}$/.test(val)) {
        colorPicker.value = val;
      }
      updateLivePreview();
    });
  }

  // Quick emoji buttons
  document.querySelectorAll('.emoji-quick-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const emoji = btn.getAttribute('data-emoji');
      if (iconInput) {
        iconInput.value = emoji;
        updateLivePreview();
      }
    });
  });

  // Quick color swatches
  document.querySelectorAll('.color-swatch-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const color = btn.getAttribute('data-color');
      if (colorHex && colorPicker) {
        colorHex.value = color;
        colorPicker.value = color;
        updateLivePreview();
      }
    });
  });

  updateLivePreview();
}

function updateLivePreview() {
  const nameInput = document.getElementById('realmNameInput');
  const colorHex = document.getElementById('realmColorHex');
  const iconInput = document.getElementById('realmIconInput');

  const previewBadge = document.getElementById('previewBadge');
  const previewIcon = document.getElementById('previewIcon');
  const previewName = document.getElementById('previewName');

  const name = nameInput && nameInput.value.trim() ? nameInput.value.trim() : 'Realm Name';
  const color = colorHex && /^#[0-9A-Fa-f]{3,6}$/.test(colorHex.value.trim()) ? colorHex.value.trim() : '#EF4444';
  const icon = iconInput && iconInput.value.trim() ? iconInput.value.trim() : '🛡️';

  if (previewBadge) previewBadge.style.backgroundColor = color;
  if (previewIcon) previewIcon.textContent = icon;
  if (previewName) previewName.textContent = name;
}

// ==================== EVENT LISTENERS ====================

function setupEventListeners() {
  // Login Form
  document.getElementById('loginForm')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const input = document.getElementById('adminPasswordInput');
    if (input) loginAdmin(input.value);
  });

  // Toggle password visibility
  document.getElementById('togglePasswordBtn')?.addEventListener('click', () => {
    const input = document.getElementById('adminPasswordInput');
    if (!input) return;
    const isPassword = input.type === 'password';
    input.type = isPassword ? 'text' : 'password';
  });

  // Header Logout
  document.getElementById('headerLogoutBtn')?.addEventListener('click', () => {
    logoutAdmin(true);
  });

  // Create Realm Form
  document.getElementById('createRealmForm')?.addEventListener('submit', createRealm);

  // Refresh Realms
  document.getElementById('refreshRealmsBtn')?.addEventListener('click', () => {
    loadRealms();
    showToast('Refreshed club realms list', 'info');
  });

  // Delete Confirmation Modal
  document.getElementById('cancelDeleteBtn')?.addEventListener('click', () => {
    document.getElementById('deleteConfirmModal')?.close();
  });
  document.getElementById('confirmDeleteBtn')?.addEventListener('click', confirmDeleteRealm);
}

// ==================== WEBSOCKET REAL-TIME SYNC ====================

function setupWebSocket() {
  try {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    adminState.ws = new WebSocket(wsUrl);

    adminState.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'realms_updated') {
          if (Array.isArray(msg.realms)) {
            adminState.realms = msg.realms;
            renderRealmsList();
          }
        } else if (msg.type === 'presence') {
          const statOnline = document.getElementById('statOnlineCount');
          if (statOnline) statOnline.textContent = msg.online_count || 1;
        } else if (msg.type === 'new_post') {
          const statPosts = document.getElementById('statPostsCount');
          if (statPosts && statPosts.textContent !== '--') {
            const current = parseInt(statPosts.textContent, 10) || 0;
            statPosts.textContent = current + 1;
          }
        }
      } catch (err) {
        console.debug('WS parse error', err);
      }
    };

    adminState.ws.onclose = () => {
      setTimeout(setupWebSocket, 4000);
    };
  } catch {}
}

// ==================== TOAST NOTIFICATIONS ====================

function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  const bg = type === 'success' 
    ? 'bg-emerald-950/90 border-emerald-700/80 text-emerald-200' 
    : type === 'error' 
      ? 'bg-red-950/90 border-red-700/80 text-red-200' 
      : 'bg-slate-900/90 border-slate-700 text-slate-200';

  const icon = type === 'success' ? '✅' : type === 'error' ? '❌' : 'ℹ️';

  toast.className = `p-3 rounded-2xl border ${bg} backdrop-blur shadow-xl text-xs flex items-center gap-2 pointer-events-auto transform transition-all duration-300 translate-y-2 opacity-0`;
  toast.innerHTML = `
    <span>${icon}</span>
    <span class="flex-1 font-medium">${escapeHtml(message)}</span>
  `;

  container.appendChild(toast);

  // Animate in
  requestAnimationFrame(() => {
    toast.classList.remove('translate-y-2', 'opacity-0');
  });

  // Remove after 3.5s
  setTimeout(() => {
    toast.classList.add('opacity-0', '-translate-y-2');
    setTimeout(() => {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    }, 300);
  }, 3500);
}

function escapeHtml(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
