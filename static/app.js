// ArseFinland FanSphere - Real-time Sports Fan Community Client

let currentRealms = [];

function normalizeFlair(flair) {
  if (!flair) return 'Neutral Football Fan';
  const str = String(flair).trim().toLowerCase();
  if (str.includes('tester')) return 'Testers';
  if (str.includes('neutral')) return 'Neutral Football Fan';
  if (str.includes('arsefinland') || str.includes('gunner') || str.includes('gooner') || str.includes('arsenal') || str.includes('official')) {
    return 'ArseFinland Official Member';
  }
  if (Array.isArray(currentRealms)) {
    const matched = currentRealms.find(r => r.name.toLowerCase() === str || r.id === str);
    if (matched) return matched.name;
  }
  return 'ArseFinland Official Member';
}

function getFlairBadgeColor(flair) {
  const norm = normalizeFlair(flair);
  if (norm === 'Testers') return '#A855F7';
  if (norm === 'Neutral Football Fan') return '#94A3B8';
  if (norm === 'ArseFinland Official Member') return '#EF4444';
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
  lastRenderedPagination: {},
  lastRenderedPostIds: []
};

// ==================== REALM & CLUB TAG FILTERING HELPERS ====================

function getEffectiveRealm() {
  if (state.selectedRealm === 'user_club') {
    return state.user.flair || 'ArseFinland Official Member';
  }
  return state.selectedRealm;
}

function getRealmDisplayName(realm) {
  if (realm === 'user_club') {
    return `My Club (${getRealmDisplayName(state.user.flair || 'ArseFinland Official Member')})`;
  }
  const norm = normalizeFlair(realm);
  if (norm === 'ArseFinland Official Member') return 'ArseFinland Official Member';
  if (norm === 'Neutral Football Fan') return 'Neutral Football Fan';
  if (norm === 'Testers') return 'Testers';
  return realm;
}

function matchClubRealm(authorFlair, targetRealm) {
  if (!targetRealm || targetRealm === 'All' || targetRealm === 'all') return true;
  if (!authorFlair) return false;

  const a = authorFlair.trim().toLowerCase();
  const effective = (targetRealm === 'user_club' ? (state.user.flair || 'ArseFinland Official Member') : targetRealm).trim().toLowerCase();
  if (a === effective) return true;

  // Testers realm
  if (effective.includes('tester')) {
    return a.includes('tester');
  }

  // Neutral Football Fan realm
  if (effective.includes('neutral')) {
    return a.includes('neutral');
  }

  // ArseFinland official club realm
  const arseFinlandVariants = ['arsefinland', 'arsenal', 'gunner', 'gooner', 'official', 'member'];
  if (arseFinlandVariants.some(v => effective.includes(v))) {
    return arseFinlandVariants.some(v => a.includes(v));
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
  const navUserControls = document.getElementById('navUserControls');
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
  renderPosts();
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
  initAudio();
  initModalLightDismiss();
  initMobileTabs();
  initOnlineFansPopup();
  initSessionAutoRefresh();
  initEventHandlers();
  loadPresence();

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
function initAudio() {
  const updateSoundIcon = () => {
    const btn = document.getElementById('soundToggleBtn');
    if (btn) {
      btn.innerHTML = state.soundEnabled 
        ? '<i data-lucide="volume-2" class="w-5 h-5"></i>' 
        : '<i data-lucide="volume-x" class="w-5 h-5 text-slate-500"></i>';
      initLucide();
    }
  };
  updateSoundIcon();

  document.getElementById('soundToggleBtn')?.addEventListener('click', () => {
    state.soundEnabled = !state.soundEnabled;
    localStorage.setItem('fansphere_sound', state.soundEnabled);
    updateSoundIcon();
    if (state.soundEnabled) playChime(660, 0.08);
  });
}

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
    if (gateTitle) gateTitle.textContent = 'Welcome to FanSphere';
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
    if (titleEl) titleEl.textContent = 'Welcome to FanSphere';
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

function updateOnlinePresence(count, nicknames = []) {
  const countEl = document.getElementById('onlineCountBadge');
  const tooltipCount = document.getElementById('tooltipActiveCount');
  const listEl = document.getElementById('onlineFansList');

  if (Array.isArray(nicknames) && nicknames.length > 0) {
    state.activeNicknames = nicknames;
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
      updateOnlinePresence(data.online_count, data.active_nicknames);
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
          updateOnlinePresence(data.online_count, data.active_nicknames);
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
    console.log('FanSphere WebSocket connected');
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
    console.warn('FanSphere WebSocket disconnected. Reconnecting in 3s...');
    setTimeout(connectWebSocket, 3000);
  };
}

function handleWebSocketMessage(msg) {
  console.log('WS message received:', msg.type);
  switch (msg.type) {
    case 'presence':
      updateOnlinePresence(msg.online_count, msg.active_nicknames);
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

    const res = await fetch(url);
    if (!res.ok) throw new Error('Failed to load posts');
    const rawPosts = await res.json();

    let merged = Array.isArray(rawPosts) ? [...rawPosts] : [];

    // Client-side self-healing: if server was restarted and is missing any locally created/cached posts,
    // merge them and restore them to the server so they never disappear
    try {
      const cachedRaw = localStorage.getItem('fansphere_cached_posts');
      if (cachedRaw) {
        const cached = JSON.parse(cachedRaw);
        if (Array.isArray(cached) && cached.length > 0) {
          const serverIds = new Set(merged.map(p => p.id));
          const missing = cached.filter(p => !serverIds.has(p.id));
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
    try {
      localStorage.setItem('fansphere_cached_posts', JSON.stringify(state.posts));
    } catch {}

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
  const gap = 8; // Tailwind gap-2 = 8px

  // Deterministic stable card height to guarantee zero pagination oscillations in mobile portrait
  const cardHeight = isMobile ? 116 : 108;
  const cardSlot = cardHeight + gap;

  // Available height WITHOUT pagination controls:
  const spaceWithoutPag = Math.max(0, forumHeight - topCtaHeight - gap);
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
  const spaceWithPag = Math.max(0, forumHeight - topCtaHeight - paginationHeight - (gap * 2));
  const maxPostsWithPag = Math.max(1, Math.floor((spaceWithPag + gap) / cardSlot));
  const totalPages = Math.max(1, Math.ceil(totalVisibleCount / maxPostsWithPag));

  return {
    shouldPaginate: true,
    postsPerPage: maxPostsWithPag,
    totalPages
  };
}

function renderPosts() {
  const container = document.getElementById('postsList');
  if (!container) return;

  const visiblePosts = getFilteredPosts();

  if (visiblePosts.length === 0) {
    container.dataset.lastRenderKey = 'empty';
    const effective = getEffectiveRealm();
    const realmName = getRealmDisplayName(effective);
    requestAnimationFrame(() => {
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
  const renderKey = `${state.selectedRealm}:${state.currentTag}:${state.currentPage}:${shouldPaginate}:${totalPages}:${postsPerPage}:${pagePosts.map(p => `${p.id}_${p.comment_count || 0}_${p.upvotes || 0}_${p.title}`).join('|')}`;
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

function renderPostCardHtml(post) {
  const tagClass = getTagClass(post.tag);
  const hasNewComments = post.latest_activity_at && post.comment_count > 0 && new Date(post.latest_activity_at).getTime() > new Date(post.created_at).getTime() + 1000;

  return `
    <article 
      class="post-card bg-slate-800/90 hover:bg-slate-800 rounded-xl p-3 border border-slate-700/70 transition flex flex-col gap-1.5 shadow-sm group shrink-0"
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
          ${hasNewComments ? `<span class="bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 text-[9px] px-1.5 py-0.2 rounded font-medium ml-auto flex items-center gap-0.5"><i data-lucide="message-square" class="w-2.5 h-2.5"></i> Active ${formatRelativeTime(post.latest_activity_at)}</span>` : ''}
        </div>

        <!-- Post Title -->
        <h2 class="post-title-link font-bold text-slate-100 text-xs leading-snug hover:text-red-400 transition cursor-pointer truncate mb-0.5" data-post-id="${post.id}">
          ${escapeHtml(post.title)}
        </h2>

        <!-- Post Body & Optional Image Thumbnail -->
        <div class="flex items-start gap-2.5 mb-1.5">
          <p class="post-title-link text-[11px] text-slate-300 leading-snug line-clamp-2 cursor-pointer flex-1 min-w-0" data-post-id="${post.id}">
            ${formatLightweightMarkdown(post.content)}
          </p>
          ${post.image_url ? `
            <div class="shrink-0 relative group/thumb cursor-pointer" onclick="event.stopPropagation(); openImageLightbox('${escapeHtml(post.image_url)}', '${escapeHtml(post.title)}')">
              <img 
                src="${escapeHtml(post.image_url)}" 
                alt="Post thumbnail" 
                loading="lazy"
                class="w-14 h-14 sm:w-16 sm:h-16 object-cover rounded-lg border border-slate-700/80 group-hover/thumb:border-red-500/80 group-hover/thumb:scale-105 transition shadow-sm bg-slate-900"
                onerror="this.parentElement.style.display='none'"
              />
              <div class="absolute inset-0 bg-black/30 group-hover/thumb:bg-black/10 rounded-lg flex items-center justify-center opacity-0 group-hover/thumb:opacity-100 transition pointer-events-none">
                <i data-lucide="zoom-in" class="w-3.5 h-3.5 text-white drop-shadow"></i>
              </div>
            </div>
          ` : ''}
        </div>

        <!-- Post Actions Footer -->
        <div class="flex items-center gap-3 text-[10px] text-slate-400 pt-1 border-t border-slate-700/40">
          <button class="open-comments-btn flex items-center gap-1 hover:text-slate-200 transition py-0.5" data-post-id="${post.id}">
            <i data-lucide="message-circle" class="w-3 h-3 text-red-400"></i>
            <span>${post.comment_count} Comments</span>
          </button>
          
          ${post.image_url ? `
            <button class="view-post-image-btn flex items-center gap-1 text-slate-400 hover:text-red-400 transition py-0.5" onclick="event.stopPropagation(); openImageLightbox('${escapeHtml(post.image_url)}', '${escapeHtml(post.title)}')">
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
    state.posts = state.posts.filter(p => p.id !== newPost.id);
    state.posts.unshift(newPost);
    sortPostsByLatestActivity(state.posts);
    renderPosts();
  }
}

// ==================== POST DETAIL & COMMENTS MODAL ====================

async function openPostDetailModal(postId) {
  state.activePostDetailId = postId;
  const modal = document.getElementById('postDetailModal');
  const headerFlairs = document.getElementById('modalPostHeaderFlairs');
  const contentEl = document.getElementById('modalPostContent');
  const commentCountEl = document.getElementById('modalCommentCount');
  const commentsList = document.getElementById('modalCommentsList');

  commentsList.innerHTML = `<div class="text-center py-4 text-slate-500">Loading comments...</div>`;
  modal.showModal();

  try {
    const res = await fetch(`/api/posts/${postId}`);
    if (!res.ok) throw new Error('Failed to load post');
    const data = await res.json();
    const post = data.post;
    const comments = data.comments;

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
        <div class="mt-3 rounded-xl overflow-hidden border border-slate-700/80 bg-slate-950/60 max-h-72 flex items-center justify-center relative group cursor-pointer" onclick="openImageLightbox('${escapeHtml(post.image_url)}', '${escapeHtml(post.title)}')">
          <img 
            src="${escapeHtml(post.image_url)}" 
            alt="Attached image" 
            class="max-h-72 w-full object-contain rounded-xl transition duration-300 group-hover:scale-[1.01]" 
          />
          <div class="absolute bottom-2 right-2 bg-slate-900/80 text-white text-[10px] px-2 py-1 rounded-md border border-slate-700 flex items-center gap-1 opacity-80 group-hover:opacity-100 transition">
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
        <div class="relative group/cimg inline-block max-w-[280px] rounded-xl overflow-hidden border border-slate-700 bg-slate-950 cursor-pointer mt-1" onclick="openImageLightbox('${escapeHtml(comment.image_url)}', 'Comment by ${escapeHtml(comment.author)}')">
          <img 
            src="${escapeHtml(comment.image_url)}" 
            alt="Comment attachment" 
            loading="lazy" 
            class="max-h-48 max-w-[280px] object-cover rounded-xl transition group-hover/cimg:scale-105" 
            onerror="this.parentElement.style.display='none'"
          />
          <div class="absolute inset-0 bg-black/25 opacity-0 group-hover/cimg:opacity-100 transition rounded-xl flex items-center justify-center pointer-events-none">
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
  if (state.activePostDetailId === newComment.post_id) {
    const list = document.getElementById('modalCommentsList');
    const countEl = document.getElementById('modalCommentCount');
    if (list) {
      const div = document.createElement('div');
      div.innerHTML = renderCommentHtml(newComment);
      list.appendChild(div.firstElementChild);
      attachCommentListeners();
      initLucide();
    }
    if (countEl) {
      countEl.textContent = parseInt(countEl.textContent || '0') + 1;
    }
  }

  // Update post latest activity and comment count, then re-sort feed so active thread moves to top
  const targetPost = state.posts.find(p => p.id === newComment.post_id);
  if (targetPost) {
    targetPost.comment_count = (targetPost.comment_count || 0) + 1;
    targetPost.latest_activity_at = newComment.created_at || new Date().toISOString();
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
    playChime(523.25, 0.1);
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

  const msgDiv = document.createElement('div');
  msgDiv.className = `${isNew ? 'chat-msg-enter ' : ''}flex flex-col space-y-0.5 shrink-0 group/msg relative`;
  if (msg.id) msgDiv.dataset.chatId = msg.id;
  msgDiv.innerHTML = `
    <div class="flex items-center gap-1.5 text-[10px]">
      <span class="w-1.5 h-1.5 rounded-full shrink-0" style="background-color: ${msg.badge_color || '#EF4444'}"></span>
      <span class="font-bold text-slate-200 truncate ${isSelf ? 'text-red-400 font-extrabold' : ''}">${escapeHtml(msg.author)}</span>
      <span class="bg-slate-700/40 text-slate-400 text-[8px] px-1 py-0.2 rounded truncate max-w-[100px]">${escapeHtml(msg.author_flair || 'ArseFinland Official Member')}</span>
      <span class="text-slate-500 text-[9px] ml-auto shrink-0">${formatRelativeTime(msg.created_at)}</span>
    </div>

    <!-- Message Bubble with Right-Hand Action Buttons -->
    <div class="chat-msg-row flex items-stretch gap-1 relative w-full">
      <div class="chat-bubble flex-1 min-w-0 w-full bg-slate-900/90 text-slate-100 px-2 py-0.5 rounded-lg border border-slate-700/60 leading-snug break-words shadow-sm text-xs h-auto min-h-full flex flex-col justify-center"><div class="chat-msg-text whitespace-pre-wrap break-words leading-snug">${formatLightweightMarkdown(msg.content)}</div><div class="chat-reactions-container flex flex-wrap items-center gap-1 mt-0.5 ${hasReactions ? '' : 'hidden'}" data-msg-id="${msg.id}">${renderReactionsHtml(msg.id, reactions)}</div></div>

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
  if (autoScroll) {
    requestAnimationFrame(() => scrollChatToBottom());
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

      loadPosts();
    });
  });
  document.getElementById('threadFilterSelect')?.addEventListener('change', (e) => {
    state.currentTag = e.target.value;
    state.currentPage = 1;
    loadPosts();
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

  // File picker handler: read file as Base64 data URL
  document.getElementById('postImageFileInput')?.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      alert('Selected image exceeds the 5MB size limit.');
      e.target.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      currentPostImageUrl = event.target.result;
      const previewContainer = document.getElementById('postImagePreviewContainer');
      const previewImg = document.getElementById('postImagePreview');
      if (previewContainer && previewImg) {
        previewImg.src = currentPostImageUrl;
        previewContainer.classList.remove('hidden');
      }
    };
    reader.readAsDataURL(file);
  });

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
          const uploadRes = await fetch('/api/upload', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-session-id': state.sessionId
            },
            body: JSON.stringify({
              data: currentPostImageUrl,
              session_id: state.sessionId
            })
          });
          if (uploadRes.ok) {
            const uploadData = await uploadRes.json();
            if (uploadData && uploadData.url) {
              finalImageUrl = uploadData.url;
            }
          }
        } catch (uploadErr) {
          console.warn('Image upload to local server failed, continuing with direct data URI:', uploadErr);
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

    // Handle Comment Image File Input
    document.getElementById('commentImageFileInput')?.addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      if (!file) return;

      if (file.size > 5 * 1024 * 1024) {
        alert('Selected image exceeds the 5MB size limit.');
        e.target.value = '';
        return;
      }

      const reader = new FileReader();
      reader.onload = (event) => {
        currentCommentImageUrl = event.target.result;
        const previewWrapper = document.getElementById('commentImagePreviewWrapper');
        const previewImg = document.getElementById('commentImagePreview');
        if (previewWrapper && previewImg) {
          previewImg.src = currentCommentImageUrl;
          previewWrapper.classList.remove('hidden');
        }
      };
      reader.readAsDataURL(file);
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
            const uploadRes = await fetch('/api/upload', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'x-session-id': state.sessionId
              },
              body: JSON.stringify({
                data: currentCommentImageUrl,
                session_id: state.sessionId
              })
            });
            if (uploadRes.ok) {
              const uploadData = await uploadRes.json();
              if (uploadData && uploadData.url) {
                finalCommentImg = uploadData.url;
              }
            }
          } catch (uploadErr) {
            console.warn('Comment image upload to server failed:', uploadErr);
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
          input.value = '';
          resetCommentImageState();
          playChime(587.33, 0.08);
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
  document.getElementById('switchSessionBtn')?.addEventListener('click', () => {
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
  });

  // Unified session persistence function for both blur auto-save and explicit form submit
  async function persistProfileSessionChanges(options = { closeOnSuccess: false, isBlur: false }) {
    const handleDisplay = document.getElementById('profileHandleDisplay');
    const emailDisplay = document.getElementById('profileEmailDisplay');
    const flairInput = document.getElementById('profileFlairInput');
    const errEl = document.getElementById('profileError');
    const successEl = document.getElementById('profileSuccess');
    const saveBtn = document.getElementById('saveProfileBtn');

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

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
    if (!payload.email) payload.email = emailRegex.test(newEmail) ? newEmail : (state.user.email || 'fan@arsefinland.fi');
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
            email: emailRegex.test(newEmail) ? newEmail : 'fan@arsefinland.fi',
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
    const flair = flairInput ? normalizeFlair(flairInput.value) : 'ArseFinland Official Member';

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
        submitBtn.innerHTML = `<span>Enter FanSphere</span><i data-lucide="arrow-right" class="w-4 h-4"></i>`;
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
      submitBtn.innerHTML = '<span>Entering FanSphere...</span>';
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
        submitBtn.innerHTML = `<span>Enter FanSphere</span><i data-lucide="arrow-right" class="w-4 h-4"></i>`;
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
