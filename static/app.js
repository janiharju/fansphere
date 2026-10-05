// ArseFinland FanSphere - Real-time Sports Fan Community Client

// State
const state = {
  user: {
    handle: localStorage.getItem('fansphere_handle') || 'GunnerFIN',
    flair: localStorage.getItem('fansphere_flair') || 'ArseFinland Member',
    badgeColor: '#EF4444'
  },
  soundEnabled: localStorage.getItem('fansphere_sound') !== 'false',
  currentSort: 'hot',
  currentTag: 'All',
  currentPage: 1,
  postsPerPage: 3,
  userVotes: JSON.parse(localStorage.getItem('fansphere_votes') || '{}'),
  activePostDetailId: null,
  ws: null,
  posts: [],
  renderedChatIds: new Set()
};

// ==================== INITIALIZATION ====================

document.addEventListener('DOMContentLoaded', async () => {
  initUserProfile();
  initLucide();
  initAudio();
  initModalLightDismiss();
  initMobileTabs();
  
  // Instant restore of cached posts and chat messages so user sees old messages immediately on reload
  loadCachedData();

  // Connect WebSocket
  connectWebSocket();

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
        state.posts = parsed;
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

// User Profile
function initUserProfile() {
  const handleEl = document.getElementById('navUsername');
  const inputHandle = document.getElementById('profileHandleInput');
  const inputFlair = document.getElementById('profileFlairInput');

  if (handleEl) handleEl.textContent = state.user.handle;
  if (inputHandle) inputHandle.value = state.user.handle;
  if (inputFlair) inputFlair.value = state.user.flair;
}

// ==================== WEBSOCKET HANDLING ====================

function connectWebSocket() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}/ws`;

  state.ws = new WebSocket(wsUrl);

  state.ws.onopen = () => {
    console.log('FanSphere WebSocket connected');
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
      const countEl = document.getElementById('onlineCountBadge');
      if (countEl) countEl.textContent = `${msg.online_count} Fans Online`;
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

async function loadPosts() {
  try {
    const url = new URL('/api/posts', window.location.origin);
    url.searchParams.set('sort', state.currentSort);
    if (state.currentTag && state.currentTag !== 'All') {
      url.searchParams.set('tag', state.currentTag);
    }

    const res = await fetch(url);
    if (!res.ok) throw new Error('Failed to load posts');
    state.posts = await res.json();
    if (state.currentTag === 'All' && state.currentSort === 'hot') {
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
    state.posts.unshift(newPost);
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

  const payload = {
    room: 'general',
    author: state.user.handle,
    author_flair: state.user.flair,
    badge_color: state.user.badgeColor,
    content: text.trim()
  };

  if (state.ws && state.ws.readyState === WebSocket.OPEN) {
    state.ws.send(JSON.stringify({
      type: 'chat',
      payload: payload
    }));
  } else {
    fetch('/api/chat/message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
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

  // 2. Sorting buttons
  const sortBtns = [
    { id: 'sortHotBtn', sort: 'hot' },
    { id: 'sortNewBtn', sort: 'new' },
    { id: 'sortTopBtn', sort: 'top' }
  ];
  sortBtns.forEach(({ id, sort }) => {
    document.getElementById(id)?.addEventListener('click', () => {
      state.currentSort = sort;
      state.currentPage = 1;
      sortBtns.forEach(b => {
        const btn = document.getElementById(b.id);
        if (b.sort === sort) {
          btn.className = 'sort-tab-btn px-2.5 py-1 rounded-md font-medium bg-red-600 text-white flex items-center gap-1 transition shadow-sm';
        } else {
          btn.className = 'sort-tab-btn px-2.5 py-1 rounded-md font-medium text-slate-400 hover:text-slate-200 flex items-center gap-1 transition';
        }
      });
      loadPosts();
    });
  });

  // 3. Pagination Controls (Zero-Scroll navigation)
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
    const title = document.getElementById('postTitleInput').value.trim();
    const tag = document.getElementById('postTagInput').value;
    const content = document.getElementById('postContentInput').value.trim();

    if (!title || !content) return;

    try {
      const res = await fetch('/api/posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          content,
          tag,
          author: state.user.handle,
          author_flair: state.user.flair
        })
      });

      if (res.ok) {
        document.getElementById('createPostForm').reset();
        createPostModal.close();
        await loadPosts();
        playChime(659.25, 0.15);
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
    const input = document.getElementById('commentTextInput');
    const content = input.value.trim();
    if (!content || !state.activePostDetailId) return;

    try {
      const res = await fetch(`/api/posts/${state.activePostDetailId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content,
          author: state.user.handle,
          author_flair: state.user.flair
        })
      });

      if (res.ok) {
        input.value = '';
        playChime(587.33, 0.08);
      }
    } catch (err) {
      console.error(err);
    }
  });

  // 5. User Profile Modal
  const profileModal = document.getElementById('userProfileModal');
  document.getElementById('openProfileModalBtn')?.addEventListener('click', () => {
    profileModal.showModal();
  });
  document.getElementById('closeProfileModalBtn')?.addEventListener('click', () => {
    profileModal.close();
  });
  document.getElementById('profileForm')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const newHandle = document.getElementById('profileHandleInput').value.trim();
    const newFlair = document.getElementById('profileFlairInput').value;
    if (newHandle) {
      state.user.handle = newHandle;
      state.user.flair = newFlair;
      localStorage.setItem('fansphere_handle', newHandle);
      localStorage.setItem('fansphere_flair', newFlair);
      initUserProfile();
      profileModal.close();
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
