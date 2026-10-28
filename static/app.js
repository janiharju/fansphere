// Fansphere - Real-time Sports Fan Community Client

let currentRealms = [];

function normalizeFlair(flair) {
  if (!flair) return 'Neutral Football Fan';
  const str = String(flair).trim().toLowerCase();
  if (str.includes('tester')) return 'Testers';
  if (str.includes('neutral')) return 'Neutral Football Fan';
  if (str.includes('arsenal finland') || str.includes('gunner') || str.includes('gooner') || str.includes('arsenal') || str.includes('official')) {
    return 'Arsenal Finland Official Member';
  }
  if (Array.isArray(currentRealms)) {
    const matched = currentRealms.find(r => r.name.toLowerCase() === str || r.id === str);
    if (matched) return matched.name;
  }
  return 'Arsenal Finland Official Member';
}

function getFlairBadgeColor(flair) {
  const norm = normalizeFlair(flair);
  if (norm === 'Testers') return '#A855F7';
  if (norm === 'Neutral Football Fan') return '#94A3B8';
  if (norm === 'Arsenal Finland Official Member') return '#EF4444';
  if (Array.isArray(currentRealms)) {
    const matched = currentRealms.find(r => r.name === norm || r.id === norm);
    if (matched && matched.badge_color) return matched.badge_color;
  }
  return '#EF4444';
}

// State
const state = {
  sessionId: localStorage.getItem('fansphere_session_id') || null,
  session: null,
  user: {
    handle: localStorage.getItem('fansphere_handle') || '',
    email: localStorage.getItem('fansphere_email') || '',
    flair: normalizeFlair(localStorage.getItem('fansphere_flair')),
    badgeColor: getFlairBadgeColor(localStorage.getItem('fansphere_flair'))
  },
  soundEnabled: localStorage.getItem('fansphere_sound') !== 'false',
  currentSort: 'new',
  currentTag: 'All',
  searchQuery: '',
  selectedRealm: localStorage.getItem('fansphere_realm') || null,
  currentPage: 1,
  postsPerPage: 3,
  userVotes: JSON.parse(localStorage.getItem('fansphere_votes') || '{}'),
  activePostDetailId: null,
  ws: null,
  lastWsAuthSessionId: null,
  wsPingInterval: null,
  posts: [],
  realms: [],
  allChatMessages: [],
  renderedChatIds: new Set(),
  activeNicknames: [],
  activeUsers: [],
  lastRenderedPagination: {},
  lastRenderedPostIds: [],
  userReadStates: {}
};

// ==================== USER READ STATES (ISOLATED PER USER) ====================

function getUserReadStorageKey() {
  const email = (state.user?.email || '').trim().toLowerCase();
  const handle = (state.user?.handle || '').trim().toLowerCase();
  return email || handle || 'guest';
}

function loadLocalReadStates() {
  try {
    const key = `fansphere_read_states_${getUserReadStorageKey()}`;
    const raw = localStorage.getItem(key);
    state.userReadStates = raw ? JSON.parse(raw) : {};
  } catch {
    state.userReadStates = {};
  }
}

function saveLocalReadStates() {
  try {
    const key = `fansphere_read_states_${getUserReadStorageKey()}`;
    localStorage.setItem(key, JSON.stringify(state.userReadStates || {}));
  } catch {}
}

async function syncUserReadStatesFromServer() {
  if (!state.sessionId && !state.user?.email && !state.user?.handle) return;
  try {
    const headers = {};
    if (state.sessionId) headers['x-session-id'] = state.sessionId;
    if (state.user?.email) headers['x-user-email'] = state.user.email;
    if (state.user?.handle) headers['x-user-nickname'] = state.user.handle;

    const res = await fetch('/api/posts-read-states', { headers });
    if (res.ok) {
      const data = await res.json();
      if (data && data.read_states && typeof data.read_states === 'object') {
        state.userReadStates = {
          ...data.read_states,
          ...(state.userReadStates || {})
        };
        saveLocalReadStates();
      }
    }
  } catch {}
}

function markPostAsReadLocally(postId, commentCount) {
  const numId = Number(postId);
  const strId = String(postId);

  const post = (state.posts || []).find(p => Number(p.id) === numId);
  const currentCount = (commentCount !== undefined) 
    ? Number(commentCount) 
    : (post ? (Number(post.comment_count) || 0) : 0);

  if (post) {
    post.is_unread = false;
    post.unread_comments_count = 0;
  }

  if (!state.userReadStates) state.userReadStates = {};
  state.userReadStates[strId] = {
    last_read_at: new Date().toISOString(),
    comment_count: currentCount
  };
  saveLocalReadStates();

  // Update card in DOM if visible
  const card = document.querySelector(`.post-card[data-post-id="${postId}"]`);
  if (card) {
    const unreadBadge = card.querySelector('.thread-unread-badge');
    if (unreadBadge) unreadBadge.remove();

    const newCountBadge = card.querySelector('.thread-new-count');
    if (newCountBadge) newCountBadge.remove();

    card.classList.remove('border-l-4', 'border-l-red-500', 'border-l-amber-500');
  }

  // Notify backend
  const headers = {};
  if (state.sessionId) headers['x-session-id'] = state.sessionId;
  if (state.user?.email) headers['x-user-email'] = state.user.email;
  if (state.user?.handle) headers['x-user-nickname'] = state.user.handle;

  fetch(`/api/posts/${postId}/read`, {
    method: 'POST',
    headers
  }).catch(() => {});
}

loadLocalReadStates();

// ==================== REALM & CLUB TAG FILTERING HELPERS ====================

function getEffectiveRealm() {
  if (state.selectedRealm === 'user_club') {
    return state.user.flair || 'Arsenal Finland Official Member';
  }
  return state.selectedRealm;
}

function getRealmDisplayName(realm) {
  if (realm === 'user_club') {
    return `My Club (${getRealmDisplayName(state.user.flair || 'Arsenal Finland Official Member')})`;
  }
  const norm = normalizeFlair(realm);
  if (norm === 'Arsenal Finland Official Member') return 'Arsenal Finland Official Member';
  if (norm === 'Neutral Football Fan') return 'Neutral Football Fan';
  if (norm === 'Testers') return 'Testers';
  return realm;
}

function matchClubRealm(authorFlair, targetRealm) {
  if (!targetRealm || targetRealm === 'All' || targetRealm === 'all') return true;
  if (!authorFlair) return false;

  const a = authorFlair.trim().toLowerCase();
  const effective = (targetRealm === 'user_club' ? (state.user.flair || 'Arsenal Finland Official Member') : targetRealm).trim().toLowerCase();
  if (a === effective) return true;

  // Testers realm
  if (effective.includes('tester')) {
    return a.includes('tester');
  }

  // Neutral Football Fan realm
  if (effective.includes('neutral')) {
    return a.includes('neutral');
  }

  // Arsenal Finland official club realm
  const arsenalFinlandVariants = ['arsenal finland', 'arsenal', 'gunner', 'gooner', 'official', 'member'];
  if (arsenalFinlandVariants.some(v => effective.includes(v))) {
    return arsenalFinlandVariants.some(v => a.includes(v));
  }

  // Dynamic registered realms matching
  if (Array.isArray(state.realms)) {
    const dynamicRealm = state.realms.find(r => r.name.toLowerCase() === effective || r.id.toLowerCase() === effective);
    if (dynamicRealm) {
      const dynName = dynamicRealm.name.toLowerCase();
      const dynId = dynamicRealm.id.toLowerCase();
      return a === dynName || a === dynId || a.includes(dynName) || dynName.includes(a);
    }
  }

  return a.includes(effective) || effective.includes(a);
}

function updateRealmIndicators() {
  const flairInput = document.getElementById('profileFlairInput');
  if (flairInput) {
    flairInput.value = normalizeFlair(state.user.flair);
  }
}

// Session & Realm Gate: Enforce that page contents are only visible if there is both an active session and a selected realm
function hasActiveSessionAndRealm() {
  const hasSession = !!(state.sessionId && state.session);
  const realm = (state.selectedRealm || (state.session && state.session.flair) || '').trim();
  const hasRealm = !!(realm && realm.length > 0 && realm !== 'undefined' && realm !== 'null');
  return hasSession && hasRealm;
}

function updateGateState() {
  const isAuthed = hasActiveSessionAndRealm();
  const mainApp = document.getElementById('mainAppContent');
  const gateView = document.getElementById('sessionGateView');
  const mobileNav = document.getElementById('mobileNavTabs');
  const navUserControls = document.getElementById('navUserControls') || document.getElementById('openProfileModalBtn');
  const modal = document.getElementById('sessionPromptModal');

  if (isAuthed) {
    if (mainApp) mainApp.classList.remove('hidden');
    if (mobileNav) mobileNav.classList.remove('hidden');
    if (navUserControls) navUserControls.classList.remove('hidden');
    if (gateView) gateView.classList.add('hidden');
    if (modal && modal.open) modal.close();
    setTimeout(() => {
      if (state.posts && state.posts.length > 0) renderPosts();
    }, 50);
  } else {
    if (mainApp) mainApp.classList.add('hidden');
    if (mobileNav) mobileNav.classList.add('hidden');
    if (navUserControls) navUserControls.classList.add('hidden');
    if (gateView) gateView.classList.remove('hidden');

    const postModal = document.getElementById('postDetailModal');
    const createModal = document.getElementById('createPostModal');
    const profileModal = document.getElementById('userProfileModal');
    if (postModal && postModal.open) postModal.close();
    if (createModal && createModal.open) createModal.close();
    if (profileModal && profileModal.open) profileModal.close();

    // Pre-fill previous values from local storage if available
    const gateNick = document.getElementById('gateNicknameInput');
    const gateEmail = document.getElementById('gateEmailInput');
    const gateRealm = document.getElementById('gateRealmInput');
    if (gateNick && !gateNick.value) gateNick.value = localStorage.getItem('fansphere_handle') || '';
    if (gateEmail && !gateEmail.value) gateEmail.value = localStorage.getItem('fansphere_email') || '';
    if (gateRealm && (!gateRealm.value || gateRealm.value === '')) {
      const savedRealm = localStorage.getItem('fansphere_realm') || localStorage.getItem('fansphere_flair');
      if (savedRealm && savedRealm !== 'All') {
        gateRealm.value = savedRealm;
      }
    }
  }
}

function setRealmFilter(realm) {
  state.selectedRealm = realm;
  if (realm !== 'All') {
    state.user.flair = realm;
    localStorage.setItem('fansphere_flair', realm);
  }
  localStorage.setItem('fansphere_realm', realm);
  updateRealmIndicators();
  updateGateState();
  state.currentPage = 1;
  const postsContainer = document.getElementById('postsList');
  if (postsContainer) {
    postsContainer.dataset.lastRenderKey = '';
  }
  state.renderedChatIds.clear();
  loadPosts();
  renderChatStream();
}

async function loadRealms() {
  try {
    const res = await fetch('/api/realms');
    if (!res.ok) return;
    const data = await res.json();
    if (Array.isArray(data.realms) && data.realms.length > 0) {
      currentRealms = data.realms;
      state.realms = data.realms;
      updateRealmSelectDropdowns();
    }
  } catch (err) {
    console.debug('Error loading club realms', err);
  }
}

function updateRealmSelectDropdowns() {
  if (!Array.isArray(state.realms) || state.realms.length === 0) return;

  const profileSelect = document.getElementById('profileFlairInput');
  if (profileSelect) {
    const currentVal = profileSelect.value || state.selectedRealm;
    profileSelect.innerHTML = `
      ${state.realms.map(r => `
        <option value="${escapeHtml(r.name)}">${escapeHtml(r.icon || '🛡️')} ${escapeHtml(r.name)}</option>
      `).join('')}
    `;
    profileSelect.value = (state.selectedRealm === 'All') ? 'All' : normalizeFlair(state.user.flair);
  }

  const sessionSelect = document.getElementById('sessionFlairInput');
  if (sessionSelect) {
    const currentSessionVal = sessionSelect.value || normalizeFlair(state.user.flair);
    sessionSelect.innerHTML = state.realms.map(r => `
      <option value="${escapeHtml(r.name)}">${escapeHtml(r.icon || '🛡️')} ${escapeHtml(r.name)}</option>
    `).join('');
    if (currentSessionVal) sessionSelect.value = currentSessionVal;
  }

  const gateSelect = document.getElementById('gateRealmInput');
  if (gateSelect) {
    const currentGateVal = gateSelect.value;
    gateSelect.innerHTML = `
      <option value="" disabled ${!currentGateVal ? 'selected' : ''}>Select your Club Realm...</option>
      ${state.realms.map(r => `
        <option value="${escapeHtml(r.name)}" ${currentGateVal === r.name ? 'selected' : ''}>${escapeHtml(r.icon || '🛡️')} ${escapeHtml(r.name)}</option>
      `).join('')}
    `;
  }
}

// ==================== INITIALIZATION ====================

document.addEventListener('DOMContentLoaded', async () => {
  initUserProfile();
  initLucide();
  initModalLightDismiss();
  initMobileTabs();
  initOnlineFansPopup();
  initSessionAutoRefresh();
  initEventHandlers();
  initChatMentions();
  initNotifications();
  loadPresence();
  initPWA();

  // Immediately enforce gate: hide page contents until verified active session & selected realm
  updateGateState();

  // Always load club realms first so gate dropdown has the dynamic realms ready
  await loadRealms();

  // Check or initialize fan session (reuses if valid, prompts if new or expired)
  const isSessionValid = await checkSession();

  if (isSessionValid && hasActiveSessionAndRealm()) {
    // Only load and render community posts and chat when verified active session and selected realm
    loadCachedData();
    connectWebSocket();
    await Promise.all([
      loadPosts(),
      loadChatHistory()
    ]);
    
    // Periodic check for WebSocket health and resync if needed
    setInterval(() => {
      if (!state.ws || state.ws.readyState !== WebSocket.OPEN) {
        console.log('WS unhealthy, resyncing chat history...');
        loadChatHistory();
        if (!state.ws || state.ws.readyState === WebSocket.CLOSED) {
          connectWebSocket();
        }
      }
    }, 60000); // 60 seconds
  } else {
    // Ensure gate is displayed and page contents stay strictly hidden
    updateGateState();
  }
});

function loadCachedData() {
  try {
    const cachedPosts = localStorage.getItem('fansphere_cached_posts');
    if (cachedPosts) {
      const parsed = JSON.parse(cachedPosts);
      if (Array.isArray(parsed) && parsed.length > 0) {
        state.posts = sortPostsByLatestActivity(parsed);
        renderPosts();
      }
    }

    const cachedChat = localStorage.getItem('fansphere_cached_chat');
    if (cachedChat) {
      const parsedChat = JSON.parse(cachedChat);
      if (Array.isArray(parsedChat) && parsedChat.length > 0) {
        state.allChatMessages = parsedChat;
        renderChatStream();
      }
    }
  } catch (e) {
    console.debug('Cache load error', e);
  }
}

function initLucide() {
  if (window.lucide) {
    window.lucide.createIcons();
  }
}

// Web Audio API chime (synthesized zero-dependency sound)
let audioCtx = null;

function playChime(freq = 587.33, duration = 0.12) {
  if (!state.soundEnabled) return;
  try {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
    gain.gain.setValueAtTime(0.04, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + duration);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + duration);
  } catch (e) {
    console.debug('Audio error', e);
  }
}

// Light dismiss fallback for dialogs (from Modern Web Guidance)
function initModalLightDismiss() {
  const dialogs = document.querySelectorAll('dialog');
  dialogs.forEach(dialog => {
    // Prevent Escape key from closing session modal if not authenticated
    if (dialog.id === 'sessionPromptModal') {
      dialog.addEventListener('cancel', (e) => {
        if (!hasActiveSessionAndRealm()) {
          e.preventDefault();
        }
      });
    }
    if (!('closedBy' in HTMLDialogElement.prototype)) {
      dialog.addEventListener('click', (event) => {
        if (event.target !== dialog) return;
        // Never allow clicking outside to dismiss sessionPromptModal when not authenticated
        if (dialog.id === 'sessionPromptModal' && !hasActiveSessionAndRealm()) {
          return;
        }
        const rect = dialog.getBoundingClientRect();
        const isDialogContent = (
          rect.top <= event.clientY &&
          event.clientY <= rect.top + rect.height &&
          rect.left <= event.clientX &&
          event.clientX <= rect.left + rect.width
        );
        if (isDialogContent) return;
        dialog.close();
      });
    }
  });
}

// User Profile & Session UI
function initUserProfile(force = false) {
  const handleEl = document.getElementById('navUsername');
  const inputHandle = document.getElementById('profileHandleInput');
  const inputEmail = document.getElementById('profileEmailInput');
  const inputFlair = document.getElementById('profileFlairInput');
  const sessionIdDisplay = document.getElementById('profileSessionIdDisplay');
  const profileModal = document.getElementById('userProfileModal');

  const currentNickname = state.user.handle || 'Guest Fan';
  if (handleEl) handleEl.textContent = currentNickname;

  // Normalize user flair to ensure only allowed supporter flairs are used
  state.user.flair = normalizeFlair(state.user.flair);
  state.user.badgeColor = getFlairBadgeColor(state.user.flair);
  localStorage.setItem('fansphere_flair', state.user.flair);

  // CRITICAL: NEVER overwrite inputs if the modal is currently open, unless explicitly forced on opening
  const isModalOpen = profileModal && profileModal.open;
  if (!isModalOpen || force) {
    const handleDisplay = document.getElementById('profileHandleDisplay');
    const emailDisplay = document.getElementById('profileEmailDisplay');
    if (handleDisplay) handleDisplay.textContent = state.user.handle || '';
    if (emailDisplay) emailDisplay.textContent = state.user.email || '';
    if (inputFlair) inputFlair.value = (state.selectedRealm === 'All') ? 'All' : state.user.flair;
  }

  if (sessionIdDisplay) {
    sessionIdDisplay.textContent = state.sessionId ? `${state.sessionId.slice(0, 10)}...` : 'Inactive';
    sessionIdDisplay.title = state.sessionId || '';
  }

  updateRealmIndicators();
}

// ==================== SESSION MANAGEMENT ====================

async function checkSession() {
  if (state.sessionId) {
    try {
      const res = await fetch('/api/auth/session', {
        headers: { 'x-session-id': state.sessionId }
      });

      if (res.ok) {
        const data = await res.json();
        applySession(data.session);
        updateOnlinePresence(data.online_count, data.active_nicknames);
        updateGateState();
        return true;
      } else {
        const err = await res.json().catch(() => ({}));
        console.warn('Session verification error:', err);
        state.sessionId = null;
        state.session = null;
        localStorage.removeItem('fansphere_session_id');
        updateGateState();
        openSessionPromptModal(err.expired ? 'expired' : 'new');
        return false;
      }
    } catch (e) {
      console.error('Session network check error', e);
      updateGateState();
      return false;
    }
  } else {
    // No existing session, prompt user for Nickname & Email
    updateGateState();
    openSessionPromptModal('new');
    return false;
  }
}

function applySession(session, skipWsAuth = false) {
  if (!session) return;

  state.session = session;
  state.sessionId = session.id;
  state.user.handle = session.nickname;
  state.user.email = session.email;
  state.user.flair = normalizeFlair(session.flair);
  state.user.badgeColor = getFlairBadgeColor(state.user.flair);
  state.selectedRealm = session.flair || state.selectedRealm;

  localStorage.setItem('fansphere_session_id', session.id);
  localStorage.setItem('fansphere_handle', session.nickname);
  localStorage.setItem('fansphere_email', session.email);
  localStorage.setItem('fansphere_flair', state.user.flair);
  if (state.selectedRealm) {
    localStorage.setItem('fansphere_realm', state.selectedRealm);
  }

  initUserProfile();
  loadLocalReadStates();
  syncUserReadStatesFromServer().catch(() => {});
  updateGateState();

  // If websocket is open and not skipping WS auth, authenticate socket connection only once per session ID
  if (!skipWsAuth && state.ws && state.ws.readyState === WebSocket.OPEN) {
    if (state.lastWsAuthSessionId !== session.id) {
      state.lastWsAuthSessionId = session.id;
      state.ws.send(JSON.stringify({ type: 'auth', sessionId: session.id }));
    }
  }

  // Close welcome / session prompt modal if open
  const modal = document.getElementById('sessionPromptModal');
  if (modal && modal.open) {
    modal.close();
  }

  // Refresh all application content whenever session is updated or initialized
  refreshAllContent();
}

/**
 * Refreshes all application content when session is updated:
 * - Re-fetches community posts from server
 * - Re-fetches live chat history from server
 * - Re-fetches realm list and online presence
 * - Clears render keys/caches to force a fresh re-render of feed and chat
 * - Refreshes active post detail modal if open
 * - Synchronizes realm indicators and profile inputs
 */
async function refreshAllContent() {
  // Clear feed and chat render keys/caches to force a fresh render
  const postsContainer = document.getElementById('postsList');
  if (postsContainer) {
    postsContainer.dataset.lastRenderKey = '';
  }
  state.renderedChatIds.clear();

  // Synchronize realm indicators and profile inputs
  updateRealmIndicators();
  initUserProfile();

  try {
    // Re-fetch all dynamic content in parallel
    await Promise.all([
      loadPosts(),
      loadChatHistory(),
      loadRealms(),
      loadPresence()
    ]);
  } catch (err) {
    console.warn('[Session Update] Content refresh error:', err);
  }

  // Re-render feed and chat stream with freshly fetched data
  renderPosts();
  renderChatStream();

  // If a post details modal is currently open, reload its details and comments
  if (state.activePostDetailId) {
    try {
      const res = await fetch(`/api/posts/${state.activePostDetailId}`);
      if (res.ok) {
        const data = await res.json();
        const post = data.post;
        const comments = data.comments;
        const headerFlairs = document.getElementById('modalPostHeaderFlairs');
        const commentCountEl = document.getElementById('modalCommentCount');
        const commentsList = document.getElementById('modalCommentsList');

        if (headerFlairs) {
          headerFlairs.innerHTML = `
            <span class="px-2.5 py-0.5 rounded-full text-xs font-semibold ${getTagClass(post.tag)}">
              ${post.tag}
            </span>
            <span class="text-xs text-slate-300 font-semibold">${escapeHtml(post.author)}</span>
            <span class="text-slate-500 text-xs">• ${formatRelativeTime(post.created_at)}</span>
          `;
        }

        if (commentCountEl) {
          commentCountEl.textContent = comments.length;
        }

        if (commentsList) {
          if (comments.length === 0) {
            commentsList.innerHTML = `<p class="text-slate-500 py-4">No comments yet. Start the conversation!</p>`;
          } else {
            commentsList.innerHTML = comments.map(c => renderCommentHtml(c)).join('');
            attachCommentListeners();
          }
        }
        initLucide();
      }
    } catch (e) {
      console.warn('Failed to refresh open post modal', e);
    }
  }
}

function openSessionPromptModal(reason = 'new') {
  updateGateState();
  const modal = document.getElementById('sessionPromptModal');
  const gateTitle = document.getElementById('gateTitle');
  const gateSubtitle = document.getElementById('gateSubtitle');

  if (reason === 'expired') {
    if (gateTitle) gateTitle.textContent = 'Session Expired';
    if (gateSubtitle) gateSubtitle.textContent = 'Your previous session has expired. Please confirm your nickname, email, and club realm to reactivate.';
  } else {
    if (gateTitle) gateTitle.textContent = 'Welcome to Fansphere';
    if (gateSubtitle) gateSubtitle.textContent = 'Please enter your nickname, email, and choose your club realm to enter the community and view discussions.';
  }

  if (!modal) return;

  const titleEl = document.getElementById('sessionPromptTitle');
  const noticeEl = document.getElementById('sessionPromptNotice');
  const errEl = document.getElementById('sessionPromptError');
  const nickInput = document.getElementById('sessionNicknameInput');
  const emailInput = document.getElementById('sessionEmailInput');
  const flairInput = document.getElementById('sessionFlairInput');

  if (errEl) {
    errEl.textContent = '';
    errEl.classList.add('hidden');
  }

  // Pre-fill previous values from local storage
  if (nickInput && !nickInput.value) nickInput.value = localStorage.getItem('fansphere_handle') || '';
  if (emailInput && !emailInput.value) emailInput.value = localStorage.getItem('fansphere_email') || '';
  if (flairInput && localStorage.getItem('fansphere_flair')) flairInput.value = localStorage.getItem('fansphere_flair');

  if (reason === 'expired') {
    if (titleEl) titleEl.textContent = 'Session Expired';
    if (noticeEl) {
      noticeEl.innerHTML = `Your previous fan session has <strong>expired</strong>. Please confirm your <strong>Nickname</strong> and <strong>Email address</strong> to reactivate your session.`;
      noticeEl.className = 'mt-3.5 p-3 rounded-xl bg-amber-950/70 border border-amber-800/70 text-xs text-amber-200 leading-relaxed';
    }
  } else {
    if (titleEl) titleEl.textContent = 'Welcome to Fansphere';
    if (noticeEl) {
      noticeEl.innerHTML = `Please enter your <strong>Nickname</strong> and <strong>Email address</strong> to join the live discussions. Your session refreshes automatically while you are active.`;
      noticeEl.className = 'mt-3.5 p-3 rounded-xl bg-slate-800/80 border border-slate-700/80 text-xs text-slate-300 leading-relaxed';
    }
  }

  try {
    modal.showModal();
  } catch (e) {
    console.debug('showModal error', e);
  }
}

function updateOnlinePresence(count, nicknames = [], activeUsers = []) {
  const countEl = document.getElementById('onlineCountBadge');
  const tooltipCount = document.getElementById('tooltipActiveCount');
  const listEl = document.getElementById('onlineFansList');

  if (Array.isArray(nicknames) && nicknames.length > 0) {
    state.activeNicknames = nicknames;
  }
  if (Array.isArray(activeUsers) && activeUsers.length > 0) {
    state.activeUsers = activeUsers;
  }

  const fansCount = count !== undefined
    ? count
    : (state.activeNicknames && state.activeNicknames.length > 0 ? state.activeNicknames.length : 1);

  if (countEl) {
    countEl.textContent = `${fansCount} ${fansCount === 1 ? 'Fan' : 'Fans'} Online`;
  }
  if (tooltipCount) {
    tooltipCount.textContent = fansCount;
  }

  if (listEl) {
    let list = (state.activeNicknames && state.activeNicknames.length > 0)
      ? state.activeNicknames
      : (state.user.handle ? [state.user.handle] : []);

    if (list.length === 0) {
      listEl.innerHTML = `
        <li class="text-[11px] text-slate-400 italic py-1 text-center">
          No fans currently active
        </li>
      `;
    } else {
      listEl.innerHTML = list.map(name => {
        const isYou = Boolean(state.user.handle && name.toLowerCase() === state.user.handle.toLowerCase());
        return `
          <li class="flex items-center gap-2 py-1 px-1 rounded hover:bg-slate-800/60 transition">
            <span class="w-2 h-2 rounded-full ${isYou ? 'bg-red-400 ring-2 ring-red-400/20' : 'bg-emerald-400 ring-2 ring-emerald-400/20'} shrink-0"></span>
            <span class="truncate ${isYou ? 'text-red-400 font-bold' : 'text-slate-200 font-medium'}">${escapeHtml(name)}</span>
            ${isYou ? '<span class="text-[9px] bg-red-950/80 text-red-300 border border-red-800/60 px-1.5 py-0.2 rounded ml-auto font-medium shrink-0">You</span>' : ''}
          </li>
        `;
      }).join('');
    }
  }
}

// Online fans pill & popup interactivity (hover + click toggle + outside click + esc dismiss)
function initOnlineFansPopup() {
  const pill = document.getElementById('onlineFansPill');
  const tooltip = document.getElementById('onlineFansTooltip');
  const wrapper = document.getElementById('onlineFansWrapper');
  if (!pill || !tooltip) return;

  const showPopup = () => {
    tooltip.classList.remove('closed');
    tooltip.classList.add('show');
    pill.setAttribute('aria-expanded', 'true');
  };

  const hidePopup = () => {
    tooltip.classList.remove('show');
    tooltip.classList.add('closed');
    pill.setAttribute('aria-expanded', 'false');
  };

  const togglePopup = () => {
    const isShowing = tooltip.classList.contains('show') ||
      (wrapper && wrapper.matches(':hover') && !tooltip.classList.contains('closed'));
    if (isShowing) {
      hidePopup();
    } else {
      showPopup();
    }
  };

  pill.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    togglePopup();
  });

  // When mouse leaves the wrapper, reset the 'closed' flag so subsequent hovers show the tooltip
  wrapper?.addEventListener('mouseleave', () => {
    tooltip.classList.remove('closed');
  });

  // Keep open when clicking inside the popup
  tooltip.addEventListener('click', (e) => {
    e.stopPropagation();
  });

  // Dismiss popup on outside click
  document.addEventListener('click', (e) => {
    if (wrapper && !wrapper.contains(e.target)) {
      hidePopup();
    }
  });

  // Dismiss on Escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      hidePopup();
    }
  });
}

// Fetch initial presence immediately on load
async function loadPresence() {
  try {
    const res = await fetch('/api/presence');
    if (res.ok) {
      const data = await res.json();
      updateOnlinePresence(data.online_count, data.active_nicknames, data.active_users);
    }
  } catch (err) {
    console.debug('Failed to load initial presence', err);
  }
}

// Automatic session refresh on web service use
function initSessionAutoRefresh() {
  // 1. Regular 60-second heartbeat while active
  setInterval(async () => {
    if (state.sessionId && document.visibilityState !== 'hidden') {
      try {
        const res = await fetch('/api/auth/session/refresh', {
          method: 'POST',
          headers: { 'x-session-id': state.sessionId }
        });
        if (res.ok) {
          const data = await res.json();
          updateOnlinePresence(data.online_count, data.active_nicknames, data.active_users);
        } else if (res.status === 401) {
          state.sessionId = null;
          state.session = null;
          localStorage.removeItem('fansphere_session_id');
          openSessionPromptModal('expired');
        }
      } catch (err) {
        console.debug('Heartbeat skip', err);
      }
    }
  }, 60000);

  // 2. User activity touch (debounced every 2 minutes of active engagement)
  let lastTouch = Date.now();
  const touchActivity = () => {
    const now = Date.now();
    if (now - lastTouch > 2 * 60 * 1000) {
      lastTouch = now;
      if (state.sessionId) {
        fetch('/api/auth/session/refresh', {
          method: 'POST',
          headers: { 'x-session-id': state.sessionId }
        }).catch(() => {});
      }
    }
  };

  window.addEventListener('click', touchActivity, { passive: true });
  window.addEventListener('keydown', touchActivity, { passive: true });
}

// ==================== WEBSOCKET HANDLING ====================

function connectWebSocket() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}/ws`;

  state.ws = new WebSocket(wsUrl);

  state.ws.onopen = () => {
    console.log('Fansphere WebSocket connected');
    // Authenticate socket with active session if available
    if (state.sessionId && state.lastWsAuthSessionId !== state.sessionId) {
      state.lastWsAuthSessionId = state.sessionId;
      state.ws.send(JSON.stringify({ type: 'auth', sessionId: state.sessionId }));
    }
    // Keep-alive heartbeat ping every 25s
    if (state.wsPingInterval) clearInterval(state.wsPingInterval);
    state.wsPingInterval = setInterval(() => {
      if (state.ws && state.ws.readyState === WebSocket.OPEN) {
        state.ws.send(JSON.stringify({ type: 'ping' }));
      }
    }, 25000);
  };

  state.ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      handleWebSocketMessage(msg);
    } catch (err) {
      console.error('Error parsing WS message', err);
    }
  };

  state.ws.onclose = () => {
    console.warn('Fansphere WebSocket disconnected. Reconnecting in 3s...');
    setTimeout(connectWebSocket, 3000);
  };
}

function handleWebSocketMessage(msg) {
  console.log('WS message received:', msg.type);
  switch (msg.type) {
    case 'presence':
      updateOnlinePresence(msg.online_count, msg.active_nicknames, msg.active_users);
      break;

    case 'auth_success':
      if (msg.session) {
        state.lastWsAuthSessionId = msg.session.id;
        applySession(msg.session, true);
      }
      break;

    case 'error':
      if (msg.session_required) {
        openSessionPromptModal('expired');
      }
      break;

    case 'new_notification':
      fetchNotifications();
      break;

    case 'chat_message':
      handleIncomingChatMessage(msg.data);
      break;

    case 'chat_reaction':
      if (msg.data) {
        handleIncomingChatReaction(msg.data.message_id, msg.data.reactions);
      }
      break;

    case 'vote_update':
      updatePostVoteInDOM(msg.post_id, msg.upvotes, msg.downvotes);
      break;

    case 'comment_vote_update':
      updateCommentVoteInDOM(msg.comment_id, msg.upvotes);
      break;

    case 'new_post':
      handleIncomingNewPost(msg.data);
      break;

    case 'new_comment':
      handleIncomingNewComment(msg.data);
      break;

    case 'realms_updated':
      if (Array.isArray(msg.realms)) {
        currentRealms = msg.realms;
        state.realms = msg.realms;
        updateRealmSelectDropdowns();
        renderPosts();
        renderChatStream();
      }
      break;

    default:
      break;
  }
}

// ==================== FORUM (REDDIT-LIKE FEED) ====================

function sortPostsByLatestActivity(postsList) {
  return postsList.sort((a, b) => {
    const timeA = new Date(a.latest_activity_at || a.created_at).getTime();
    const timeB = new Date(b.latest_activity_at || b.created_at).getTime();
    return timeB - timeA;
  });
}

async function loadPosts() {
  try {
    const url = new URL('/api/posts', window.location.origin);
    if (state.currentTag && state.currentTag !== 'All') {
      url.searchParams.set('tag', state.currentTag);
    }
    const effective = getEffectiveRealm();
    if (state.selectedRealm && state.selectedRealm !== 'All') {
      url.searchParams.set('realm', effective);
    }
    if (state.searchQuery && state.searchQuery.trim()) {
      url.searchParams.set('q', state.searchQuery.trim());
    }

    const headers = {};
    if (state.sessionId) headers['x-session-id'] = state.sessionId;
    if (state.user?.email) headers['x-user-email'] = state.user.email;
    if (state.user?.handle) headers['x-user-nickname'] = state.user.handle;

    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error('Failed to load posts');
    const rawPosts = await res.json();

    let merged = Array.isArray(rawPosts) ? [...rawPosts] : [];

    merged.forEach(p => {
      const readState = state.userReadStates ? state.userReadStates[String(p.id)] : null;
      if (readState) {
        p.is_unread = false;
        if (p.unread_comments_count === undefined) {
          p.unread_comments_count = Math.max(0, (Number(p.comment_count) || 0) - (Number(readState.comment_count) || 0));
        }
      }
    });

    // Client-side self-healing: if server was restarted and is missing any locally created/cached posts,
    // merge them and restore them to the server so they never disappear
    try {
      const cachedRaw = localStorage.getItem('fansphere_cached_posts');
      if (cachedRaw) {
        const cached = JSON.parse(cachedRaw);
        if (Array.isArray(cached) && cached.length > 0) {
          const validCached = cached.filter(p => p && p.id > 10);
          const serverIds = new Set(merged.map(p => p.id));
          const missing = validCached.filter(p => !serverIds.has(p.id));
          if (missing.length > 0) {
            missing.forEach(p => {
              merged.push(p);
              fetch('/api/posts/restore', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(p)
              }).catch(() => {});
            });
          }
        }
      }
    } catch {}

    state.posts = sortPostsByLatestActivity(merged);
    if (!state.searchQuery || !state.searchQuery.trim()) {
      try {
        localStorage.setItem('fansphere_cached_posts', JSON.stringify(state.posts));
      } catch {}
    }

    const countAllEl = document.getElementById('tagCountAll');
    if (countAllEl && state.currentTag === 'All') {
      countAllEl.textContent = state.posts.length;
    }
    renderPosts();
  } catch (err) {
    console.error(err);
    const container = document.getElementById('postsList');
    if (container && (!state.posts || state.posts.length === 0)) {
      container.innerHTML = `
        <div class="text-center py-8 text-red-400 bg-slate-850 rounded-xl border border-red-900/50 p-4">
          Failed to load posts. Please refresh.
        </div>
      `;
    }
  }
}

function getFilteredPosts() {
  let list = state.posts || [];
  if (state.currentTag && state.currentTag !== 'All') {
    list = list.filter(p => p.tag && p.tag.toLowerCase() === state.currentTag.toLowerCase());
  }
  const effective = getEffectiveRealm();
  if (state.selectedRealm !== 'All') {
    list = list.filter(p => matchClubRealm(p.author_flair, effective));
  }
  const q = (state.searchQuery || '').trim().toLowerCase();
  if (q) {
    list = list.filter(p => {
      const titleMatch = (p.title || '').toLowerCase().includes(q);
      const contentMatch = (p.content || '').toLowerCase().includes(q);
      const commentMatch = Array.isArray(p.matched_comments) && p.matched_comments.length > 0;
      return titleMatch || contentMatch || commentMatch;
    });
  }
  return list;
}

function calculateFeedCapacity(totalVisibleCount) {
  const centerForum = document.getElementById('centerForum');
  const paginationEl = document.getElementById('postsPagination');
  const isMobile = window.innerWidth < 1024;

  let forumHeight = 0;
  if (isMobile) {
    // In mobile portrait/landscape, derive forum height deterministically from window viewport
    // to prevent circular layout feedback loops with post children
    const headerHeight = 56;
    const padding = 20;
    const mobileTabsHeight = 44;
    forumHeight = Math.max(280, window.innerHeight - headerHeight - padding - mobileTabsHeight);
  } else {
    forumHeight = centerForum ? centerForum.clientHeight : 0;
    if (!forumHeight || forumHeight <= 0) {
      forumHeight = Math.max(320, window.innerHeight - 76);
    }
  }

  const topCta = centerForum?.firstElementChild;
  const topCtaHeight = (topCta && topCta.offsetHeight > 20) ? topCta.offsetHeight : 48;
  const searchBar = document.getElementById('forumSearchBarWrapper');
  const searchBarHeight = (searchBar && searchBar.offsetHeight > 10) ? searchBar.offsetHeight : 44;
  const gap = 8; // Tailwind gap-2 = 8px
  const topHeadersHeight = topCtaHeight + searchBarHeight + gap;

  // Deterministic stable card height to guarantee zero pagination oscillations in mobile portrait
  const cardHeight = isMobile ? 116 : 108;
  const cardSlot = cardHeight + gap;

  // Available height WITHOUT pagination controls:
  const spaceWithoutPag = Math.max(0, forumHeight - topHeadersHeight - gap);
  const maxPostsWithoutPag = Math.max(1, Math.floor((spaceWithoutPag + gap) / cardSlot));

  // If ALL visible posts fit without needing pagination:
  if (totalVisibleCount <= maxPostsWithoutPag) {
    return {
      shouldPaginate: false,
      postsPerPage: Math.max(1, totalVisibleCount),
      totalPages: 1
    };
  }

  // Not enough room for all posts: paginate and fill each page to capacity
  const paginationHeight = 36;
  const spaceWithPag = Math.max(0, forumHeight - topHeadersHeight - paginationHeight - (gap * 2));
  const maxPostsWithPag = Math.max(1, Math.floor((spaceWithPag + gap) / cardSlot));
  const totalPages = Math.max(1, Math.ceil(totalVisibleCount / maxPostsWithPag));

  return {
    shouldPaginate: true,
    postsPerPage: maxPostsWithPag,
    totalPages
  };
}

function syncSearchTypeSelectUI(activeTag) {
  const searchSelect = document.getElementById('forumSearchTypeSelect');
  if (searchSelect && searchSelect.value !== (activeTag || 'All')) {
    searchSelect.value = activeTag || 'All';
  }
}

function updateSearchStatsUI(visibleCount) {
  const statsWrapper = document.getElementById('forumSearchStats');
  const statsText = document.getElementById('forumSearchStatsText');
  const clearBtn = document.getElementById('clearForumSearchBtn');

  syncSearchTypeSelectUI(state.currentTag);

  const query = (state.searchQuery || '').trim();
  const hasTag = state.currentTag && state.currentTag !== 'All';

  if (query) {
    if (clearBtn) clearBtn.classList.remove('hidden');
  } else {
    if (clearBtn) clearBtn.classList.add('hidden');
  }

  if (query || hasTag) {
    if (statsWrapper && statsText) {
      const effective = getEffectiveRealm();
      const realmName = getRealmDisplayName(effective);
      if (query && hasTag) {
        statsText.textContent = `Found ${visibleCount} [${state.currentTag}] match${visibleCount === 1 ? '' : 'es'} for "${query}" in ${realmName}`;
      } else if (query) {
        statsText.textContent = `Found ${visibleCount} match${visibleCount === 1 ? '' : 'es'} for "${query}" in ${realmName}`;
      } else {
        statsText.textContent = `Showing ${visibleCount} [${state.currentTag}] discussion${visibleCount === 1 ? '' : 's'} in ${realmName}`;
      }
      statsWrapper.classList.remove('hidden');
      statsWrapper.classList.add('flex');
    }
  } else {
    if (statsWrapper) {
      statsWrapper.classList.add('hidden');
      statsWrapper.classList.remove('flex');
    }
  }
}

function clearForumSearch() {
  state.searchQuery = '';
  state.currentTag = 'All';

  const input = document.getElementById('forumSearchInput');
  if (input) input.value = '';

  const searchSelect = document.getElementById('forumSearchTypeSelect');
  if (searchSelect) searchSelect.value = 'All';

  const threadFilterSelect = document.getElementById('threadFilterSelect');
  if (threadFilterSelect) threadFilterSelect.value = 'All';

  const indicator = document.getElementById('activeTagIndicator');
  if (indicator) indicator.classList.add('hidden');

  syncSearchTypeSelectUI('All');
  updateSearchStatsUI(0);
  state.currentPage = 1;
  loadPosts();
}

function renderPosts() {
  const container = document.getElementById('postsList');
  if (!container) return;

  const visiblePosts = getFilteredPosts();
  updateSearchStatsUI(visiblePosts.length);

  if (visiblePosts.length === 0) {
    container.dataset.lastRenderKey = 'empty';
    const effective = getEffectiveRealm();
    const realmName = getRealmDisplayName(effective);
    requestAnimationFrame(() => {
      const hasActiveFilters = (state.searchQuery && state.searchQuery.trim()) || (state.currentTag && state.currentTag !== 'All');
      if (hasActiveFilters) {
        const queryPart = state.searchQuery && state.searchQuery.trim() ? `"${escapeHtml(state.searchQuery)}"` : '';
        const tagPart = state.currentTag && state.currentTag !== 'All' ? `[${escapeHtml(state.currentTag)}]` : '';
        const filterLabel = [tagPart, queryPart].filter(Boolean).join(' ');

        container.innerHTML = `
          <div class="text-center py-6 bg-slate-850 rounded-2xl border border-slate-700/60 p-4 text-slate-400 my-auto">
            <div class="w-9 h-9 rounded-xl bg-slate-800 text-red-400 mx-auto flex items-center justify-center mb-2 border border-slate-700">
              <i data-lucide="search-x" class="w-5 h-5"></i>
            </div>
            <p class="text-xs font-semibold text-slate-200 mb-1">No results matching ${filterLabel}</p>
            <p class="text-[10px] text-slate-500 mb-2.5">No discussions or comments found in the <span class="text-red-400 font-medium">${escapeHtml(realmName)}</span> realm.</p>
            <div class="flex items-center justify-center gap-2">
              <button id="emptyStateClearSearchBtn" class="text-[10px] bg-red-600 hover:bg-red-500 text-white font-semibold px-3 py-1.5 rounded-lg transition cursor-pointer">
                Reset All Filters
              </button>
            </div>
          </div>
        `;
        document.getElementById('emptyStateClearSearchBtn')?.addEventListener('click', () => {
          clearForumSearch();
        });
        initLucide();
      } else {
        container.innerHTML = `
          <div class="text-center py-6 bg-slate-850 rounded-2xl border border-slate-700/60 p-4 text-slate-400 my-auto">
            <p class="text-xs font-semibold mb-1">No posts found in the <span class="text-red-400">${escapeHtml(realmName)}</span> realm.</p>
            <p class="text-[10px] text-slate-500 mb-2.5">Be the first to share thoughts in this club realm, or switch realm in your profile!</p>
            <div class="flex items-center justify-center gap-2">
              <button id="emptyStateResetRealmBtn" class="text-[10px] bg-red-600 hover:bg-red-500 text-white font-semibold px-3 py-1.5 rounded-lg transition cursor-pointer">
                🌐 Show All Posts
              </button>
              <button id="emptyStateProfileBtn" class="text-[10px] bg-slate-800 hover:bg-slate-700 text-slate-300 px-3 py-1.5 rounded-lg border border-slate-700 transition cursor-pointer">
                👤 Profile Realm
              </button>
            </div>
          </div>
        `;
        document.getElementById('emptyStateResetRealmBtn')?.addEventListener('click', () => {
          setRealmFilter('All');
        });
        document.getElementById('emptyStateProfileBtn')?.addEventListener('click', () => {
          document.getElementById('openProfileModalBtn')?.click();
        });
      }
      updatePaginationControls(1, 1, false);
    });
    return;
  }

  const { shouldPaginate, postsPerPage, totalPages } = calculateFeedCapacity(visiblePosts.length);
  state.postsPerPage = postsPerPage;

  if (state.currentPage > totalPages) state.currentPage = totalPages;
  if (state.currentPage < 1) state.currentPage = 1;

  let pagePosts;
  if (!shouldPaginate) {
    pagePosts = visiblePosts;
    state.currentPage = 1;
  } else {
    const startIndex = (state.currentPage - 1) * state.postsPerPage;
    pagePosts = visiblePosts.slice(startIndex, startIndex + state.postsPerPage);
  }

  // Prevent re-rendering and flickering if the target cards and pagination are already rendered
  const renderKey = `${state.selectedRealm}:${state.currentTag}:${state.searchQuery || ''}:${state.currentPage}:${shouldPaginate}:${totalPages}:${postsPerPage}:${pagePosts.map(p => `${p.id}_${p.comment_count || 0}_${p.unread_comments_count || 0}_${p.is_unread ? 1 : 0}_${state.userReadStates?.[String(p.id)] ? 1 : 0}_${p.title}`).join('|')}`;
  container.dataset.lastRenderKey = renderKey;

  requestAnimationFrame(() => {
    container.innerHTML = pagePosts.map(post => renderPostCardHtml(post)).join('');
    updatePaginationControls(totalPages, state.currentPage, shouldPaginate);
    initLucide();
    attachPostCardListeners();
  });
}

function updatePaginationControls(totalPages, currentPage, shouldPaginate = true) {
  const paginationEl = document.getElementById('postsPagination');
  const pageIndicator = document.getElementById('pageIndicator');
  const prevBtn = document.getElementById('prevPageBtn');
  const nextBtn = document.getElementById('nextPageBtn');

  if (!shouldPaginate || totalPages <= 1) {
    if (paginationEl) paginationEl.classList.add('hidden');
    return;
  }

  if (paginationEl) paginationEl.classList.remove('hidden');
  if (pageIndicator) pageIndicator.textContent = `Page ${currentPage} / ${totalPages}`;
  if (prevBtn) {
    prevBtn.disabled = (currentPage <= 1);
  }
  if (nextBtn) {
    nextBtn.disabled = (currentPage >= totalPages);
  }
}

function getTagClass(tag) {
  switch (tag) {
    case 'Match Thread': return 'flair-match';
    case 'Meetups': return 'flair-meetup';
    case 'Tactics': return 'flair-tactics';
    case 'Transfers': return 'flair-transfers';
    case 'Memes': return 'flair-memes';
    default: return 'flair-discussion';
  }
}

function formatRelativeTime(isoString) {
  try {
    const date = new Date(isoString);
    const now = new Date();
    const diffSec = Math.floor((now - date) / 1000);
    if (diffSec < 60) return 'just now';
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHours = Math.floor(diffMin / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays}d ago`;
  } catch {
    return 'recently';
  }
}

function highlightSearchMatches(htmlStr, query) {
  if (!htmlStr || !query || !query.trim()) return htmlStr;
  const q = query.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(?![^<]*>)(${q})`, 'gi');
  return htmlStr.replace(regex, '<mark class="bg-amber-400/25 text-amber-200 px-0.5 rounded font-medium">$1</mark>');
}

function renderPostCardHtml(post) {
  const tagClass = getTagClass(post.tag);
  const q = (state.searchQuery || '').trim();

  // Compute unread status for current user
  const readState = state.userReadStates ? state.userReadStates[String(post.id)] : null;
  const isAuthor = Boolean(state.user && state.user.handle && (post.author || '').toLowerCase() === state.user.handle.toLowerCase());

  let isUnread = false;
  let unreadCommentsCount = 0;

  if (readState) {
    isUnread = false;
    if (post.unread_comments_count !== undefined) {
      unreadCommentsCount = Math.max(0, Number(post.unread_comments_count) || 0);
    } else {
      unreadCommentsCount = Math.max(0, (Number(post.comment_count) || 0) - (Number(readState.comment_count) || 0));
    }
  } else {
    if (post.is_unread !== undefined) {
      isUnread = Boolean(post.is_unread);
      unreadCommentsCount = Math.max(0, Number(post.unread_comments_count) || 0);
    } else if (!isAuthor) {
      isUnread = true;
      unreadCommentsCount = Math.max(0, Number(post.comment_count) || 0);
    } else {
      isUnread = false;
      unreadCommentsCount = Math.max(0, Number(post.unread_comments_count) || 0);
    }
  }

  const hasNewComments = post.latest_activity_at && post.comment_count > 0 && new Date(post.latest_activity_at).getTime() > new Date(post.created_at).getTime() + 1000;
  const cardBorderClass = (unreadCommentsCount > 0)
    ? 'border-l-4 border-l-red-500 border-slate-700/70'
    : (isUnread ? 'border-l-4 border-l-amber-500 border-slate-700/70' : 'border-slate-700/70');

  const renderedTitle = q ? highlightSearchMatches(escapeHtml(post.title), q) : escapeHtml(post.title);
  const renderedContent = q ? highlightSearchMatches(formatLightweightMarkdown(post.content), q) : formatLightweightMarkdown(post.content);

  return `
    <article 
      class="post-card bg-slate-800/90 hover:bg-slate-800 rounded-xl p-3 border ${cardBorderClass} transition flex flex-col gap-1.5 shadow-sm group shrink-0"
      data-post-id="${post.id}"
    >
      <!-- Main Post Content -->
      <div class="flex-1 min-w-0">
        <!-- Post Header / Flairs -->
        <div class="flex items-center gap-1.5 flex-wrap text-[10px] mb-1">
          <span class="px-1.5 py-0.2 rounded-full font-semibold ${tagClass}">
            ${post.tag}
          </span>
          <span class="text-slate-400 font-medium truncate max-w-[90px]">${escapeHtml(post.author)}</span>
          <span class="bg-slate-700/50 text-slate-300 text-[8px] px-1 py-0.2 rounded border border-slate-600/40 truncate max-w-[100px]">
            ${escapeHtml(post.author_flair || 'Gunner')}
          </span>
          <span class="text-slate-500">• ${formatRelativeTime(post.created_at)}</span>
          ${unreadCommentsCount > 0 ? `
            <span class="thread-unread-badge inline-flex items-center gap-1 bg-red-950/90 text-red-300 border border-red-600/80 text-[9px] font-bold px-1.5 py-0.2 rounded-full shadow-sm animate-pulse ml-auto">
              <span class="w-1.5 h-1.5 rounded-full bg-red-400"></span>
              ${unreadCommentsCount} new
            </span>
          ` : (isUnread ? `
            <span class="thread-unread-badge inline-flex items-center gap-1 bg-amber-950/90 text-amber-300 border border-amber-600/80 text-[9px] font-bold px-1.5 py-0.2 rounded-full shadow-sm ml-auto">
              <span class="w-1.5 h-1.5 rounded-full bg-amber-400"></span>
              New
            </span>
          ` : (hasNewComments ? `
            <span class="bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 text-[9px] px-1.5 py-0.2 rounded font-medium ml-auto flex items-center gap-0.5">
              <i data-lucide="message-square" class="w-2.5 h-2.5"></i> Active ${formatRelativeTime(post.latest_activity_at)}
            </span>
          ` : ''))}
        </div>

        <!-- Post Title -->
        <h2 class="post-title-link font-bold text-slate-100 text-xs leading-snug hover:text-red-400 transition cursor-pointer truncate mb-0.5" data-post-id="${post.id}">
          ${renderedTitle}
        </h2>

        <!-- Post Body & Optional Image Thumbnail -->
        <div class="flex items-start gap-2.5 mb-1.5">
          <p class="post-title-link text-[11px] text-slate-300 leading-snug line-clamp-2 cursor-pointer flex-1 min-w-0" data-post-id="${post.id}">
            ${renderedContent}
          </p>
          ${post.image_url ? `
            <div class="shrink-0 relative group/thumb cursor-pointer" onclick="event.stopPropagation(); openImageLightbox('${escapeJsString(post.image_url)}', '${escapeJsString(post.title)}')">
              <div class="absolute inset-0 flex items-center justify-center loading-spinner z-10">
                <i data-lucide="loader-2" class="w-4 h-4 text-slate-500 animate-spin"></i>
              </div>
              <img 
                src="${escapeHtml(post.image_url)}" 
                alt="Post thumbnail" 
                loading="lazy"
                onload="this.parentElement.querySelector('.loading-spinner').classList.add('hidden')"
                class="w-14 h-14 sm:w-16 sm:h-16 object-cover rounded-lg border border-slate-700/80 group-hover/thumb:border-red-500/80 group-hover/thumb:scale-105 transition shadow-sm bg-slate-900 relative z-20"
                onerror="this.parentElement.style.display='none'"
              />
              <div class="absolute inset-0 bg-black/30 group-hover/thumb:bg-black/10 rounded-lg flex items-center justify-center opacity-0 group-hover/thumb:opacity-100 transition pointer-events-none z-30">
                <i data-lucide="zoom-in" class="w-3.5 h-3.5 text-white drop-shadow"></i>
              </div>
            </div>
          ` : ''}
        </div>

        ${(post.matched_comments && post.matched_comments.length > 0 && q) ? `
          <div class="mb-1.5 p-2 rounded-lg bg-slate-900/90 border border-slate-700/70 text-[10px] space-y-0.5">
            <div class="flex items-center gap-1 text-red-400 font-semibold">
              <i data-lucide="message-square-quote" class="w-3 h-3"></i>
              <span>Matched comment (@${escapeHtml(post.matched_comments[0].author)}):</span>
            </div>
            <p class="text-slate-300 italic line-clamp-1">
              "${highlightSearchMatches(escapeHtml(post.matched_comments[0].content), q)}"
            </p>
          </div>
        ` : ''}

        <!-- Post Actions Footer -->
        <div class="flex items-center gap-3 text-[10px] text-slate-400 pt-1 border-t border-slate-700/40">
          <button class="open-comments-btn flex items-center gap-1 hover:text-slate-200 transition py-0.5" data-post-id="${post.id}">
            <i data-lucide="message-circle" class="w-3 h-3 text-red-400"></i>
            <span>${post.comment_count} Comments</span>
            ${unreadCommentsCount > 0 ? `
              <span class="thread-new-count text-[9px] font-bold text-red-300 bg-red-950/80 border border-red-700/70 px-1.5 py-0.2 rounded-full">
                +${unreadCommentsCount} new
              </span>
            ` : ''}
          </button>
          
          ${post.image_url ? `
            <button class="view-post-image-btn flex items-center gap-1 text-slate-400 hover:text-red-400 transition py-0.5" onclick="event.stopPropagation(); openImageLightbox('${escapeJsString(post.image_url)}', '${escapeJsString(post.title)}')">
              <i data-lucide="image" class="w-3 h-3 text-red-400"></i>
              <span>Photo</span>
            </button>
          ` : ''}

          <button class="share-btn flex items-center gap-1 hover:text-slate-200 transition py-0.5 ml-auto" data-post-id="${post.id}">
            <i data-lucide="share-2" class="w-3 h-3"></i>
            <span>Share</span>
          </button>
        </div>
      </div>
    </article>
  `;
}

function attachPostCardListeners() {
  document.querySelectorAll('.post-title-link, .open-comments-btn').forEach(el => {
    el.addEventListener('click', () => {
      const postId = parseInt(el.dataset.postId);
      openPostDetailModal(postId);
    });
  });

  document.querySelectorAll('.share-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      navigator.clipboard?.writeText(window.location.href);
      const originalText = btn.innerHTML;
      btn.innerHTML = `<i data-lucide="check" class="w-3 h-3 text-emerald-400"></i><span class="text-emerald-400">Copied!</span>`;
      initLucide();
      setTimeout(() => {
        btn.innerHTML = originalText;
        initLucide();
      }, 2000);
    });
  });
}

function updatePostVoteInDOM(postId, upvotes, downvotes) {
  // Upvote/downvote display removed from forum section
}

function handleIncomingNewPost(newPost) {
  if (state.currentTag === 'All' || state.currentTag === newPost.tag) {
    if (!newPost.latest_activity_at) {
      newPost.latest_activity_at = newPost.created_at;
    }
    const isSelf = Boolean(state.user?.handle && (newPost.author || '').toLowerCase() === state.user.handle.toLowerCase());
    if (!isSelf) {
      newPost.is_unread = true;
      newPost.unread_comments_count = 0;
    } else {
      newPost.is_unread = false;
      newPost.unread_comments_count = 0;
      markPostAsReadLocally(newPost.id, 0);
    }
    state.posts = state.posts.filter(p => p.id !== newPost.id);
    state.posts.unshift(newPost);
    sortPostsByLatestActivity(state.posts);
    renderPosts();
  }
}

// ==================== POST DETAIL & COMMENTS MODAL ====================

async function openPostDetailModal(postId) {
  state.activePostDetailId = postId;
  markPostAsReadLocally(postId);

  const modal = document.getElementById('postDetailModal');
  const headerFlairs = document.getElementById('modalPostHeaderFlairs');
  const contentEl = document.getElementById('modalPostContent');
  const commentCountEl = document.getElementById('modalCommentCount');
  const commentsList = document.getElementById('modalCommentsList');

  commentsList.innerHTML = `<div class="text-center py-4 text-slate-500">Loading comments...</div>`;
  modal.showModal();

  try {
    const headers = {};
    if (state.sessionId) headers['x-session-id'] = state.sessionId;
    if (state.user?.email) headers['x-user-email'] = state.user.email;
    if (state.user?.handle) headers['x-user-nickname'] = state.user.handle;

    const res = await fetch(`/api/posts/${postId}`, { headers });
    if (!res.ok) throw new Error('Failed to load post');
    const data = await res.json();
    const post = data.post;
    const comments = data.comments;

    markPostAsReadLocally(postId, comments.length);

    headerFlairs.innerHTML = `
      <span class="px-2.5 py-0.5 rounded-full text-xs font-semibold ${getTagClass(post.tag)}">
        ${post.tag}
      </span>
      <span class="text-xs text-slate-300 font-semibold">${escapeHtml(post.author)}</span>
      <span class="text-slate-500 text-xs">• ${formatRelativeTime(post.created_at)}</span>
    `;

    contentEl.innerHTML = `
      <h2 class="text-base sm:text-lg font-bold text-slate-100">${escapeHtml(post.title)}</h2>
      <div class="text-xs sm:text-sm text-slate-300 whitespace-pre-line leading-relaxed">${formatLightweightMarkdown(post.content)}</div>
      ${post.image_url ? `
        <div class="mt-3 rounded-xl overflow-hidden border border-slate-700/80 bg-slate-950/60 max-h-72 flex items-center justify-center relative group cursor-pointer" onclick="openImageLightbox('${escapeJsString(post.image_url)}', '${escapeJsString(post.title)}')">
          <div class="absolute inset-0 flex items-center justify-center loading-spinner z-10">
            <i data-lucide="loader-2" class="w-6 h-6 text-slate-500 animate-spin"></i>
          </div>
          <img 
            src="${escapeHtml(post.image_url)}" 
            alt="Attached image" 
            onload="this.parentElement.querySelector('.loading-spinner').classList.add('hidden')"
            class="max-h-72 w-full object-contain rounded-xl transition duration-300 group-hover:scale-[1.01] relative z-20" 
          />
          <div class="absolute bottom-2 right-2 bg-slate-900/80 text-white text-[10px] px-2 py-1 rounded-md border border-slate-700 flex items-center gap-1 opacity-80 group-hover:opacity-100 transition z-30">
            <i data-lucide="zoom-in" class="w-3 h-3 text-red-400"></i>
            <span>Click to enlarge</span>
          </div>
        </div>
      ` : ''}
    `;

    commentCountEl.textContent = comments.length;

    if (comments.length === 0) {
      commentsList.innerHTML = `<p class="text-slate-500 py-4">No comments yet. Start the conversation!</p>`;
    } else {
      // Sort oldest to newest
      const sortedComments = [...comments].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
      commentsList.innerHTML = sortedComments.map(c => renderCommentHtml(c)).join('');
      attachCommentListeners();
    }
    initLucide();
  } catch (err) {
    console.error(err);
    contentEl.innerHTML = `<p class="text-red-400">Failed to load post details.</p>`;
  }
}

function renderCommentHtml(comment) {
  return `
    <div class="bg-slate-800/80 p-3 rounded-xl border border-slate-700/60 space-y-2" data-comment-id="${comment.id}">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-2">
          <span class="font-bold text-slate-200">${escapeHtml(comment.author)}</span>
          <span class="bg-slate-700/40 text-slate-300 text-[10px] px-1.5 py-0.5 rounded">${escapeHtml(comment.author_flair || 'Gunner')}</span>
          <span class="text-slate-500 text-[11px]">• ${formatRelativeTime(comment.created_at)}</span>
        </div>
      </div>
      <div class="text-slate-300 leading-relaxed text-xs whitespace-pre-wrap">${formatLightweightMarkdown(comment.content)}</div>
      ${comment.image_url ? `
        <div class="relative group/cimg inline-block max-w-[280px] rounded-xl overflow-hidden border border-slate-700 bg-slate-950 cursor-pointer mt-1" onclick="openImageLightbox('${escapeJsString(comment.image_url)}', 'Comment by ${escapeJsString(comment.author)}')">
          <div class="absolute inset-0 flex items-center justify-center loading-spinner z-10">
            <i data-lucide="loader-2" class="w-4 h-4 text-slate-500 animate-spin"></i>
          </div>
          <img 
            src="${escapeHtml(comment.image_url)}" 
            alt="Comment attachment" 
            loading="lazy" 
            onload="this.parentElement.querySelector('.loading-spinner').classList.add('hidden')"
            class="max-h-48 max-w-[280px] object-cover rounded-xl transition group-hover/cimg:scale-105 relative z-20" 
            onerror="this.parentElement.style.display='none'"
          />
          <div class="absolute inset-0 bg-black/25 opacity-0 group-hover/cimg:opacity-100 transition rounded-xl flex items-center justify-center pointer-events-none z-30">
            <i data-lucide="zoom-in" class="w-4 h-4 text-white drop-shadow"></i>
          </div>
        </div>
      ` : ''}
    </div>
  `;
}

function attachCommentListeners() {
  // Comment voting removed
}

function updateCommentVoteInDOM(commentId, upvotes) {
  // Comment voting removed
}

function handleIncomingNewComment(newComment) {
  if (!newComment || !newComment.post_id) return;

  const isCurrentDetailOpen = Number(state.activePostDetailId) === Number(newComment.post_id);
  const isSelf = Boolean(state.user?.handle && (newComment.author || '').toLowerCase() === state.user.handle.toLowerCase());

  if (isCurrentDetailOpen) {
    const list = document.getElementById('modalCommentsList');
    const countEl = document.getElementById('modalCommentCount');
    if (list) {
      // Prevent duplicate rendering if already appended (from immediate submit or WS)
      const alreadyPresent = list.querySelector(`[data-comment-id="${newComment.id}"]`);
      if (!alreadyPresent) {
        // If placeholder ("No comments yet" or "Loading comments...") is visible, clear it
        const placeholder = list.querySelector('p');
        if (placeholder && (placeholder.textContent.includes('No comments') || placeholder.textContent.includes('Loading comments'))) {
          list.innerHTML = '';
        }

        const div = document.createElement('div');
        div.innerHTML = renderCommentHtml(newComment);
        const newEl = div.firstElementChild;
        if (newEl) {
          list.appendChild(newEl);
          attachCommentListeners();
          initLucide();
          newEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }

        if (countEl) {
          const cur = parseInt(countEl.textContent || '0', 10);
          countEl.textContent = isNaN(cur) ? '1' : String(cur + 1);
        }
      }
    }
    // Thread is open right now, keep it marked as read for this user
    markPostAsReadLocally(newComment.post_id);
  }

  // Update post latest activity and comment count, then re-sort feed so active thread moves to top
  const targetPost = state.posts.find(p => Number(p.id) === Number(newComment.post_id));
  if (targetPost) {
    targetPost.comment_count = (targetPost.comment_count || 0) + 1;
    targetPost.latest_activity_at = newComment.created_at || new Date().toISOString();

    if (!isCurrentDetailOpen && !isSelf) {
      targetPost.unread_comments_count = (targetPost.unread_comments_count || 0) + 1;
    } else if (isCurrentDetailOpen) {
      targetPost.is_unread = false;
      targetPost.unread_comments_count = 0;
    }

    sortPostsByLatestActivity(state.posts);
    renderPosts();
    try {
      localStorage.setItem('fansphere_cached_posts', JSON.stringify(state.posts));
    } catch {}
  } else {
    loadPosts();
  }

  const card = document.querySelector(`.post-card[data-post-id="${newComment.post_id}"]`);
  if (card) {
    const countBtn = card.querySelector('.open-comments-btn span');
    if (countBtn) {
      const current = parseInt(countBtn.textContent) || 0;
      countBtn.textContent = `${current + 1} Comments`;
    }
  }
}

// ==================== REAL-TIME CHAT ====================

function renderChatStream() {
  const container = document.getElementById('chatMessages');
  if (!container) return;

  const effective = getEffectiveRealm();
  const filtered = state.selectedRealm === 'All'
    ? state.allChatMessages
    : state.allChatMessages.filter(msg => matchClubRealm(msg.author_flair, effective));

  // If already rendered with exactly the same message IDs, avoid wiping and re-rendering
  const currentRenderedIds = Array.from(state.renderedChatIds);
  const targetIds = filtered.map(m => m.id).filter(Boolean);
  if (currentRenderedIds.length > 0 && currentRenderedIds.length === targetIds.length) {
    let same = true;
    for (let i = 0; i < currentRenderedIds.length; i++) {
      if (currentRenderedIds[i] !== targetIds[i]) {
        same = false;
        break;
      }
    }
    if (same) return;
  }

  requestAnimationFrame(() => {
    container.innerHTML = '';
    state.renderedChatIds.clear();

    if (filtered.length === 0) {
      const realmName = getRealmDisplayName(effective);
      container.innerHTML = `
        <div class="text-center py-6 text-slate-500 my-auto">
          <p class="text-xs font-semibold mb-1">No chat messages in <span class="text-red-400">${escapeHtml(realmName)}</span> realm yet.</p>
          <p class="text-[10px] text-slate-500 mb-2">Say hello to your fellow club supporters below, or switch realm in your profile!</p>
          <button id="chatEmptyProfileBtn" class="text-[10px] bg-slate-800 hover:bg-slate-700 text-slate-300 px-2.5 py-1 rounded-lg border border-slate-700 transition cursor-pointer">
            👤 Change Realm in Profile
          </button>
        </div>
      `;
      document.getElementById('chatEmptyProfileBtn')?.addEventListener('click', () => {
        document.getElementById('openProfileModalBtn')?.click();
      });
      return;
    }

    filtered.forEach(msg => appendChatMessage(msg, false, false));
    initLucide();
    scrollChatToBottom(true);
  });
}

async function loadChatHistory() {
  try {
    const res = await fetch(window.location.origin + '/api/chat/history?room=general&limit=1000');
    if (!res.ok) throw new Error('Failed to load chat');
    const messages = await res.json();
    state.allChatMessages = Array.isArray(messages) ? messages.slice(-1000) : [];
    renderChatStream();
    try {
      localStorage.setItem('fansphere_cached_chat', JSON.stringify(messages.slice(-50)));
    } catch {}
  } catch (err) {
    console.error(err);
  }
}

function handleIncomingChatMessage(chatData) {
  if (!chatData) return;
  if (!state.allChatMessages.some(m => m.id === chatData.id)) {
    state.allChatMessages.push(chatData);
    if (state.allChatMessages.length > 1000) {
      state.allChatMessages.shift();
    }
  }
  const effective = getEffectiveRealm();
  if (state.selectedRealm === 'All' || matchClubRealm(chatData.author_flair, effective)) {
    appendChatMessage(chatData, true, true);
    initLucide();
    if (!chatData._isMentionHighlight) {
      playChime(523.25, 0.1);
    }
  }
}

function renderReactionsHtml(messageId, reactions) {
  if (!reactions || typeof reactions !== 'object') return '';
  const entries = Object.entries(reactions);
  if (entries.length === 0) return '';

  return entries.map(([emoji, users]) => {
    const list = Array.isArray(users) ? users : [];
    if (list.length === 0) return '';
    const isUserReacted = state.user?.handle && list.includes(state.user.handle);
    const tooltip = list.join(', ');
    return `
      <button 
        type="button" 
        class="chat-reaction-chip inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] border transition cursor-pointer select-none ${isUserReacted ? 'bg-amber-500/20 border-amber-500/50 text-amber-300 font-bold' : 'bg-slate-800/80 border-slate-700/80 text-slate-300 hover:bg-slate-700'}"
        data-msg-id="${messageId}"
        data-emoji="${escapeHtml(emoji)}"
        title="Reacted by: ${escapeHtml(tooltip)}"
      >
        <span>${escapeHtml(emoji)}</span>
        <span class="text-[9px] font-semibold">${list.length}</span>
      </button>
    `;
  }).join('');
}

function updateMessageReactionsInDOM(messageId, reactions) {
  const container = document.querySelector(`.chat-reactions-container[data-msg-id="${messageId}"]`);
  if (!container) return;
  const entries = reactions ? Object.entries(reactions).filter(([_, users]) => Array.isArray(users) && users.length > 0) : [];
  if (entries.length === 0) {
    container.innerHTML = '';
    container.classList.add('hidden');
  } else {
    container.innerHTML = renderReactionsHtml(messageId, reactions);
    container.classList.remove('hidden');
  }
}

function handleIncomingChatReaction(messageId, reactions) {
  const chatItem = state.allChatMessages.find(m => m.id === Number(messageId));
  if (chatItem) {
    chatItem.reactions = reactions;
  }
  updateMessageReactionsInDOM(messageId, reactions);
}

function appendChatMessage(msg, autoScroll = true, isNew = false) {
  const container = document.getElementById('chatMessages');
  if (!container) return;

  if (msg.id && state.renderedChatIds.has(msg.id)) {
    updateMessageReactionsInDOM(msg.id, msg.reactions);
    return;
  }
  if (msg.id) {
    state.renderedChatIds.add(msg.id);
  }

  const isSelf = msg.author === state.user.handle;
  const reactions = msg.reactions || {};
  const hasReactions = Object.values(reactions).some(arr => Array.isArray(arr) && arr.length > 0);

  // Mention validation: ONLY inside selected club realm!
  const effectiveRealm = getEffectiveRealm();
  const isSenderInRealm = matchClubRealm(msg.author_flair, effectiveRealm);
  const isUserInRealm = matchClubRealm(state.user?.flair, effectiveRealm);
  const currentNick = state.user?.handle;
  let isMentioned = false;

  if (!isSelf && currentNick && msg.content && isSenderInRealm && isUserInRealm) {
    const escapedNick = currentNick.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const mentionRegex = new RegExp(`(^|\\s)@${escapedNick}(\\b|\\s|$)`, 'i');
    isMentioned = mentionRegex.test(msg.content);
  }

  msg._isMentionHighlight = isMentioned;

  const msgDiv = document.createElement('div');
  msgDiv.className = `${isNew ? 'chat-msg-enter ' : ''}flex flex-col space-y-0.5 shrink-0 group/msg relative transition-all duration-300 ${
    isMentioned 
      ? 'p-2 rounded-xl border-2 border-amber-500/90 bg-gradient-to-r from-amber-950/60 via-slate-900 to-amber-950/30 shadow-lg shadow-amber-500/15 ring-1 ring-amber-400/50' 
      : ''
  }`;
  if (msg.id) msgDiv.dataset.chatId = msg.id;
  if (isMentioned) msgDiv.dataset.mentioned = 'true';

  msgDiv.innerHTML = `
    ${isMentioned ? `
      <div class="mention-indicator flex items-center gap-1.5 mb-1 text-[10px] font-extrabold text-amber-300 bg-amber-500/20 border border-amber-500/40 px-2 py-0.5 rounded-full w-fit shadow-sm select-none">
        <i data-lucide="at-sign" class="w-3 h-3 text-amber-400 shrink-0"></i>
        <span>Mentioned you in <span class="text-amber-200 underline">${escapeHtml(getRealmDisplayName(effectiveRealm))}</span></span>
      </div>
    ` : ''}
    <div class="flex items-center gap-1.5 text-[10px]">
      <span class="w-1.5 h-1.5 rounded-full shrink-0" style="background-color: ${msg.badge_color || '#EF4444'}"></span>
      <span class="font-bold text-slate-200 truncate ${isSelf ? 'text-red-400 font-extrabold' : (isMentioned ? 'text-amber-300' : '')}">${escapeHtml(msg.author)}</span>
      <span class="bg-slate-700/40 text-slate-400 text-[8px] px-1 py-0.2 rounded truncate max-w-[100px]">${escapeHtml(msg.author_flair || 'Arsenal Finland Official Member')}</span>
      <span class="text-slate-500 text-[9px] ml-auto shrink-0">${formatRelativeTime(msg.created_at)}</span>
    </div>

    <!-- Message Bubble with Right-Hand Action Buttons -->
    <div class="chat-msg-row flex items-stretch gap-1 relative w-full">
      <div class="chat-bubble flex-1 min-w-0 w-full ${isMentioned ? 'bg-slate-900/95 border-amber-500/60' : 'bg-slate-900/90 border-slate-700/60'} text-slate-100 px-2 py-0.5 rounded-lg border leading-snug break-words shadow-sm text-xs h-auto min-h-full flex flex-col justify-center">
        <div class="chat-msg-text whitespace-pre-wrap break-words leading-snug">${formatLightweightMarkdown(msg.content)}</div>
        <div class="chat-reactions-container flex flex-wrap items-center gap-1 mt-0.5 ${hasReactions ? '' : 'hidden'}" data-msg-id="${msg.id}">${renderReactionsHtml(msg.id, reactions)}</div>
      </div>

      <!-- Action Buttons on the Right Side of the Message Div (Vertically Aligned) -->
      <div class="flex flex-col items-center justify-center gap-0.5 shrink-0 self-stretch opacity-90 sm:opacity-40 group-hover/msg:opacity-100 focus-within:opacity-100 transition">
        <!-- Quote Message Button -->
        <button 
          type="button" 
          class="quote-chat-btn text-slate-400 hover:text-red-400 p-1 rounded-md hover:bg-slate-800 transition cursor-pointer" 
          title="Quote message" 
          data-content="${escapeHtml(msg.content)}" 
          data-author="${escapeHtml(msg.author)}"
        >
          <i data-lucide="quote" class="w-3.5 h-3.5"></i>
        </button>

        <!-- Emoji React Button -->
        <button 
          type="button" 
          class="chat-react-btn text-slate-400 hover:text-amber-400 p-1 rounded-md hover:bg-slate-800 transition cursor-pointer" 
          title="React with emoji" 
          data-msg-id="${msg.id}"
        >
          <i data-lucide="smile" class="w-3.5 h-3.5"></i>
        </button>
      </div>
    </div>
  `;

  container.appendChild(msgDiv);

  if (isMentioned && isNew) {
    playChime(659.25, 0.2);
    setTimeout(() => playChime(880, 0.2), 120);

    const origTitle = document.title;
    if (!origTitle.startsWith('(@')) {
      document.title = `(@ Mention) ${origTitle}`;
      setTimeout(() => { document.title = origTitle; }, 4000);
    }
  }

  if (autoScroll || isMentioned) {
    requestAnimationFrame(() => scrollChatToBottom(Boolean(isMentioned)));
  }
}

function scrollChatToBottom(force = false) {
  const container = document.getElementById('chatMessages');
  if (container) {
    const isAtBottom = force || (container.scrollHeight - container.clientHeight <= container.scrollTop + 100);

    while (container.children.length > 200) {
      const removed = container.firstElementChild;
      if (removed && removed.dataset && removed.dataset.chatId) {
        state.renderedChatIds.delete(parseInt(removed.dataset.chatId, 10));
      }
      container.removeChild(removed);
    }

    if (isAtBottom) {
      const toggle = document.getElementById('autoScrollToggle');
      if (!toggle || toggle.checked) {
        container.scrollTop = container.scrollHeight;
      }
    }
  }
}

// ==================== CHAT EMOJI REACTIONS & PICKER ====================

const EMOJI_CATEGORIES = {
  football: ['⚽', '🥅', '🏆', '🥇', '🥈', '🥉', '🧤', '👟', '🔴', '⚪', '🟥', '🟨', '📣', '🏟️', '🎯', '⚡', '💪', '🦁'],
  reactions: ['🔥', '❤️', '👏', '😂', '🤣', '😍', '🤩', '🥳', '🤯', '😭', '😤', '💀', '💯', '👍', '👎', '👊', '🙌', '🤝'],
  smileys: ['😀', '😎', '🤐', '🧐', '🥱', '🥶', '🥵', '😱', '🤫', '😬', '🫠', '🤡', '👀', '🍿', '🍻', '🫡', '🙏', '🤷'],
  celebrate: ['🎉', '🎊', '✨', '🚀', '🌟', '💥', '🧨', '🍾', '🥂', '👑', '💣', '🪄', '🎩', '🛡️', '⚔️', '🐐', '❤️‍🔥', '🚩']
};

const QUICK_EMOJIS = ['🔥', '❤️', '⚽', '👏', '😂', '🏆', '🔴', '⚪', '👎', '🙌', '💯', '👀'];

let activeEmojiMessageId = null;

async function toggleChatReaction(messageId, emoji) {
  if (!state.sessionId) {
    openSessionPromptModal('new');
    return;
  }
  if (!messageId || !emoji) return;

  // Optimistic local update
  const msg = state.allChatMessages.find(m => m.id === Number(messageId));
  if (msg) {
    if (!msg.reactions) msg.reactions = {};
    if (!Array.isArray(msg.reactions[emoji])) msg.reactions[emoji] = [];
    const user = state.user?.handle || 'Me';
    const idx = msg.reactions[emoji].indexOf(user);
    if (idx > -1) {
      msg.reactions[emoji].splice(idx, 1);
      if (msg.reactions[emoji].length === 0) delete msg.reactions[emoji];
    } else {
      msg.reactions[emoji].push(user);
    }
    updateMessageReactionsInDOM(messageId, msg.reactions);
  }

  playChime(600, 0.05);

  try {
    const res = await fetch(`/api/chat/message/${messageId}/react`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-session-id': state.sessionId
      },
      body: JSON.stringify({ emoji })
    });
    if (res.ok) {
      const data = await res.json();
      if (data && data.reactions && msg) {
        msg.reactions = data.reactions;
        updateMessageReactionsInDOM(messageId, data.reactions);
      }
    }
  } catch (err) {
    console.warn('[Reaction] Error toggling reaction:', err);
  }
}

function initEmojiPicker() {
  const picker = document.getElementById('chatEmojiPicker');
  const closeBtn = document.getElementById('closeEmojiPickerBtn');
  const quickGrid = document.getElementById('quickEmojiGrid');
  const tabs = document.querySelectorAll('.emoji-tab-btn');

  if (!picker) return;

  // Render quick reaction buttons
  if (quickGrid) {
    quickGrid.innerHTML = QUICK_EMOJIS.map(em => `
      <button type="button" class="select-emoji-btn p-1.5 text-base hover:scale-125 transition bg-slate-800/60 hover:bg-slate-700/80 rounded-lg text-center cursor-pointer select-none" data-emoji="${em}">
        ${em}
      </button>
    `).join('');
  }

  // Render initial category
  renderCategoryEmojis('football');

  // Category tab clicks
  tabs.forEach(tab => {
    tab.addEventListener('click', (e) => {
      e.stopPropagation();
      const cat = tab.dataset.category;
      tabs.forEach(t => {
        t.className = 'emoji-tab-btn px-2 py-0.5 rounded-md text-slate-400 hover:bg-slate-800 shrink-0 cursor-pointer';
      });
      tab.className = 'emoji-tab-btn px-2 py-0.5 rounded-md bg-red-600/20 text-red-400 font-semibold border border-red-500/30 shrink-0 cursor-pointer';
      renderCategoryEmojis(cat);
    });
  });

  // Emoji click handler
  picker.addEventListener('click', (e) => {
    const btn = e.target.closest('.select-emoji-btn');
    if (btn && activeEmojiMessageId) {
      e.stopPropagation();
      const emoji = btn.dataset.emoji;
      toggleChatReaction(activeEmojiMessageId, emoji);
      closeEmojiPicker();
    }
  });

  closeBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    closeEmojiPicker();
  });

  // Click outside dismisses picker
  document.addEventListener('click', (e) => {
    if (!picker.classList.contains('hidden')) {
      if (!picker.contains(e.target) && !e.target.closest('.chat-react-btn')) {
        closeEmojiPicker();
      }
    }
  });
}

function renderCategoryEmojis(category) {
  const fullGrid = document.getElementById('fullEmojiGrid');
  if (!fullGrid) return;
  const list = EMOJI_CATEGORIES[category] || EMOJI_CATEGORIES.football;
  fullGrid.innerHTML = list.map(em => `
    <button type="button" class="select-emoji-btn p-1 text-base hover:scale-125 transition bg-slate-800/40 hover:bg-slate-700 rounded-lg text-center cursor-pointer select-none" data-emoji="${em}">
      ${em}
    </button>
  `).join('');
}

function openEmojiPicker(messageId, triggerBtn) {
  const picker = document.getElementById('chatEmojiPicker');
  if (!picker || !triggerBtn) return;

  activeEmojiMessageId = messageId;
  picker.classList.remove('hidden');

  // Position relative to trigger button inside rightSidebar container
  const sidebar = document.getElementById('rightSidebar');
  const container = picker.offsetParent || sidebar;
  if (container) {
    const parentRect = container.getBoundingClientRect();
    const btnRect = triggerBtn.getBoundingClientRect();
    
    // Position vertically near the message button
    let top = btnRect.top - parentRect.top - 230;
    if (top < 10) top = btnRect.bottom - parentRect.top + 6;
    if (top + 250 > parentRect.height) top = Math.max(10, parentRect.height - 260);

    picker.style.top = `${Math.round(top)}px`;
    picker.style.right = `12px`;
  }
}

function closeEmojiPicker() {
  const picker = document.getElementById('chatEmojiPicker');
  if (picker) {
    picker.classList.add('hidden');
  }
  activeEmojiMessageId = null;
}

function sendChatMessage(text) {
  if (!text || !text.trim()) return;

  if (!state.sessionId) {
    openSessionPromptModal('new');
    return;
  }

  const payload = {
    room: 'general',
    sessionId: state.sessionId,
    author: state.user.handle,
    author_flair: state.user.flair,
    badge_color: state.user.badgeColor,
    content: text.trim()
  };

  if (state.ws && state.ws.readyState === WebSocket.OPEN) {
    state.ws.send(JSON.stringify({
      type: 'chat',
      sessionId: state.sessionId,
      payload: payload
    }));
  } else {
    fetch('/api/chat/message', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-session-id': state.sessionId
      },
      body: JSON.stringify(payload)
    }).then(async (res) => {
      if (res.status === 401) {
        openSessionPromptModal('expired');
      }
    });
  }
}

// ==================== EVENT HANDLERS ====================

function initEventHandlers() {
  // 1. Tag filters
  document.querySelectorAll('.tag-filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tag = btn.dataset.tag;
      state.currentTag = tag;
      state.currentPage = 1;
      
      document.querySelectorAll('.tag-filter-btn').forEach(b => {
        const isWide = b.dataset.tag === 'All' || b.dataset.tag === 'Memes';
        b.className = `tag-filter-btn ${isWide ? 'col-span-2 ' : ''}flex items-center justify-between px-2 py-1.5 rounded-lg text-slate-300 hover:bg-slate-700/50 transition`;
      });
      const isWide = tag === 'All' || tag === 'Memes';
      btn.className = `tag-filter-btn ${isWide ? 'col-span-2 ' : ''}flex items-center justify-between px-2.5 py-1.5 rounded-lg font-medium bg-red-600/20 text-red-400 border border-red-500/30 transition`;

      const indicator = document.getElementById('activeTagIndicator');
      const tagName = document.getElementById('activeTagName');
      if (tag === 'All') {
        indicator?.classList.add('hidden');
      } else {
        indicator?.classList.remove('hidden');
        if (tagName) tagName.textContent = tag;
      }

      syncSearchTypeSelectUI(tag);
      loadPosts();
    });
  });
  document.getElementById('threadFilterSelect')?.addEventListener('change', (e) => {
    state.currentTag = e.target.value;
    state.currentPage = 1;
    syncSearchTypeSelectUI(e.target.value);
    loadPosts();
  });

  // Post Type dropdown inside search bar
  document.getElementById('forumSearchTypeSelect')?.addEventListener('change', (e) => {
    const selectedTag = e.target.value;
    state.currentTag = selectedTag;
    state.currentPage = 1;

    // Sync sidebar dropdown and tag indicator
    const threadFilterSelect = document.getElementById('threadFilterSelect');
    if (threadFilterSelect) threadFilterSelect.value = selectedTag;

    const indicator = document.getElementById('activeTagIndicator');
    const tagName = document.getElementById('activeTagName');
    if (selectedTag === 'All') {
      indicator?.classList.add('hidden');
    } else {
      indicator?.classList.remove('hidden');
      if (tagName) tagName.textContent = selectedTag;
    }

    syncSearchTypeSelectUI(selectedTag);
    loadPosts();
  });

  // Forum Search Input handler with 250ms debounce
  let searchDebounceTimer = null;
  const forumSearchInput = document.getElementById('forumSearchInput');
  const clearForumSearchBtn = document.getElementById('clearForumSearchBtn');
  const resetForumSearchLink = document.getElementById('resetForumSearchLink');

  forumSearchInput?.addEventListener('input', (e) => {
    const val = e.target.value;
    state.searchQuery = val;
    state.currentPage = 1;

    if (clearForumSearchBtn) {
      if (val.trim()) {
        clearForumSearchBtn.classList.remove('hidden');
      } else {
        clearForumSearchBtn.classList.add('hidden');
      }
    }

    if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(() => {
      loadPosts();
    }, 250);
  });

  forumSearchInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      clearForumSearch();
    }
  });

  clearForumSearchBtn?.addEventListener('click', () => {
    clearForumSearch();
  });

  resetForumSearchLink?.addEventListener('click', () => {
    clearForumSearch();
  });

  // Chat message action delegation: Quote, React, and Reaction Chips
  document.getElementById('chatMessages')?.addEventListener('click', (e) => {
    const quoteBtn = e.target.closest('.quote-chat-btn');
    if (quoteBtn) {
      e.stopPropagation();
      const author = quoteBtn.dataset.author;
      const content = quoteBtn.dataset.content;
      const chatInput = document.getElementById('chatInput');
      // Cursivate quoted text without blockquote indent prefix
      const quotedText = `_@${author}: ${content}_\n\n`;
      chatInput.value = quotedText + chatInput.value;
      chatInput.dispatchEvent(new Event('input'));
      chatInput.focus();
      return;
    }

    const reactBtn = e.target.closest('.chat-react-btn');
    if (reactBtn) {
      e.stopPropagation();
      const msgId = Number(reactBtn.dataset.msgId);
      openEmojiPicker(msgId, reactBtn);
      return;
    }

    const chipBtn = e.target.closest('.chat-reaction-chip');
    if (chipBtn) {
      e.stopPropagation();
      const msgId = Number(chipBtn.dataset.msgId);
      const emoji = chipBtn.dataset.emoji;
      if (msgId && emoji) {
        toggleChatReaction(msgId, emoji);
      }
      return;
    }
  });

  initEmojiPicker();

  document.getElementById('clearTagFilterBtn')?.addEventListener('click', () => {
    state.currentTag = 'All';
    state.currentPage = 1;
    document.querySelector('.tag-filter-btn[data-tag="All"]')?.click();
  });

  // 2. Pagination Controls (Zero-Scroll navigation)
  document.getElementById('prevPageBtn')?.addEventListener('click', () => {
    if (state.currentPage > 1) {
      state.currentPage--;
      renderPosts();
    }
  });

  document.getElementById('nextPageBtn')?.addEventListener('click', () => {
    const visiblePosts = getFilteredPosts();
    const totalPages = Math.max(1, Math.ceil(visiblePosts.length / (state.postsPerPage || 1)));
    if (state.currentPage < totalPages) {
      state.currentPage++;
      renderPosts();
    }
  });

  // 3. Create Post Modal
  const createPostModal = document.getElementById('createPostModal');
  let currentPostImageUrl = '';

  function resetCreatePostImageState() {
    currentPostImageUrl = '';
    const previewContainer = document.getElementById('postImagePreviewContainer');
    const previewImg = document.getElementById('postImagePreview');
    const fileInput = document.getElementById('postImageFileInput');
    const urlInput = document.getElementById('postImageUrlInput');
    if (previewContainer) previewContainer.classList.add('hidden');
    if (previewImg) previewImg.src = '';
    if (fileInput) fileInput.value = '';
    if (urlInput) urlInput.value = '';
    // Reset toggle to upload mode
    setImageUploadMode('upload');
  }

  function setImageUploadMode(mode) {
    const uploadWrapper = document.getElementById('imageUploadWrapper');
    const urlWrapper = document.getElementById('imageUrlWrapper');
    const uploadBtn = document.getElementById('imgModeUploadBtn');
    const urlBtn = document.getElementById('imgModeUrlBtn');

    if (mode === 'upload') {
      uploadWrapper?.classList.remove('hidden');
      urlWrapper?.classList.add('hidden');
      uploadBtn?.classList.add('bg-red-600', 'text-white');
      uploadBtn?.classList.remove('text-slate-400');
      urlBtn?.classList.remove('bg-red-600', 'text-white');
      urlBtn?.classList.add('text-slate-400');
    } else {
      uploadWrapper?.classList.add('hidden');
      urlWrapper?.classList.remove('hidden');
      urlBtn?.classList.add('bg-red-600', 'text-white');
      urlBtn?.classList.remove('text-slate-400');
      uploadBtn?.classList.remove('bg-red-600', 'text-white');
      uploadBtn?.classList.add('text-slate-400');
      document.getElementById('postImageUrlInput')?.focus();
    }
  }

  document.getElementById('imgModeUploadBtn')?.addEventListener('click', () => setImageUploadMode('upload'));
  document.getElementById('imgModeUrlBtn')?.addEventListener('click', () => setImageUploadMode('url'));

  // ==================== IMAGE RESIZE & COMPRESSION HELPERS ====================

  function askUserToResize(file) {
    return new Promise((resolve) => {
      const modal = document.getElementById('resizeConfirmModal');
      const sizeText = document.getElementById('resizeModalFileSizeText');
      const confirmBtn = document.getElementById('confirmResizeBtn');
      const cancelBtn = document.getElementById('cancelResizeBtn');

      const sizeFormatted = (file.size / (1024 * 1024)).toFixed(2);

      if (!modal) {
        const ok = confirm(`The selected image is ${sizeFormatted} MB, exceeding the 1MB limit. Would you like to automatically resize and scale it to fit under 1MB?`);
        resolve(ok);
        return;
      }

      if (sizeText) {
        sizeText.textContent = `Selected file size: ${sizeFormatted} MB`;
      }

      let settled = false;

      function cleanup() {
        settled = true;
        confirmBtn?.removeEventListener('click', onConfirm);
        cancelBtn?.removeEventListener('click', onCancel);
        modal.removeEventListener('close', onClose);
        if (modal.open) {
          modal.close();
        }
      }

      function onConfirm(e) {
        e.preventDefault();
        if (settled) return;
        cleanup();
        resolve(true);
      }

      function onCancel(e) {
        e.preventDefault();
        if (settled) return;
        cleanup();
        resolve(false);
      }

      function onClose() {
        if (settled) return;
        cleanup();
        resolve(false);
      }

      confirmBtn?.addEventListener('click', onConfirm, { once: true });
      cancelBtn?.addEventListener('click', onCancel, { once: true });
      modal.addEventListener('close', onClose, { once: true });

      initLucide();
      modal.showModal();
    });
  }

  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  function loadImageFromFile(file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const objectUrl = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(objectUrl);
        resolve(img);
      };
      img.onerror = (err) => {
        URL.revokeObjectURL(objectUrl);
        reject(err);
      };
      img.src = objectUrl;
    });
  }

  async function scaleImageTo1MB(file) {
    const MAX_TARGET_BYTES = 1000000; // Target comfortably below 1,048,576 bytes
    const img = await loadImageFromFile(file);

    let width = img.naturalWidth || img.width;
    let height = img.naturalHeight || img.height;

    const maxDim = 2560;
    if (width > maxDim || height > maxDim) {
      const ratio = Math.min(maxDim / width, maxDim / height);
      width = Math.round(width * ratio);
      height = Math.round(height * ratio);
    }

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    let currentScale = 1.0;
    let bestBlob = null;
    const qualitySteps = [0.92, 0.85, 0.78, 0.70, 0.60];

    for (let attempt = 0; attempt < 6; attempt++) {
      const currentW = Math.max(320, Math.round(width * currentScale));
      const currentH = Math.max(240, Math.round(height * currentScale));
      canvas.width = currentW;
      canvas.height = currentH;
      ctx.clearRect(0, 0, currentW, currentH);
      ctx.drawImage(img, 0, 0, currentW, currentH);

      for (const q of qualitySteps) {
        const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', q));
        if (blob && blob.size <= MAX_TARGET_BYTES) {
          bestBlob = blob;
          break;
        }
      }

      if (bestBlob) break;
      currentScale *= 0.75;
    }

    if (!bestBlob || bestBlob.size > MAX_TARGET_BYTES) {
      canvas.width = Math.max(320, Math.round(width * 0.4));
      canvas.height = Math.max(240, Math.round(height * 0.4));
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      bestBlob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', 0.55));
    }

    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(bestBlob);
    });

    return {
      dataUrl,
      blob: bestBlob,
      size: bestBlob.size
    };
  }

  // File picker handler: read file as Base64 data URL with auto-resize prompt for > 1MB
  document.getElementById('postImageFileInput')?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    let finalDataUrl = '';
    if (file.size > 1048576) {
      const userAgreed = await askUserToResize(file);
      if (!userAgreed) {
        e.target.value = '';
        return;
      }
      try {
        const scaled = await scaleImageTo1MB(file);
        finalDataUrl = scaled.dataUrl;
      } catch (err) {
        console.error('Resize failed:', err);
        alert('Could not resize image. Please try a different image.');
        e.target.value = '';
        return;
      }
    } else {
      finalDataUrl = await readFileAsDataUrl(file);
    }

    currentPostImageUrl = finalDataUrl;
    const previewContainer = document.getElementById('postImagePreviewContainer');
    const previewImg = document.getElementById('postImagePreview');
    if (previewContainer && previewImg) {
      previewImg.src = currentPostImageUrl;
      previewContainer.classList.remove('hidden');
    }
  });

  // Drag and drop support for post image upload
  const postDropzone = document.getElementById('imageUploadWrapper');
  if (postDropzone) {
    ['dragenter', 'dragover'].forEach(eventName => {
      postDropzone.addEventListener(eventName, (e) => {
        e.preventDefault();
        e.stopPropagation();
        postDropzone.classList.add('border-red-500', 'bg-slate-900/90');
      });
    });
    ['dragleave', 'drop'].forEach(eventName => {
      postDropzone.addEventListener(eventName, (e) => {
        e.preventDefault();
        e.stopPropagation();
        postDropzone.classList.remove('border-red-500', 'bg-slate-900/90');
      });
    });
    postDropzone.addEventListener('drop', async (e) => {
      const files = e.dataTransfer?.files;
      if (!files || files.length === 0) return;
      const file = files[0];
      if (!file.type.startsWith('image/')) {
        alert('Please choose an image file (PNG, JPG, WebP, GIF).');
        return;
      }

      let finalDataUrl = '';
      if (file.size > 1048576) {
        const userAgreed = await askUserToResize(file);
        if (!userAgreed) return;
        try {
          const scaled = await scaleImageTo1MB(file);
          finalDataUrl = scaled.dataUrl;
        } catch (err) {
          console.error('Resize failed:', err);
          alert('Could not resize image. Please try a different image.');
          return;
        }
      } else {
        finalDataUrl = await readFileAsDataUrl(file);
      }

      currentPostImageUrl = finalDataUrl;
      const previewContainer = document.getElementById('postImagePreviewContainer');
      const previewImg = document.getElementById('postImagePreview');
      if (previewContainer && previewImg) {
        previewImg.src = currentPostImageUrl;
        previewContainer.classList.remove('hidden');
      }
    });
  }

  // URL input handler with debounce
  document.getElementById('postImageUrlInput')?.addEventListener('input', (e) => {
    const url = e.target.value.trim();
    const previewContainer = document.getElementById('postImagePreviewContainer');
    const previewImg = document.getElementById('postImagePreview');
    if (url.startsWith('http://') || url.startsWith('https://')) {
      currentPostImageUrl = url;
      if (previewContainer && previewImg) {
        previewImg.src = url;
        previewContainer.classList.remove('hidden');
      }
    } else if (!url) {
      currentPostImageUrl = '';
      if (previewContainer) previewContainer.classList.add('hidden');
    }
  });

  // Remove preview button
  document.getElementById('removePostImageBtn')?.addEventListener('click', () => {
    resetCreatePostImageState();
  });

  document.getElementById('openCreatePostBtn')?.addEventListener('click', () => {
    if (!state.sessionId) {
      openSessionPromptModal('new');
      return;
    }
    resetCreatePostImageState();
    createPostModal.showModal();
    initLucide();
  });
  document.getElementById('closeCreatePostModalBtn')?.addEventListener('click', () => {
    resetCreatePostImageState();
    createPostModal.close();
  });
  document.getElementById('cancelPostBtn')?.addEventListener('click', () => {
    resetCreatePostImageState();
    createPostModal.close();
  });

  document.getElementById('createPostForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!state.sessionId) {
      openSessionPromptModal('new');
      return;
    }

    const title = document.getElementById('postTitleInput').value.trim();
    const tag = document.getElementById('postTagInput').value;
    const content = document.getElementById('postContentInput').value.trim();
    const submitBtn = document.getElementById('submitPostBtn');

    if (!title || !content) return;

    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.classList.add('opacity-50');
      submitBtn.innerHTML = `<span>Publishing...</span>`;
    }

    try {
      let finalImageUrl = currentPostImageUrl;

      // If user uploaded a local file (base64 Data URI), upload to server to get permanent URL
      if (currentPostImageUrl && currentPostImageUrl.startsWith('data:image/')) {
        try {
          // Convert Data URI to Blob
          const response = await fetch(currentPostImageUrl);
          const blob = await response.blob();
          const formData = new FormData();
          formData.append('image', blob, 'post.jpg');

          const uploadRes = await fetch('/api/upload', {
            method: 'POST',
            headers: {
              'x-session-id': state.sessionId
            },
            body: formData
          });
          if (!uploadRes.ok) {
            const errData = await uploadRes.json().catch(() => ({}));
            alert(errData.error || errData.detail || 'Image upload failed. Please ensure the image is under 1MB and try again.');
            return;
          }
          const uploadData = await uploadRes.json();
          if (!uploadData || !uploadData.url) {
            alert('Image upload failed. Please try again.');
            return;
          }
          finalImageUrl = uploadData.url;
        } catch (uploadErr) {
          console.error('Image upload failed:', uploadErr);
          alert('Failed to upload image. Please check your network connection and try again.');
          return;
        }
      }

      const res = await fetch('/api/posts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-session-id': state.sessionId
        },
        body: JSON.stringify({
          title,
          content,
          tag,
          image_url: finalImageUrl,
          session_id: state.sessionId
        })
      });

      if (res.ok) {
        const createdPost = await res.json().catch(() => null);
        if (createdPost && createdPost.id) {
          createdPost.is_unread = false;
          createdPost.unread_comments_count = 0;
          markPostAsReadLocally(createdPost.id, 0);
          state.posts = state.posts.filter(p => p.id !== createdPost.id);
          state.posts.unshift(createdPost);
          try {
            localStorage.setItem('fansphere_cached_posts', JSON.stringify(state.posts));
          } catch {}
          if (state.selectedRealm !== 'All' && !matchClubRealm(createdPost.author_flair, getEffectiveRealm())) {
            setRealmFilter('All');
          } else {
            renderPosts();
          }
        }
        document.getElementById('createPostForm').reset();
        resetCreatePostImageState();
        createPostModal.close();
        await loadPosts();
        playChime(659.25, 0.15);
      } else if (res.status === 401) {
        openSessionPromptModal('expired');
      }
    } catch (err) {
      console.error('Failed to create post', err);
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.classList.remove('opacity-50');
        submitBtn.innerHTML = `<span>Publish Post</span>`;
      }
    }
  });

  // Lightbox Modal helpers
  const lightboxModal = document.getElementById('imageLightboxModal');
  const lightboxImg = document.getElementById('lightboxImage');
  const lightboxCaption = document.getElementById('lightboxCaption');
  const closeLightboxBtn = document.getElementById('closeLightboxBtn');

  window.openImageLightbox = function(src, caption = 'Post Image') {
    if (!lightboxModal || !lightboxImg) return;
    lightboxImg.src = src;
    if (lightboxCaption) lightboxCaption.textContent = caption;
    lightboxModal.showModal();
  };

  closeLightboxBtn?.addEventListener('click', () => {
    lightboxModal?.close();
  });
  lightboxModal?.addEventListener('click', (e) => {
    if (e.target === lightboxModal) {
      lightboxModal.close();
    }
  });

  // 4. Post Detail Modal Close & Comment Submit
  const postDetailModal = document.getElementById('postDetailModal');
  document.getElementById('closeDetailModalBtn')?.addEventListener('click', () => {
    postDetailModal.close();
    state.activePostDetailId = null;
  });
  postDetailModal?.addEventListener('close', () => {
    state.activePostDetailId = null;
  });

    let currentCommentImageUrl = '';

    function resetCommentImageState() {
      currentCommentImageUrl = '';
      const previewWrapper = document.getElementById('commentImagePreviewWrapper');
      const previewImg = document.getElementById('commentImagePreview');
      const fileInput = document.getElementById('commentImageFileInput');
      const urlInput = document.getElementById('commentImageUrlInput');
      const urlWrapper = document.getElementById('commentUrlInputWrapper');
      if (previewWrapper) previewWrapper.classList.add('hidden');
      if (previewImg) previewImg.src = '';
      if (fileInput) fileInput.value = '';
      if (urlInput) urlInput.value = '';
      if (urlWrapper) urlWrapper.classList.add('hidden');
    }

    // Toggle comment URL input
    document.getElementById('toggleCommentUrlBtn')?.addEventListener('click', () => {
      const urlWrapper = document.getElementById('commentUrlInputWrapper');
      const urlInput = document.getElementById('commentImageUrlInput');
      if (!urlWrapper) return;
      if (urlWrapper.classList.contains('hidden')) {
        urlWrapper.classList.remove('hidden');
        urlInput?.focus();
      } else {
        urlWrapper.classList.add('hidden');
      }
    });

    // Handle Comment Image File Input with auto-resize prompt for > 1MB
    document.getElementById('commentImageFileInput')?.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;

      let finalDataUrl = '';
      if (file.size > 1048576) {
        const userAgreed = await askUserToResize(file);
        if (!userAgreed) {
          e.target.value = '';
          return;
        }
        try {
          const scaled = await scaleImageTo1MB(file);
          finalDataUrl = scaled.dataUrl;
        } catch (err) {
          console.error('Resize failed:', err);
          alert('Could not resize image. Please try a different image.');
          e.target.value = '';
          return;
        }
      } else {
        finalDataUrl = await readFileAsDataUrl(file);
      }

      currentCommentImageUrl = finalDataUrl;
      const previewWrapper = document.getElementById('commentImagePreviewWrapper');
      const previewImg = document.getElementById('commentImagePreview');
      if (previewWrapper && previewImg) {
        previewImg.src = currentCommentImageUrl;
        previewWrapper.classList.remove('hidden');
      }
    });

    // Handle Comment Image URL Input
    document.getElementById('commentImageUrlInput')?.addEventListener('input', (e) => {
      const val = e.target.value.trim();
      const previewWrapper = document.getElementById('commentImagePreviewWrapper');
      const previewImg = document.getElementById('commentImagePreview');
      if (val.startsWith('http://') || val.startsWith('https://')) {
        currentCommentImageUrl = val;
        if (previewWrapper && previewImg) {
          previewImg.src = val;
          previewWrapper.classList.remove('hidden');
        }
      } else if (!val) {
        currentCommentImageUrl = '';
        if (previewWrapper) previewWrapper.classList.add('hidden');
      }
    });

    // Remove Comment Image button
    document.getElementById('removeCommentImageBtn')?.addEventListener('click', () => {
      resetCommentImageState();
    });

    document.getElementById('addCommentForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!state.sessionId) {
        openSessionPromptModal('new');
        return;
      }

      const input = document.getElementById('commentTextInput');
      const content = input.value.trim();
      const submitBtn = document.getElementById('submitCommentBtn');
      if (!content || !state.activePostDetailId) return;

      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.classList.add('opacity-50');
      }

      try {
        let finalCommentImg = currentCommentImageUrl;

        // If local data URI was chosen, upload to server first
        if (currentCommentImageUrl && currentCommentImageUrl.startsWith('data:image/')) {
          try {
            // Convert Data URI to Blob
            const response = await fetch(currentCommentImageUrl);
            const blob = await response.blob();
            const formData = new FormData();
            formData.append('image', blob, 'comment.jpg');

            const uploadRes = await fetch('/api/upload', {
              method: 'POST',
              headers: {
                'x-session-id': state.sessionId
              },
              body: formData
            });

            if (!uploadRes.ok) {
              const errData = await uploadRes.json().catch(() => ({}));
              alert(errData.error || errData.detail || 'Comment image upload failed. Please ensure the image is under 1MB and try again.');
              return;
            }
            const uploadData = await uploadRes.json();
            if (!uploadData || !uploadData.url) {
              alert('Comment image upload failed. Please try again.');
              return;
            }
            finalCommentImg = uploadData.url;
          } catch (uploadErr) {
            console.error('Comment image upload to server failed:', uploadErr);
            alert('Failed to upload comment image. Please try again.');
            return;
          }
        }

        const res = await fetch(`/api/posts/${state.activePostDetailId}/comments`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-session-id': state.sessionId
          },
          body: JSON.stringify({
            content,
            image_url: finalCommentImg,
            session_id: state.sessionId
          })
        });

        if (res.ok) {
          const createdComment = await res.json().catch(() => null);
          input.value = '';
          resetCommentImageState();
          playChime(587.33, 0.08);
          if (createdComment) {
            handleIncomingNewComment(createdComment);
          }
        } else if (res.status === 401) {
          openSessionPromptModal('expired');
        }
      } catch (err) {
        console.error(err);
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.classList.remove('opacity-50');
        }
      }
    });

  // 5. User Profile Modal & Session Form
  const profileModal = document.getElementById('userProfileModal');
  document.getElementById('openProfileModalBtn')?.addEventListener('click', () => {
    if (!state.sessionId && !state.user.handle) {
      openSessionPromptModal('new');
      return;
    }
    initUserProfile(true); // Explicitly load current session values on modal open
    profileModal.showModal();
  });


  // Explicit Edit buttons for Nickname and Email
  document.getElementById('closeProfileModalBtn')?.addEventListener('click', () => {
    profileModal.close();
  });
  document.getElementById('logoutBtn')?.addEventListener('click', async () => {
    if (state.sessionId) {
      try {
        await fetch('/api/auth/session/logout', {
          method: 'POST',
          headers: { 'x-session-id': state.sessionId }
        });
      } catch (err) {
        console.error('Logout error', err);
      }
    }
    
    profileModal.close();
    state.sessionId = null;
    state.session = null;
    state.selectedRealm = null;
    localStorage.removeItem('fansphere_session_id');
    localStorage.removeItem('fansphere_realm');
    if (state.ws) {
      try { state.ws.close(); } catch {}
      state.ws = null;
    }
    updateGateState();
    console.log('Reloading page from logout');
    window.location.reload(); // Ensure full reset
  });

  // Unified session persistence function for both blur auto-save and explicit form submit
  async function persistProfileSessionChanges(options = { closeOnSuccess: false, isBlur: false }) {
    const handleDisplay = document.getElementById('profileHandleDisplay');
    const emailDisplay = document.getElementById('profileEmailDisplay');
    const flairInput = document.getElementById('profileFlairInput');
    const errEl = document.getElementById('profileError');
    const successEl = document.getElementById('profileSuccess');
    const saveBtn = document.getElementById('saveProfileBtn');
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!handleDisplay || !emailDisplay) return false;
    const newHandle = handleDisplay.textContent.trim();
    const newEmail = emailDisplay.textContent.trim();
    const newFlair = flairInput ? normalizeFlair(flairInput.value) : normalizeFlair(state.user.flair);


    if (newFlair) {
      const prevFlair = state.user.flair;
      state.user.flair = newFlair;
      localStorage.setItem('fansphere_flair', newFlair);
      if (prevFlair !== newFlair && state.selectedRealm === 'user_club') {
        renderPosts();
        renderChatStream();
      }
    }

    // Build the payload with whatever changed fields are valid
    const payload = {};
    if (newHandle.length >= 2 && newHandle.length <= 30 && (!state.session || newHandle !== state.session.nickname)) {
      payload.nickname = newHandle;
    }
    if (emailRegex.test(newEmail) && (!state.session || newEmail !== state.session.email)) {
      payload.email = newEmail;
    }
    if (newFlair && (!state.session || newFlair !== state.session.flair)) {
      payload.flair = newFlair;
    }


    // If nothing changed to update on server, exit cleanly
    if (Object.keys(payload).length === 0) {
      if (options.closeOnSuccess) {
        if (profileModal && profileModal.open) {
          profileModal.close();
        }
      }
      return true;
    }

    if (!options.isBlur) {
      // Explicit submission validation
      if (errEl) errEl.classList.add('hidden');
      if (successEl) successEl.classList.add('hidden');

      if (newHandle.length < 2 || newHandle.length > 30) {
        if (errEl) {
          errEl.textContent = 'Nickname must be between 2 and 30 characters';
          errEl.classList.remove('hidden');
        }
        return false;
      }

      if (!emailRegex.test(newEmail)) {
        if (errEl) {
          errEl.textContent = 'Please enter a valid email address';
          errEl.classList.remove('hidden');
        }
        return false;
      }


      if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.textContent = 'Saving...';
      }
    }

    // Ensure all required fields exist for new session creation if needed
    if (!payload.nickname) payload.nickname = newHandle || state.user.handle || 'GuestFan';
    if (!payload.email) payload.email = emailRegex.test(newEmail) ? newEmail : (state.user.email || 'fan@arsenalfinland.fi');
    if (!payload.flair) payload.flair = newFlair;

    try {
      let res;
      if (state.sessionId) {
        res = await fetch('/api/auth/session', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-session-id': state.sessionId
          },
          body: JSON.stringify(payload)
        });
      } else {
        res = await fetch('/api/auth/session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
      }

      // If session was expired on server, seamlessly re-create session
      if (!res.ok && res.status === 401) {
        res = await fetch('/api/auth/session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            nickname: newHandle || 'GuestFan',
            email: emailRegex.test(newEmail) ? newEmail : 'fan@arsenalfinland.fi',
            flair: newFlair
          })
        });
      }

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || 'Failed to update session info');
      }

      const data = await res.json();
      applySession(data.session);
      updateOnlinePresence(data.online_count, data.active_nicknames);

      // Re-authenticate WebSocket if open
      if (state.ws && state.ws.readyState === WebSocket.OPEN) {
        state.ws.send(JSON.stringify({ type: 'auth', sessionId: data.session.id }));
      }

      if (successEl) {
        successEl.textContent = `✅ Saved to session (${data.session.nickname})`;
        successEl.classList.remove('hidden');
      }

      if (options.closeOnSuccess) {
        playChime(659.25, 0.08);
        setTimeout(() => {
          if (profileModal && profileModal.open) {
            profileModal.close();
          }
          if (successEl) successEl.classList.add('hidden');
        }, 600);
      } else {
        setTimeout(() => {
          if (successEl) successEl.classList.add('hidden');
        }, 2500);
      }
      return true;

    } catch (err) {
      console.error('Profile update error', err);
      if (!options.isBlur && errEl) {
        errEl.textContent = err.message || 'Error updating session info';
        errEl.classList.remove('hidden');
      }
      return false;
    } finally {
      if (!options.isBlur && saveBtn) {
        saveBtn.disabled = false;
        saveBtn.textContent = '💾 Save Changes';
      }
    }
  }

  // Auto-save immediately when focus is lost (blur) or dropdown changed
  document.getElementById('profileHandleInput')?.addEventListener('blur', () => {
    persistProfileSessionChanges({ closeOnSuccess: false, isBlur: true });
  });

  document.getElementById('profileEmailInput')?.addEventListener('blur', () => {
    persistProfileSessionChanges({ closeOnSuccess: false, isBlur: true });
  });

  document.getElementById('profileFlairInput')?.addEventListener('change', (e) => {
    setRealmFilter(e.target.value);
    persistProfileSessionChanges({ closeOnSuccess: false, isBlur: true });
  });

  // Explicit Form Submission
  document.getElementById('profileForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    await persistProfileSessionChanges({ closeOnSuccess: true, isBlur: false });
  });

  // 6. Welcome / Session Prompt Form Submission
  document.getElementById('sessionPromptForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const nickInput = document.getElementById('sessionNicknameInput');
    const emailInput = document.getElementById('sessionEmailInput');
    const flairInput = document.getElementById('sessionFlairInput');
    const errEl = document.getElementById('sessionPromptError');
    const submitBtn = document.getElementById('submitSessionBtn');

    if (!nickInput || !emailInput) return;

    const nickname = nickInput.value.trim();
    const email = emailInput.value.trim();
    const flair = flairInput ? normalizeFlair(flairInput.value) : 'Arsenal Finland Official Member';

    if (nickname.length < 2) {
      if (errEl) {
        errEl.textContent = 'Nickname must be at least 2 characters';
        errEl.classList.remove('hidden');
      }
      return;
    }

    if (!email.includes('@') || !email.includes('.')) {
      if (errEl) {
        errEl.textContent = 'Please enter a valid email address';
        errEl.classList.remove('hidden');
      }
      return;
    }

    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.innerHTML = '<span>Connecting...</span>';
    }

    try {
      const res = await fetch('/api/auth/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nickname, email, flair })
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || 'Failed to create session');
      }

      const data = await res.json();
      applySession(data.session);
      updateOnlinePresence(data.online_count, data.active_nicknames);

      if (errEl) errEl.classList.add('hidden');
      playChime(659.25, 0.1);
    } catch (err) {
      if (errEl) {
        errEl.textContent = err.message || 'Error creating session';
        errEl.classList.remove('hidden');
      }
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = `<span>Enter Fansphere</span><i data-lucide="arrow-right" class="w-4 h-4"></i>`;
        initLucide();
      }
    }
  });

  // 6b. Main Session & Realm Gate Form Submission
  document.getElementById('gateForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const nickInput = document.getElementById('gateNicknameInput');
    const emailInput = document.getElementById('gateEmailInput');
    const realmInput = document.getElementById('gateRealmInput');
    const errBox = document.getElementById('gateError');
    const errText = document.getElementById('gateErrorText');
    const submitBtn = document.getElementById('gateSubmitBtn');

    if (!nickInput || !emailInput || !realmInput) return;

    const nickname = nickInput.value.trim();
    const email = emailInput.value.trim();
    const flair = realmInput.value.trim();

    if (errBox) errBox.classList.add('hidden');

    if (nickname.length < 2) {
      if (errBox && errText) {
        errText.textContent = 'Nickname must be at least 2 characters';
        errBox.classList.remove('hidden');
      }
      return;
    }

    if (!email.includes('@') || !email.includes('.')) {
      if (errBox && errText) {
        errText.textContent = 'Please enter a valid email address';
        errBox.classList.remove('hidden');
      }
      return;
    }

    if (!flair) {
      if (errBox && errText) {
        errText.textContent = 'Please select your Club Realm';
        errBox.classList.remove('hidden');
      }
      return;
    }

    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.innerHTML = '<span>Entering Fansphere...</span>';
    }

    try {
      const res = await fetch('/api/auth/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nickname, email, flair })
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.detail || 'Failed to create session');
      }

      state.selectedRealm = flair;
      localStorage.setItem('fansphere_realm', flair);
      applySession(data.session);
      updateGateState();
      playChime(523.25, 0.2);

      loadCachedData();
      connectWebSocket();
      await Promise.all([
        loadPosts(),
        loadChatHistory()
      ]);
    } catch (err) {
      if (errBox && errText) {
        errText.textContent = err.message || 'Error joining community';
        errBox.classList.remove('hidden');
      }
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = `<span>Enter Fansphere</span><i data-lucide="arrow-right" class="w-4 h-4"></i>`;
        initLucide();
      }
    }
  });

  // 6. Chat Input & Quick Reaction Buttons
  const chatForm = document.getElementById('chatForm');
  const chatInput = document.getElementById('chatInput');

  const autoResizeChatInput = () => {
    if (!chatInput) return;
    chatInput.style.height = 'auto';
    chatInput.style.height = Math.min(chatInput.scrollHeight, 120) + 'px';
  };

  chatInput?.addEventListener('input', autoResizeChatInput);

  chatInput?.addEventListener('keydown', (e) => {
    // If mention popup is active, allow arrow/enter/tab navigation without submitting the form
    const mentionPopup = document.getElementById('mentionAutocompletePopup');
    if (mentionPopup && !mentionPopup.classList.contains('hidden')) {
      if (['Enter', 'Tab', 'ArrowUp', 'ArrowDown', 'Escape'].includes(e.key)) {
        return;
      }
    }

    // Enter sends message directly without creating a new line; Shift+Enter creates a new line
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const text = chatInput.value.trim();
      if (text) {
        if (typeof chatForm?.requestSubmit === 'function') {
          chatForm.requestSubmit();
        } else {
          chatForm?.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
        }
      }
    }
  });

  chatForm?.addEventListener('submit', (e) => {
    e.preventDefault();
    const mentionPopup = document.getElementById('mentionAutocompletePopup');
    if (mentionPopup) mentionPopup.classList.add('hidden');
    const text = chatInput.value.trim();
    if (text) {
      sendChatMessage(text);
      chatInput.value = '';
      chatInput.style.height = '';
    }
  });

  document.querySelectorAll('.chat-quick-emoji').forEach(btn => {
    btn.addEventListener('click', () => {
      const emoji = btn.dataset.emoji;
      sendChatMessage(emoji);
    });
  });
}

// Mobile Tab Switcher
function initMobileTabs() {
  const tabForum = document.getElementById('mobileTabForum');
  const tabChat = document.getElementById('mobileTabChat');
  const forumSection = document.getElementById('centerForum');
  const rightSidebar = document.getElementById('rightSidebar');

  // Enforce initial mobile portrait & landscape state
  if (window.innerWidth < 1024) {
    forumSection?.classList.remove('hidden');
    forumSection?.classList.add('flex');
    rightSidebar?.classList.add('hidden');
    rightSidebar?.classList.remove('flex');
    if (tabForum && tabChat) setActiveTab(tabForum, [tabChat]);
  } else {
    forumSection?.classList.remove('hidden');
    forumSection?.classList.add('flex');
    rightSidebar?.classList.remove('hidden');
    rightSidebar?.classList.add('flex');
  }

  tabForum?.addEventListener('click', () => {
    forumSection?.classList.remove('hidden');
    forumSection?.classList.add('flex');
    rightSidebar?.classList.add('hidden');
    rightSidebar?.classList.remove('flex');
    setActiveTab(tabForum, [tabChat]);
    renderPosts();
  });

  tabChat?.addEventListener('click', () => {
    forumSection?.classList.add('hidden');
    forumSection?.classList.remove('flex');
    rightSidebar?.classList.remove('hidden');
    rightSidebar?.classList.add('flex');
    scrollChatToBottom();
    setActiveTab(tabChat, [tabForum]);
  });

  function setActiveTab(active, inactives) {
    active.className = 'flex-1 py-1.5 px-3 rounded-lg text-center text-red-400 bg-slate-800 flex items-center justify-center gap-1.5 transition shadow-sm';
    inactives.forEach(inact => {
      inact.className = 'flex-1 py-1.5 px-3 rounded-lg text-center text-slate-400 flex items-center justify-center gap-1.5 transition';
    });
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function escapeJsString(str) {
  if (!str) return '';
  return String(str)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '');
}

/**
 * Lightweight Markdown Parser
 * Formats:
 * - Blockquotes: > quote -> indented, cursivated blockquote
 * - Bold: **text**
 * - Italics: _text_ or *text*
 * - Inline Code: `code`
 * - Strikethrough: ~~text~~
 * - Links: https://...
 */
function formatLightweightMarkdown(rawText) {
  if (!rawText) return '';
  // 1. Sanitize to prevent XSS & trim excessive empty lines
  const cleanRaw = rawText.trim().replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n');
  const text = escapeHtml(cleanRaw);

  // 2. Parse blockquotes line by line
  const lines = text.split('\n');
  const processedLines = [];
  let currentQuote = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('&gt;')) {
      const quoteText = trimmed.replace(/^&gt;\s?/, '');
      currentQuote.push(quoteText);
    } else {
      if (currentQuote.length > 0) {
        processedLines.push(`<blockquote class="border-l-2 border-red-500/80 pl-2 py-0.5 my-0.5 text-slate-300 italic bg-slate-800/40 rounded-r text-[11px] leading-snug">${currentQuote.join('<br>')}</blockquote>`);
        currentQuote = [];
      }
      processedLines.push(line);
    }
  }
  if (currentQuote.length > 0) {
    processedLines.push(`<blockquote class="border-l-2 border-red-500/80 pl-2 py-0.5 my-0.5 text-slate-300 italic bg-slate-800/40 rounded-r text-[11px] leading-snug">${currentQuote.join('<br>')}</blockquote>`);
  }

  let formatted = processedLines.join('\n');

  // 3. Bold: **text**
  formatted = formatted.replace(/\*\*([^*\n]+)\*\*/g, '<strong class="font-bold text-slate-100">$1</strong>');

  // 4. Italics: _text_ and *text*
  formatted = formatted.replace(/(^|[^\w])_([^_]+)_(?=[^\w]|$)/g, '$1<em class="italic text-slate-200 font-normal">$2</em>');
  formatted = formatted.replace(/(^|[^\w])\*([^*\n]+)\*(?=[^\w]|$)/g, '$1<em class="italic text-slate-200 font-normal">$2</em>');

  // 5. Inline code: `code`
  formatted = formatted.replace(/`([^`\n]+)`/g, '<code class="bg-slate-800 text-red-300 px-1 py-0.5 rounded text-[10.5px] font-mono border border-slate-700/60">$1</code>');

  // 6. Strikethrough: ~~text~~
  formatted = formatted.replace(/~~([^~\n]+)~~/g, '<del class="line-through text-slate-500">$1</del>');

  // 7. Auto-link URLs
  formatted = formatted.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer" class="text-red-400 hover:text-red-300 underline underline-offset-2 break-all">$1</a>');

  // 8. Mentions: @Username
  formatted = formatted.replace(/(^|\s)@([a-zA-Z0-9_\-\.\u00C0-\u017F]+)/g, (match, prefix, username) => {
    return `${prefix}<span class="chat-mention inline-flex items-center gap-0.5 px-1.5 py-0.2 rounded-md font-bold text-amber-300 bg-amber-950/60 border border-amber-800/60 hover:bg-amber-900/60 transition cursor-pointer select-none" data-mention="${username}" title="Mention: @${username}">@${username}</span>`;
  });

  return formatted;
}

// Window & container resize handlers to keep feed container filled and pagination optimal
let feedResizeTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(feedResizeTimer);
  feedResizeTimer = setTimeout(() => {
    const isDesktop = window.innerWidth >= 1024;
    const forumSection = document.getElementById('centerForum');
    const rightSidebar = document.getElementById('rightSidebar');
    if (isDesktop) {
      forumSection?.classList.remove('hidden');
      forumSection?.classList.add('flex');
      rightSidebar?.classList.remove('hidden');
      rightSidebar?.classList.add('flex');
    } else {
      const tabChat = document.getElementById('mobileTabChat');
      const isChatActive = tabChat?.classList.contains('text-red-400');
      if (isChatActive) {
        forumSection?.classList.add('hidden');
        forumSection?.classList.remove('flex');
        rightSidebar?.classList.remove('hidden');
        rightSidebar?.classList.add('flex');
      } else {
        forumSection?.classList.remove('hidden');
        forumSection?.classList.add('flex');
        rightSidebar?.classList.add('hidden');
        rightSidebar?.classList.remove('flex');
      }
    }
    if (state.posts && state.posts.length > 0) {
      renderPosts();
    }
  }, 120);
});

if (typeof ResizeObserver !== 'undefined') {
  const centerForum = document.getElementById('centerForum');
  if (centerForum) {
    let lastForumHeight = Math.round(centerForum.clientHeight);
    let roTimer = null;
    const ro = new ResizeObserver(entries => {
      for (const entry of entries) {
        const currentHeight = Math.round(entry.contentRect.height);
        // Only trigger on substantial outer viewport changes, ignoring small card micro-adjustments
        if (Math.abs(currentHeight - lastForumHeight) > 35) {
          lastForumHeight = currentHeight;
          clearTimeout(roTimer);
          roTimer = setTimeout(() => {
            if (state.posts && state.posts.length > 0) {
              renderPosts();
            }
          }, 150);
        }
      }
    });
    ro.observe(centerForum);
  }
}

// ==================== PWA INSTALL & SERVICE WORKER ====================
let deferredInstallPrompt = null;

function initPWA() {
  const installBtn = document.getElementById('pwaInstallBtn');
  const offlineIndicator = document.getElementById('offlineIndicator');
  const iosModal = document.getElementById('pwaIosModal');
  const closeIosBtn = document.getElementById('closePwaIosModalBtn');
  const dismissIosBtn = document.getElementById('dismissPwaIosModalBtn');

  // Detect standalone mode (already running as installed app on home screen or desktop window)
  const isStandalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: fullscreen)').matches ||
    window.matchMedia('(display-mode: minimal-ui)').matches ||
    window.navigator.standalone === true ||
    document.referrer.includes('android-app://');

  // Detect iOS Safari device
  const userAgent = window.navigator.userAgent.toLowerCase();
  const isIOS = /iphone|ipad|ipod/.test(userAgent) && !window.MSStream;

  // 1. Service Worker Registration & Platform Update Lifecycle
  let swRegistration = null;
  let refreshing = false;
  let initialBuildTime = null;

  const updateBanner = document.getElementById('pwaUpdateBanner');
  const updateNowBtn = document.getElementById('pwaUpdateNowBtn');
  const dismissUpdateBtn = document.getElementById('pwaDismissUpdateBtn');

  function showUpdateBanner(worker) {
    if (!updateBanner) return;
    // The PWA update banner should only be shown for installed PWA / standalone users, NOT regular web browser users
    if (!isStandalone) {
      return;
    }
    if (sessionStorage.getItem('fansphere_update_dismissed') === 'true') {
      return;
    }
    updateBanner.classList.remove('hidden');
    updateBanner.classList.add('flex');
    initLucide();

    if (updateNowBtn) {
      updateNowBtn.onclick = () => {
        updateNowBtn.disabled = true;
        updateNowBtn.innerHTML = `
          <div class="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
          <span>Updating...</span>
        `;
        if (worker) {
          worker.postMessage({ type: 'SKIP_WAITING' });
        } else if (swRegistration && swRegistration.waiting) {
          swRegistration.waiting.postMessage({ type: 'SKIP_WAITING' });
        } else {
          console.log('Reloading page from PWA update');
          window.location.reload();
        }
      };
    }
  }

  dismissUpdateBtn?.addEventListener('click', () => {
    if (updateBanner) {
      updateBanner.classList.add('hidden');
      updateBanner.classList.remove('flex');
    }
    sessionStorage.setItem('fansphere_update_dismissed', 'true');
  });

  async function checkPlatformVersion() {
    try {
      const res = await fetch('/api/version', { cache: 'no-store' });
      if (!res.ok) return;
      const data = await res.json();
      if (!initialBuildTime) {
        initialBuildTime = data.buildTime;
      } else if (data.buildTime && data.buildTime !== initialBuildTime) {
        console.log('[PWA] Platform updated! New build detected:', data.buildTime);
        if (swRegistration) {
          swRegistration.update().catch(() => {});
        }
      }
    } catch {}
  }

  if ('serviceWorker' in navigator) {
    // Reload page when new service worker activates and claims clients
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!refreshing) {
        refreshing = true;
        if (hasActiveSessionAndRealm()) {
          console.log('Reloading page from SW controllerchange');
          window.location.reload();
        } else {
          console.log('SW controllerchange, but skipping reload because user is on gate view');
        }
      }
    });

    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js', { scope: '/' })
        .then((reg) => {
          swRegistration = reg;
          console.log('[PWA] Service Worker registered with scope:', reg.scope);

          // Initial version check
          checkPlatformVersion();

          // Check if an updated worker is already installed and waiting
          if (reg.waiting && navigator.serviceWorker.controller) {
            console.log('[PWA] Found waiting worker on load.');
            showUpdateBanner(reg.waiting);
          }

          // Listen for new updates discovered
          reg.addEventListener('updatefound', () => {
            const newWorker = reg.installing;
            if (newWorker) {
              newWorker.addEventListener('statechange', () => {
                if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                  console.log('[PWA] New platform version installed and waiting.');
                  showUpdateBanner(newWorker);
                }
              });
            }
          });
        })
        .catch((err) => {
          console.warn('[PWA] Service Worker registration failed:', err);
        });

      // Background periodic check every 15 minutes
      setInterval(() => {
        if (swRegistration) {
          swRegistration.update().catch(() => {});
        }
        checkPlatformVersion();
      }, 15 * 60 * 1000);

      // Check on window focus
      window.addEventListener('focus', () => {
        if (swRegistration) {
          swRegistration.update().catch(() => {});
        }
        checkPlatformVersion();
      });

      // Check when tab visibility returns
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
          if (swRegistration) {
            swRegistration.update().catch(() => {});
          }
          checkPlatformVersion();
        }
      });
    });
  }

  // 2. In-App Install Prompt logic
  if (isStandalone) {
    // Already running in standalone / installed mode -> hide install button
    if (installBtn) installBtn.classList.add('hidden');
    console.log('[PWA] Running in standalone mode.');
  } else {
    // Listen for Chromium / Android / Desktop beforeinstallprompt
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      deferredInstallPrompt = e;
      if (installBtn) {
        installBtn.classList.remove('hidden');
        installBtn.classList.add('flex');
        initLucide();
      }
    });

    // iOS Safari Flow: Show button with iOS guidance
    if (isIOS) {
      if (installBtn) {
        const textSpan = installBtn.querySelector('span');
        if (textSpan) textSpan.textContent = 'Install (iOS)';
        installBtn.classList.remove('hidden');
        installBtn.classList.add('flex');
        initLucide();
      }
    }

    if (installBtn) {
      installBtn.addEventListener('click', async () => {
        if (deferredInstallPrompt) {
          // Standard Chromium / Android flow
          try {
            deferredInstallPrompt.prompt();
            const choiceResult = await deferredInstallPrompt.userChoice;
            if (choiceResult.outcome === 'accepted') {
              console.log('[PWA] User accepted the install prompt');
              installBtn.classList.add('hidden');
              installBtn.classList.remove('flex');
            } else {
              console.log('[PWA] User dismissed the install prompt');
            }
            deferredInstallPrompt = null;
          } catch (err) {
            console.warn('[PWA] Install error:', err);
          }
        } else if (isIOS && iosModal) {
          // iOS Safari modal
          iosModal.showModal();
          initLucide();
        } else {
          // Fallback if triggered on desktop browser before prompt fires
          alert('To install Fansphere, click the install icon in your browser address bar or menu.');
        }
      });
    }

    // App Installed event
    window.addEventListener('appinstalled', () => {
      console.log('[PWA] App was successfully installed!');
      if (installBtn) {
        installBtn.classList.add('hidden');
        installBtn.classList.remove('flex');
      }
      deferredInstallPrompt = null;
    });

    // iOS modal close handlers
    closeIosBtn?.addEventListener('click', () => iosModal?.close());
    dismissIosBtn?.addEventListener('click', () => iosModal?.close());
  }

  // 3. Connectivity status & Offline Banner
  function handleConnectivityChange() {
    const isOnline = navigator.onLine;
    if (offlineIndicator) {
      if (isOnline) {
        offlineIndicator.classList.add('hidden');
        // Reconnect WebSocket if needed
        if (!state.ws || state.ws.readyState !== WebSocket.OPEN) {
          console.log('[PWA] Reconnected to internet, reviving WebSocket...');
          connectWebSocket();
          loadPosts();
          loadChatHistory();
        }
      } else {
        offlineIndicator.classList.remove('hidden');
      }
    }
  }

  window.addEventListener('online', handleConnectivityChange);
  window.addEventListener('offline', handleConnectivityChange);

  // Initial check
  if (!navigator.onLine && offlineIndicator) {
    offlineIndicator.classList.remove('hidden');
  }
}

// ==================== CHAT MENTIONS IN SELECTED CLUB REALM ====================

function getFansInSelectedRealm() {
  const effective = getEffectiveRealm();
  const fanMap = new Map(); // lowercase username -> { nickname, flair, isOnline }

  // 1. Add users from activeUsers if available
  if (Array.isArray(state.activeUsers)) {
    for (const u of state.activeUsers) {
      if (u && u.nickname && matchClubRealm(u.flair, effective)) {
        fanMap.set(u.nickname.toLowerCase(), {
          nickname: u.nickname,
          flair: u.flair || effective,
          isOnline: true
        });
      }
    }
  }

  // 2. Add users from activeNicknames
  if (Array.isArray(state.activeNicknames)) {
    for (const nick of state.activeNicknames) {
      if (nick && !fanMap.has(nick.toLowerCase())) {
        const msg = state.allChatMessages.find(m => m.author.toLowerCase() === nick.toLowerCase());
        const flair = msg ? msg.author_flair : effective;
        if (matchClubRealm(flair, effective)) {
          fanMap.set(nick.toLowerCase(), {
            nickname: nick,
            flair: flair,
            isOnline: true
          });
        }
      }
    }
  }

  // 3. Add users from recent chat messages in this realm
  if (Array.isArray(state.allChatMessages)) {
    for (const m of state.allChatMessages) {
      if (m && m.author && matchClubRealm(m.author_flair, effective)) {
        const key = m.author.toLowerCase();
        if (!fanMap.has(key)) {
          fanMap.set(key, {
            nickname: m.author,
            flair: m.author_flair,
            isOnline: state.activeNicknames?.some(n => n.toLowerCase() === key) || false
          });
        }
      }
    }
  }

  // 4. Add users from forum posts/comments in this realm
  if (Array.isArray(state.posts)) {
    for (const p of state.posts) {
      if (p && p.author && matchClubRealm(p.author_flair, effective)) {
        const key = p.author.toLowerCase();
        if (!fanMap.has(key)) {
          fanMap.set(key, {
            nickname: p.author,
            flair: p.author_flair,
            isOnline: state.activeNicknames?.some(n => n.toLowerCase() === key) || false
          });
        }
      }
    }
  }

  // Exclude current user from mention candidates
  const currentHandle = (state.user?.handle || '').toLowerCase();
  fanMap.delete(currentHandle);

  // Return sorted list: online fans first, then alphabetical
  return Array.from(fanMap.values()).sort((a, b) => {
    if (a.isOnline && !b.isOnline) return -1;
    if (!a.isOnline && b.isOnline) return 1;
    return a.nickname.localeCompare(b.nickname);
  });
}

function initChatMentions() {
  const chatInput = document.getElementById('chatInput');
  const popup = document.getElementById('mentionAutocompletePopup');
  const list = document.getElementById('mentionSuggestionsList');
  const realmLabel = document.getElementById('mentionRealmName');
  if (!chatInput || !popup || !list) return;

  let activeIndex = 0;
  let currentCandidates = [];
  let tokenMatch = null;

  function hidePopup() {
    popup.classList.add('hidden');
    currentCandidates = [];
    tokenMatch = null;
    activeIndex = 0;
  }

  function renderSuggestions() {
    const effectiveRealm = getEffectiveRealm();
    if (realmLabel) {
      realmLabel.textContent = getRealmDisplayName(effectiveRealm);
    }

    if (currentCandidates.length === 0) {
      list.innerHTML = `
        <div class="p-3 text-center text-slate-400 text-xs">
          <p class="font-medium text-slate-300">No matching fans in <span class="text-amber-400 font-bold">${escapeHtml(getRealmDisplayName(effectiveRealm))}</span> realm.</p>
          <p class="text-[10px] text-slate-500 mt-1">Mentions only work between supporters of the same club realm.</p>
        </div>
      `;
      return;
    }

    list.innerHTML = currentCandidates.map((fan, idx) => {
      const isSelected = idx === activeIndex;
      const badgeColor = getFlairBadgeColor(fan.flair);
      return `
        <div 
          class="mention-item flex items-center gap-2 p-1.5 rounded-xl cursor-pointer transition select-none ${
            isSelected 
              ? 'bg-amber-500/20 border border-amber-500/60 text-white' 
              : 'hover:bg-slate-800 text-slate-200'
          }"
          data-index="${idx}"
        >
          <div class="relative shrink-0">
            <div class="w-6 h-6 rounded-full flex items-center justify-center font-bold text-[10px] text-white shadow-sm" style="background-color: ${badgeColor}">
              ${escapeHtml((fan.nickname || 'F').slice(0, 1).toUpperCase())}
            </div>
            ${fan.isOnline ? '<span class="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full bg-emerald-400 ring-2 ring-slate-900"></span>' : ''}
          </div>
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-1.5">
              <span class="font-bold text-xs truncate ${isSelected ? 'text-amber-300' : 'text-slate-100'}">@${escapeHtml(fan.nickname)}</span>
              ${fan.isOnline ? '<span class="text-[9px] text-emerald-400 font-semibold bg-emerald-950/80 px-1 py-0.2 rounded border border-emerald-800/60">online</span>' : ''}
            </div>
            <div class="text-[10px] text-slate-400 truncate">${escapeHtml(getRealmDisplayName(fan.flair))}</div>
          </div>
          <div class="text-[10px] text-slate-500 shrink-0 hidden sm:block">↵ Select</div>
        </div>
      `;
    }).join('');
    initLucide();
  }

  function applyMention(fan) {
    if (!fan || !tokenMatch) return;
    const text = chatInput.value;
    const beforeToken = text.slice(0, tokenMatch.tokenStart);
    const afterToken = text.slice(tokenMatch.tokenEnd);
    const replacement = `@${fan.nickname} `;
    chatInput.value = beforeToken + replacement + afterToken;
    const newPos = beforeToken.length + replacement.length;
    chatInput.selectionStart = newPos;
    chatInput.selectionEnd = newPos;
    chatInput.focus();
    hidePopup();
  }

  function checkTrigger() {
    const text = chatInput.value;
    const caret = chatInput.selectionStart;
    const textBefore = text.slice(0, caret);

    // Look for @query immediately preceding cursor
    const match = textBefore.match(/(?:^|\s)@([a-zA-Z0-9_\-\.\u00C0-\u017F]*)$/);
    if (!match) {
      hidePopup();
      return;
    }

    const query = match[1].toLowerCase();
    const tokenStart = caret - match[1].length - 1; // index of '@'
    const tokenEnd = caret;
    tokenMatch = { tokenStart, tokenEnd, query };

    const realmFans = getFansInSelectedRealm();
    currentCandidates = realmFans.filter(f => f.nickname.toLowerCase().includes(query));

    activeIndex = 0;
    renderSuggestions();
    popup.classList.remove('hidden');
  }

  chatInput.addEventListener('input', checkTrigger);
  chatInput.addEventListener('click', checkTrigger);
  chatInput.addEventListener('keyup', (e) => {
    if (['ArrowDown', 'ArrowUp', 'Enter', 'Tab', 'Escape'].includes(e.key)) return;
    checkTrigger();
  });

  chatInput.addEventListener('keydown', (e) => {
    if (popup.classList.contains('hidden') || currentCandidates.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      activeIndex = (activeIndex + 1) % currentCandidates.length;
      renderSuggestions();
      const el = list.children[activeIndex];
      el?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      activeIndex = (activeIndex - 1 + currentCandidates.length) % currentCandidates.length;
      renderSuggestions();
      const el = list.children[activeIndex];
      el?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      if (currentCandidates.length > 0) {
        e.preventDefault();
        e.stopPropagation();
        applyMention(currentCandidates[activeIndex]);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      hidePopup();
    }
  });

  // Clicking a suggestion item
  list.addEventListener('click', (e) => {
    const item = e.target.closest('.mention-item');
    if (!item) return;
    const idx = parseInt(item.dataset.index, 10);
    if (!isNaN(idx) && currentCandidates[idx]) {
      applyMention(currentCandidates[idx]);
    }
  });

  // Close popup if clicking outside
  document.addEventListener('click', (e) => {
    if (!popup.contains(e.target) && e.target !== chatInput) {
      hidePopup();
    }
  });

  // Clicking on any @mention chip in messages inserts reply mention
  document.addEventListener('click', (e) => {
    const tag = e.target.closest('.chat-mention');
    if (!tag) return;
    const targetMention = tag.dataset.mention;
    if (targetMention) {
      const input = document.getElementById('chatInput');
      if (input) {
        const val = input.value.trim();
        input.value = val ? `${val} @${targetMention} ` : `@${targetMention} `;
        input.focus();
        input.selectionStart = input.value.length;
        input.selectionEnd = input.value.length;
      }
    }
  });
}

function initNotifications() {
  const bell = document.getElementById('notificationsBell');
  const popup = document.getElementById('notificationsPopup');
  state.notificationsList = document.getElementById('notificationsList');
  state.notificationsBadge = document.getElementById('unreadNotificationsBadge');
  if (!bell || !popup || !state.notificationsList) return;

  function togglePopup() {
    popup.classList.toggle('hidden');
  }

  async function markAsRead(notificationId) {
    try {
      await fetch(`/api/notifications/${notificationId}/read`, {
        method: 'POST',
        headers: { 'x-session-id': state.sessionId || '' }
      });
      fetchNotifications();
    } catch (err) {
      console.error('Failed to mark notification as read', err);
    }
  }

  bell.addEventListener('click', (e) => {
    e.stopPropagation();
    togglePopup();
  });

  state.notificationsList.addEventListener('click', async (e) => {
    const item = e.target.closest('[data-message-id]');
    const isClearAll = e.target.closest('#clearAllNotificationsBtn');
    
    if (isClearAll) {
      try {
        await fetch('/api/notifications/read-all', {
          method: 'POST',
          headers: { 'x-session-id': state.sessionId || '' }
        });
        fetchNotifications();
      } catch (err) {
        console.error('Failed to clear all notifications', err);
      }
      return;
    }

    if (!item) return;
    
    const notificationId = item.getAttribute('data-id');
    const messageId = item.getAttribute('data-message-id');
    if (!messageId) return;

    // Mark as read
    if (notificationId) await markAsRead(notificationId);

    const chatContainer = document.getElementById('chatMessages');
    const targetMsg = chatContainer?.querySelector(`[data-chat-id="${messageId}"]`);
    
    if (targetMsg) {
      targetMsg.scrollIntoView({ behavior: 'smooth', block: 'center' });
      targetMsg.classList.add('ring-2', 'ring-amber-400');
      setTimeout(() => targetMsg.classList.remove('ring-2', 'ring-amber-400'), 2000);
      togglePopup(); // Close popup
    }
  });

  document.addEventListener('click', (e) => {
    if (!popup.contains(e.target) && e.target !== bell) {
      popup.classList.add('hidden');
    }
  });

  fetchNotifications();
  setInterval(fetchNotifications, 60000); // Check every minute
}

async function fetchNotifications() {
  if (!state.notificationsList || !state.notificationsBadge) return;
  try {
    const res = await fetch('/api/notifications', {
      headers: { 'x-session-id': state.sessionId || '' }
    });
    if (!res.ok) return;
    const notifications = await res.json();
    
    if (notifications.length > 0) {
      state.notificationsBadge.classList.remove('hidden');
      const recentNotifications = notifications.slice(0, 20);
      state.notificationsList.innerHTML = `
        <div class="flex justify-between items-center p-2 border-b border-slate-700">
          <span class="text-xs font-semibold text-slate-400">Notifications</span>
          <button id="clearAllNotificationsBtn" class="text-[10px] text-blue-400 hover:text-blue-300">Mark all read</button>
        </div>
        ${recentNotifications.map(n => `
        <div class="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 cursor-pointer ${n.read ? 'opacity-70' : ''}" data-id="${n.id}" data-message-id="${n.messageId}">
          <div class="font-semibold text-slate-100">${n.type === 'chat' ? 'Mentioned in chat' : n.type === 'post' ? 'Mentioned in post' : 'Mentioned in comment'}</div>
          <div class="text-[10px] text-slate-400">${formatRelativeTime(n.created_at)}</div>
        </div>
      `).join('')}`;
      if (!recentNotifications.some(n => !n.read)) {
        state.notificationsBadge.classList.add('hidden');
      }
    } else {
      state.notificationsBadge.classList.add('hidden');
      state.notificationsList.innerHTML = '<div class="text-slate-500 text-center py-4 italic">No new notifications</div>';
    }
  } catch (err) {
    console.error('Failed to fetch notifications', err);
  }
}

