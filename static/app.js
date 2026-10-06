// ArseFinland FanSphere - Real-time Sports Fan Community Client

// State
const state = {
  sessionId: localStorage.getItem('fansphere_session_id') || null,
  session: null,
  user: {
    handle: localStorage.getItem('fansphere_handle') || '',
    email: localStorage.getItem('fansphere_email') || '',
    flair: localStorage.getItem('fansphere_flair') || 'Gunner',
    badgeColor: '#EF4444'
  },
  soundEnabled: localStorage.getItem('fansphere_sound') !== 'false',
  currentSort: 'new',
  currentTag: 'All',
  currentPage: 1,
  postsPerPage: 3,
  userVotes: JSON.parse(localStorage.getItem('fansphere_votes') || '{}'),
  activePostDetailId: null,
  ws: null,
  posts: [],
  renderedChatIds: new Set(),
  activeNicknames: []
};

// ==================== INITIALIZATION ====================

document.addEventListener('DOMContentLoaded', async () => {
  initUserProfile();
  initLucide();
  initAudio();
  initModalLightDismiss();
  initMobileTabs();
  initSessionAutoRefresh();

  // Instant restore of cached posts and chat messages so user sees old messages immediately on reload
  loadCachedData();

  // Connect WebSocket
  connectWebSocket();

  // Check or initialize fan session (reuses if valid, prompts if new or expired)
  await checkSession();

  // Load latest persistent data from server
  await Promise.all([
    loadPosts(),
    loadChatHistory()
  ]);

  initEventHandlers();
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
        const container = document.getElementById('chatMessages');
        if (container) {
          container.innerHTML = '';
          state.renderedChatIds.clear();
          parsedChat.forEach(msg => appendChatMessage(msg, false));
          scrollChatToBottom();
        }
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
    if (!('closedBy' in HTMLDialogElement.prototype)) {
      dialog.addEventListener('click', (event) => {
        if (event.target !== dialog) return;
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

  // CRITICAL: Never overwrite inputs if the modal is currently open, unless explicitly forced (e.g. initial modal open)
  const isModalOpen = profileModal && profileModal.open;
  if (!isModalOpen || force) {
    if (inputHandle) inputHandle.value = state.user.handle || '';
    if (inputEmail) inputEmail.value = state.user.email || '';
    if (inputFlair) inputFlair.value = state.user.flair || 'Gunner';
  }

  if (sessionIdDisplay) {
    sessionIdDisplay.textContent = state.sessionId ? `${state.sessionId.slice(0, 10)}...` : 'Inactive';
    sessionIdDisplay.title = state.sessionId || '';
  }
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
        return true;
      } else {
        const err = await res.json().catch(() => ({}));
        console.warn('Session verification error:', err);
        state.sessionId = null;
        state.session = null;
        localStorage.removeItem('fansphere_session_id');
        openSessionPromptModal(err.expired ? 'expired' : 'new');
        return false;
      }
    } catch (e) {
      console.error('Session network check error', e);
      return false;
    }
  } else {
    // No existing session, prompt user for Nickname & Email
    openSessionPromptModal('new');
    return false;
  }
}

function applySession(session) {
  state.session = session;
  state.sessionId = session.id;
  state.user.handle = session.nickname;
  state.user.email = session.email;
  state.user.flair = session.flair || 'Gunner';

  localStorage.setItem('fansphere_session_id', session.id);
  localStorage.setItem('fansphere_handle', session.nickname);
  localStorage.setItem('fansphere_email', session.email);
  localStorage.setItem('fansphere_flair', session.flair || 'Gunner');

  initUserProfile();

  // If websocket is open, authenticate socket connection
  if (state.ws && state.ws.readyState === WebSocket.OPEN) {
    state.ws.send(JSON.stringify({ type: 'auth', sessionId: session.id }));
  }

  // Close welcome / session prompt modal if open
  const modal = document.getElementById('sessionPromptModal');
  if (modal && modal.open) {
    modal.close();
  }
}

function openSessionPromptModal(reason = 'new') {
  const modal = document.getElementById('sessionPromptModal');
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

  const fansCount = count !== undefined ? count : (state.activeNicknames?.length || 1);
  if (countEl) countEl.textContent = `${fansCount} ${fansCount === 1 ? 'Fan' : 'Fans'} Online`;
  if (tooltipCount) tooltipCount.textContent = fansCount;

  if (Array.isArray(nicknames) && nicknames.length > 0) {
    state.activeNicknames = nicknames;
  }

  if (listEl) {
    const list = (state.activeNicknames && state.activeNicknames.length > 0)
      ? state.activeNicknames
      : [state.user.handle || 'You'];

    listEl.innerHTML = list.map(name => {
      const isYou = name === state.user.handle;
      return `
        <li class="flex items-center gap-1.5 py-0.5">
          <span class="w-1.5 h-1.5 rounded-full ${isYou ? 'bg-red-400' : 'bg-emerald-400'}"></span>
          <span class="truncate ${isYou ? 'text-red-400 font-bold' : 'text-slate-200'}">${escapeHtml(name)}</span>
          ${isYou ? '<span class="text-[9px] text-slate-400 ml-auto font-medium">(You)</span>' : ''}
        </li>
      `;
    }).join('');
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
    if (state.sessionId) {
      state.ws.send(JSON.stringify({ type: 'auth', sessionId: state.sessionId }));
    }
    // Keep-alive heartbeat ping every 25s
    setInterval(() => {
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
  switch (msg.type) {
    case 'presence':
      updateOnlinePresence(msg.online_count, msg.active_nicknames);
      break;

    case 'auth_success':
      if (msg.session) applySession(msg.session);
      break;

    case 'error':
      if (msg.session_required) {
        openSessionPromptModal('expired');
      }
      break;

    case 'chat_message':
      appendChatMessage(msg.data);
      playChime(523.25, 0.1);
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
    state.posts = sortPostsByLatestActivity(rawPosts);
    if (state.currentTag === 'All') {
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

function renderPosts() {
  const container = document.getElementById('postsList');
  if (!container) return;

  if (state.posts.length === 0) {
    container.innerHTML = `
      <div class="text-center py-6 bg-slate-850 rounded-2xl border border-slate-700/60 p-4 text-slate-400 my-auto">
        <p class="text-xs font-semibold mb-1">No posts found in this topic yet.</p>
        <p class="text-[10px] text-slate-500">Be the first to start the discussion!</p>
      </div>
    `;
    updatePaginationControls(1, 1);
    return;
  }

  const totalPages = Math.max(1, Math.ceil(state.posts.length / state.postsPerPage));
  if (state.currentPage > totalPages) state.currentPage = totalPages;
  if (state.currentPage < 1) state.currentPage = 1;

  const startIndex = (state.currentPage - 1) * state.postsPerPage;
  const pagePosts = state.posts.slice(startIndex, startIndex + state.postsPerPage);

  container.innerHTML = pagePosts.map(post => renderPostCardHtml(post)).join('');
  updatePaginationControls(totalPages, state.currentPage);
  initLucide();
  attachPostCardListeners();
}

function updatePaginationControls(totalPages, currentPage) {
  const pageIndicator = document.getElementById('pageIndicator');
  const prevBtn = document.getElementById('prevPageBtn');
  const nextBtn = document.getElementById('nextPageBtn');

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

        <!-- Post Body Snippet -->
        <p class="post-title-link text-[11px] text-slate-300 leading-snug line-clamp-1 mb-1.5 cursor-pointer" data-post-id="${post.id}">
          ${escapeHtml(post.content)}
        </p>

        <!-- Post Actions Footer -->
        <div class="flex items-center gap-3 text-[10px] text-slate-400 pt-1 border-t border-slate-700/40">
          <button class="open-comments-btn flex items-center gap-1 hover:text-slate-200 transition py-0.5" data-post-id="${post.id}">
            <i data-lucide="message-circle" class="w-3 h-3 text-red-400"></i>
            <span>${post.comment_count} Comments</span>
          </button>
          
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
      <p class="text-xs sm:text-sm text-slate-300 whitespace-pre-line leading-relaxed">${escapeHtml(post.content)}</p>
    `;

    commentCountEl.textContent = comments.length;

    if (comments.length === 0) {
      commentsList.innerHTML = `<p class="text-slate-500 py-4">No comments yet. Start the conversation!</p>`;
    } else {
      commentsList.innerHTML = comments.map(c => renderCommentHtml(c)).join('');
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
    <div class="bg-slate-800/80 p-3 rounded-xl border border-slate-700/60 space-y-1.5" data-comment-id="${comment.id}">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-2">
          <span class="font-bold text-slate-200">${escapeHtml(comment.author)}</span>
          <span class="bg-slate-700/40 text-slate-300 text-[10px] px-1.5 py-0.5 rounded">${escapeHtml(comment.author_flair || 'Gunner')}</span>
          <span class="text-slate-500 text-[11px]">• ${formatRelativeTime(comment.created_at)}</span>
        </div>
      </div>
      <p class="text-slate-300 leading-relaxed text-xs">${escapeHtml(comment.content)}</p>
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
      list.prepend(div.firstElementChild);
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

async function loadChatHistory() {
  try {
    const res = await fetch('/api/chat/history?room=general&limit=100');
    if (!res.ok) throw new Error('Failed to load chat');
    const messages = await res.json();
    const container = document.getElementById('chatMessages');
    if (!container) return;
    container.innerHTML = '';
    state.renderedChatIds.clear();
    messages.forEach(msg => appendChatMessage(msg, false));
    scrollChatToBottom();
    try {
      localStorage.setItem('fansphere_cached_chat', JSON.stringify(messages.slice(-50)));
    } catch {}
  } catch (err) {
    console.error(err);
  }
}

function appendChatMessage(msg, autoScroll = true) {
  const container = document.getElementById('chatMessages');
  if (!container) return;

  if (msg.id && state.renderedChatIds.has(msg.id)) {
    return;
  }
  if (msg.id) {
    state.renderedChatIds.add(msg.id);
  }

  const isSelf = msg.author === state.user.handle;

  const msgDiv = document.createElement('div');
  msgDiv.className = 'chat-msg-enter flex flex-col space-y-0.5 shrink-0';
  if (msg.id) msgDiv.dataset.chatId = msg.id;
  msgDiv.innerHTML = `
    <div class="flex items-center gap-1.5 text-[10px]">
      <span class="w-1.5 h-1.5 rounded-full shrink-0" style="background-color: ${msg.badge_color || '#EF4444'}"></span>
      <span class="font-bold text-slate-200 truncate ${isSelf ? 'text-red-400 font-extrabold' : ''}">${escapeHtml(msg.author)}</span>
      <span class="bg-slate-700/40 text-slate-400 text-[8px] px-1 py-0.2 rounded truncate max-w-[100px]">${escapeHtml(msg.author_flair || 'Gunner')}</span>
      <span class="text-slate-500 text-[9px] ml-auto shrink-0">${formatRelativeTime(msg.created_at)}</span>
    </div>
    <div class="bg-slate-900/90 text-slate-100 px-2.5 py-1.5 rounded-lg border border-slate-700/60 leading-snug break-words shadow-sm text-xs">
      ${escapeHtml(msg.content)}
    </div>
  `;

  container.appendChild(msgDiv);
  if (autoScroll) scrollChatToBottom();
}

function scrollChatToBottom() {
  const container = document.getElementById('chatMessages');
  if (container) {
    container.scrollTop = container.scrollHeight;
    while (container.children.length > 200) {
      const removed = container.firstElementChild;
      if (removed && removed.dataset && removed.dataset.chatId) {
        state.renderedChatIds.delete(parseInt(removed.dataset.chatId, 10));
      }
      container.removeChild(removed);
    }
  }
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
    const totalPages = Math.max(1, Math.ceil(state.posts.length / state.postsPerPage));
    if (state.currentPage < totalPages) {
      state.currentPage++;
      renderPosts();
    }
  });

  // 3. Create Post Modal
  const createPostModal = document.getElementById('createPostModal');
  document.getElementById('openCreatePostBtn')?.addEventListener('click', () => {
    if (!state.sessionId) {
      openSessionPromptModal('new');
      return;
    }
    createPostModal.showModal();
  });
  document.getElementById('closeCreatePostModalBtn')?.addEventListener('click', () => {
    createPostModal.close();
  });
  document.getElementById('cancelPostBtn')?.addEventListener('click', () => {
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

    if (!title || !content) return;

    try {
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
          session_id: state.sessionId
        })
      });

      if (res.ok) {
        document.getElementById('createPostForm').reset();
        createPostModal.close();
        await loadPosts();
        playChime(659.25, 0.15);
      } else if (res.status === 401) {
        openSessionPromptModal('expired');
      }
    } catch (err) {
      console.error('Failed to create post', err);
    }
  });

  // 4. Post Detail Modal Close & Comment Submit
  const postDetailModal = document.getElementById('postDetailModal');
  document.getElementById('closeDetailModalBtn')?.addEventListener('click', () => {
    postDetailModal.close();
    state.activePostDetailId = null;
  });

  document.getElementById('addCommentForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!state.sessionId) {
      openSessionPromptModal('new');
      return;
    }

    const input = document.getElementById('commentTextInput');
    const content = input.value.trim();
    if (!content || !state.activePostDetailId) return;

    try {
      const res = await fetch(`/api/posts/${state.activePostDetailId}/comments`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-session-id': state.sessionId
        },
        body: JSON.stringify({
          content,
          session_id: state.sessionId
        })
      });

      if (res.ok) {
        input.value = '';
        playChime(587.33, 0.08);
      } else if (res.status === 401) {
        openSessionPromptModal('expired');
      }
    } catch (err) {
      console.error(err);
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
    // Auto-focus the nickname input so the user can start editing immediately
    setTimeout(() => {
      const input = document.getElementById('profileHandleInput');
      if (input) {
        input.focus();
        input.select();
      }
    }, 50);
  });

  // Explicit Edit buttons for Nickname and Email
  document.getElementById('editHandleBtn')?.addEventListener('click', () => {
    const input = document.getElementById('profileHandleInput');
    if (input) {
      input.focus();
      input.select();
    }
  });

  document.getElementById('editEmailBtn')?.addEventListener('click', () => {
    const input = document.getElementById('profileEmailInput');
    if (input) {
      input.focus();
      input.select();
    }
  });

  // Clear feedback banners when user types in inputs
  document.getElementById('profileHandleInput')?.addEventListener('input', () => {
    document.getElementById('profileError')?.classList.add('hidden');
    document.getElementById('profileSuccess')?.classList.add('hidden');
  });

  document.getElementById('profileEmailInput')?.addEventListener('input', () => {
    document.getElementById('profileError')?.classList.add('hidden');
    document.getElementById('profileSuccess')?.classList.add('hidden');
  });

  document.getElementById('closeProfileModalBtn')?.addEventListener('click', () => {
    profileModal.close();
  });
  document.getElementById('switchSessionBtn')?.addEventListener('click', () => {
    profileModal.close();
    openSessionPromptModal('new');
  });

  // Unified session persistence function for both blur auto-save and explicit form submit
  async function persistProfileSessionChanges(options = { closeOnSuccess: false, isBlur: false }) {
    const handleInput = document.getElementById('profileHandleInput');
    const emailInput = document.getElementById('profileEmailInput');
    const flairInput = document.getElementById('profileFlairInput');
    const errEl = document.getElementById('profileError');
    const successEl = document.getElementById('profileSuccess');
    const saveBtn = document.getElementById('saveProfileBtn');

    if (!handleInput || !emailInput) return false;
    const newHandle = handleInput.value.trim();
    const newEmail = emailInput.value.trim();
    const newFlair = flairInput ? flairInput.value : 'Gunner';

    // If blur auto-save, only save if there are changes and fields are valid
    const hasChanges = (newHandle !== state.user.handle) || (newEmail !== state.user.email) || (newFlair !== state.user.flair);
    if (!hasChanges && !options.closeOnSuccess) {
      return true;
    }

    if (options.isBlur) {
      // Don't pop aggressive errors while user is partially typing, but if valid, persist immediately
      if (newHandle.length < 2 || newHandle.length > 30) return false;
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(newEmail)) return false;
    } else {
      // Explicit submission validation
      if (errEl) errEl.classList.add('hidden');
      if (successEl) successEl.classList.add('hidden');

      if (newHandle.length < 2 || newHandle.length > 30) {
        if (errEl) {
          errEl.textContent = 'Nickname must be between 2 and 30 characters';
          errEl.classList.remove('hidden');
        }
        handleInput.focus();
        return false;
      }

      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(newEmail)) {
        if (errEl) {
          errEl.textContent = 'Please enter a valid email address';
          errEl.classList.remove('hidden');
        }
        emailInput.focus();
        return false;
      }
    }

    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving...';
    }

    try {
      let res;
      if (state.sessionId) {
        res = await fetch('/api/auth/session', {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'x-session-id': state.sessionId
          },
          body: JSON.stringify({
            nickname: newHandle,
            email: newEmail,
            flair: newFlair
          })
        });
      } else {
        res = await fetch('/api/auth/session', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            nickname: newHandle,
            email: newEmail,
            flair: newFlair
          })
        });
      }

      // If session was expired on server, seamlessly re-create session with user's new nickname & email
      if (!res.ok && res.status === 401) {
        res = await fetch('/api/auth/session', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            nickname: newHandle,
            email: newEmail,
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
        successEl.textContent = `✅ Saved! Active session updated (${data.session.nickname}).`;
        successEl.classList.remove('hidden');
      }

      playChime(659.25, 0.08);

      if (options.closeOnSuccess) {
        setTimeout(() => {
          if (profileModal && profileModal.open) {
            profileModal.close();
          }
          if (successEl) successEl.classList.add('hidden');
        }, 700);
      } else {
        setTimeout(() => {
          if (successEl) successEl.classList.add('hidden');
        }, 3000);
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
      if (saveBtn) {
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

  document.getElementById('profileFlairInput')?.addEventListener('change', () => {
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
    const flair = flairInput ? flairInput.value : 'Gunner';

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

  // 6. Chat Input & Quick Reaction Buttons
  const chatForm = document.getElementById('chatForm');
  const chatInput = document.getElementById('chatInput');
  chatForm?.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = chatInput.value;
    if (text) {
      sendChatMessage(text);
      chatInput.value = '';
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

  tabForum?.addEventListener('click', () => {
    forumSection?.classList.remove('hidden');
    rightSidebar?.classList.add('hidden');
    setActiveTab(tabForum, [tabChat]);
  });

  tabChat?.addEventListener('click', () => {
    forumSection?.classList.add('hidden');
    rightSidebar?.classList.remove('hidden');
    scrollChatToBottom();
    setActiveTab(tabChat, [tabForum]);
  });

  function setActiveTab(active, inactives) {
    active.className = 'flex-1 py-2 px-3 rounded-lg text-center text-red-400 bg-slate-800 flex items-center justify-center gap-1.5';
    inactives.forEach(inact => {
      inact.className = 'flex-1 py-2 px-3 rounded-lg text-center text-slate-400 flex items-center justify-center gap-1.5';
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
