(() => {
  'use strict';
  const el = id => document.getElementById(id);
  const board = el('chat-body'), messages = el('messages'), input = el('input');
  const form = el('composer'), progress = el('progress'), threads = el('threads');
  const web = el('web'), send = el('send'), stop = el('stop'), access = el('access'), dialog = el('delete-dialog');
  const terminal = new Set(['done', 'cancelled', 'error']);
  const tasks = {
    debug: 'Help me debug this error.\n\nWhat I expected:\n\nWhat happened (include the error or traceback):\n',
    explain: 'Explain what this code does, including any edge cases:\n\n',
    refactor: 'Help me plan a refactor.\n\nWhat the code does now:\n\nBehavior that must stay the same:\n',
  };
  let session = false, gated = false, initializing = false, bootstrapped = false, selection = 0, sessionEpoch = 0;
  let current = null, active = null, working = false, deleting = false, stopping = false, live = null, pollTimer, items = [];
  let ready = false, webEnabled = false, lastWebMode = 'off', everChecked = false;
  const api = AgentAPI.request;
  const path = id => `conversations/${id}`;

  function showProblem(text = '', recover = false) {
    el('problem').hidden = !text;
    if (el('problem-text').textContent !== text) el('problem-text').textContent = text;
    el('recover').hidden = !recover;
  }
  function say(text = '') {
    if (progress.textContent !== text) progress.textContent = text;
  }
  function controls() {
    const pending = active && !terminal.has(active.phase);
    send.disabled = !session || !ready || working || deleting || Boolean(pending) || !input.value.trim();
    stop.hidden = !pending;
    stop.disabled = deleting || stopping || !active?.id;
    web.disabled = !session || !webEnabled || working || Boolean(pending);
    el('delete').hidden = !current;
    el('delete').disabled = deleting || working;
    el('new').disabled = !session || working;
    access.hidden = !gated || session;
    el('composer-wrap').hidden = gated && !session;
    el('starters').hidden = gated || Boolean(current && (messages.childElementCount || active));
  }
  function applyHealth({health, status}) {
    ready = health?.state === 'ready';
    const allowed = Boolean(health?.web.enabled);
    if (allowed && !webEnabled) {
      web.value = everChecked ? lastWebMode : health.web.mode;
    } else if (!allowed && webEnabled) {
      lastWebMode = web.value;
    }
    if (!allowed) web.value = 'off';
    webEnabled = allowed;
    if (health) everChecked = true;
    controls();
    if (AgentAPI.configured && !bootstrapped && status !== 'offline') initialize();
  }
  document.addEventListener('agent-health', event => applyHealth(event.detail));
  if (AgentHealth.current) applyHealth(AgentHealth.current);

  function nearBottom() { return board.scrollHeight - board.scrollTop - board.clientHeight < 104; }
  function bottom() { board.scrollTop = board.scrollHeight; }
  function setHash(id) {
    const hash = id ? `#${id}` : '';
    if (location.hash === hash) return;
    try { history.replaceState(null, '', location.pathname + location.search + hash); }
    catch { location.hash = hash; }
  }
  function drawList() {
    threads.replaceChildren();
    el('history-empty').hidden = items.length > 0;
    for (const item of items) {
      const li = document.createElement('li'), btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'thread-link';
      btn.textContent = item.title;
      btn.title = item.title;
      if (item.id === current) btn.setAttribute('aria-current', 'true');
      btn.addEventListener('click', () => { open(item.id, true); });
      li.append(btn);
      threads.append(li);
    }
  }
  async function refreshList() {
    const epoch = sessionEpoch;
    const result = await api('conversations');
    if (epoch !== sessionEpoch) return;
    items = result.items;
    drawList();
  }
  function closeMobileHistory() {
    el('history-toggle').setAttribute('aria-expanded', 'false');
    el('history').classList.remove('open');
  }
  function reset(id) {
    selection++;
    clearTimeout(pollTimer);
    current = id; active = null; live = null; working = false; deleting = false; stopping = false;
    messages.replaceChildren();
    el('thread-title').textContent = 'New conversation';
    showProblem(); say();
    setHash(id); controls(); drawList();
  }
  async function open(id, moveFocus = false) {
    reset(id);
    closeMobileHistory();
    working = true;
    controls();
    const seq = selection;
    if (moveFocus) {
      el('thread-title').tabIndex = -1;
      el('thread-title').focus();
    }
    try {
      const thread = await api(path(id));
      if (seq !== selection) return;
      el('thread-title').textContent = thread.title;
      for (const turn of thread.turns) appendTurn(turn);
      if (thread.request && !thread.turns.some(turn => turn.id === thread.request.id)) {
        updateRequest(thread.request);
      }
      bottom();
    } catch (error) {
      if (seq !== selection) return;
      if (error.status === 404) reset(null);
      failure(error);
    } finally {
      if (seq === selection) { working = false; controls(); }
    }
  }
  async function initialize(code) {
    if (initializing) return;
    initializing = true;
    const unlock = access.querySelector('button');
    unlock.disabled = true;
    try {
      const establish = async () => {
        const result = await api('session');
        if (result.active) return true;
        if (result.access_required && code === undefined) return false;
        await api('session', 'POST', {code: code || ''});
        return true;
      };
      const established = window.origin !== 'null' && navigator.locks?.request
        ? await navigator.locks.request('coding-agent-session', establish)
        : await establish();
      if (!established) {
        gated = true;
        bootstrapped = true;
        controls();
        return;
      }
      session = true;
      gated = false;
      el('code').value = '';
      showProblem();
      await refreshList();
      bootstrapped = true;
      const hash = location.hash.slice(1);
      if (/^[a-f0-9]{32}$/.test(hash)) await open(hash);
      else if (items.length && !Object.hasOwn(tasks, new URLSearchParams(location.search).get('task'))) await open(items[0].id);
      if (code !== undefined) input.focus();
    } catch (error) {
      if (session) {
        session = false;
        sessionEpoch++;
        reset(null);
      }
      showProblem(error.message, error.status !== 401 || !gated);
    } finally {
      initializing = false;
      unlock.disabled = false;
      controls();
    }
  }
  function failure(error) {
    if (error.status === 401) {
      session = false; bootstrapped = false; sessionEpoch++;
      items = [];
      reset(null);
      initialize();
    }
    showProblem(error.message, !error.status || error.status === 401);
  }

  function addMessage(role, text) {
    const article = document.createElement('article'), name = document.createElement('h3'), content = document.createElement('div');
    article.className = `message ${role}`;
    name.textContent = role === 'user' ? 'You' : 'Coding Agent';
    content.className = 'message-content';
    if (role === 'user') content.textContent = text;
    else renderAnswer(content, text, true);
    article.append(name, content);
    messages.append(article);
    return {article, content};
  }
  async function copyText(text, button, code, state) {
    let ok = false;
    try {
      await navigator.clipboard.writeText(text);
      ok = true;
    } catch {
      const range = document.createRange();
      range.selectNodeContents(code);
      const selected = window.getSelection();
      selected?.removeAllRanges(); selected?.addRange(range);
      try { ok = document.execCommand('copy'); } catch { /* keep the code selected */ }
      if (ok) selected?.removeAllRanges();
    }
    button.textContent = ok ? 'Copied' : 'Code selected';
    state.textContent = ok ? 'Code copied.' : 'Copy unavailable. Use your device’s copy action.';
    setTimeout(() => { button.textContent = 'Copy'; }, 1800);
  }
  function renderAnswer(node, value, finished) {
    const text = value || '';
    const fence = /```([\w+-]*)[ \t]*\r?\n([\s\S]*?)(```|$)/g;
    const fragment = document.createDocumentFragment();
    let match, last = 0;
    while ((match = fence.exec(text))) {
      fragment.append(document.createTextNode(text.slice(last, match.index)));
      const box = document.createElement('div'), bar = document.createElement('div'), lang = document.createElement('span');
      const pre = document.createElement('pre'), code = document.createElement('code');
      box.className = 'codeblock'; bar.className = 'codebar';
      lang.textContent = match[1] || 'Code';
      bar.append(lang);
      code.textContent = match[2].replace(/\r?\n$/, '');
      pre.tabIndex = 0;
      pre.setAttribute('aria-label', `${lang.textContent} code block`);
      if (finished) {
        const button = document.createElement('button'), state = document.createElement('span');
        state.className = 'sr-only'; state.setAttribute('role', 'status');
        button.type = 'button'; button.textContent = 'Copy';
        button.addEventListener('click', () => copyText(code.textContent, button, code, state));
        bar.append(button, state);
      }
      pre.append(code); box.append(bar, pre); fragment.append(box);
      last = fence.lastIndex;
    }
    fragment.append(document.createTextNode(text.slice(last)));
    node.replaceChildren(fragment);
  }
  function renderSources(article, sources) {
    const box = document.createElement('div'), list = document.createElement('ul');
    box.className = 'sources';
    for (const source of sources || []) {
      try {
        const url = new URL(source.url);
        if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) continue;
        const li = document.createElement('li'), link = document.createElement('a');
        link.href = url.href; link.target = '_blank'; link.rel = 'noopener noreferrer';
        link.textContent = source.title || url.hostname;
        li.append(link); list.append(li);
      } catch { /* skip malformed references */ }
    }
    if (list.childElementCount) {
      box.append('Web references', list);
      article.append(box);
    }
  }
  function appendTurn(turn) {
    addMessage('user', turn.prompt);
    const reply = addMessage('assistant', turn.answer);
    renderSources(reply.article, turn.sources);
  }
  function updateRequest(request) {
    if (active?.id === request.id && terminal.has(active.phase) && !terminal.has(request.phase)) return;
    const scroll = nearBottom();
    active = request;
    if (!live || live.id !== request.id) {
      if (live && live.phase !== 'done') for (const n of live.nodes) n.remove();
      const prompt = addMessage('user', request.prompt);
      const reply = addMessage('assistant', '');
      reply.article.hidden = !request.answer;
      live = {id: request.id, nodes: [prompt.article, reply.article], reply, last: undefined, phase: ''};
    }
    const done = terminal.has(request.phase);
    if (request.answer !== live.last || (done && live.phase !== request.phase)) {
      live.last = request.answer;
      live.reply.article.hidden = !request.answer;
      renderAnswer(live.reply.content, request.answer, done);
      if (done) renderSources(live.reply.article, request.sources);
    }
    if (request.phase === 'queued') say(request.position ? `In queue · Position ${request.position}` : 'In queue');
    else if (request.phase === 'lookup') say('Looking up web references…');
    else if (request.phase === 'generating') say('Generating a response…');
    else if (request.phase === 'done') say('Response ready.');
    else if (request.phase === 'cancelled' || request.phase === 'error') {
      say('');
      showProblem(request.message);
      if (!input.value) input.value = request.prompt;
    }
    live.phase = request.phase;
    if (request.phase === 'done') {
      const cid = current;
      refreshList().then(() => {
        if (cid === current) el('thread-title').textContent = items.find(item => item.id === cid)?.title || 'Conversation';
      }).catch(() => {});
    }
    if (!done) schedulePoll();
    if (scroll || done && request.phase !== 'done') bottom();
    controls();
  }
  function schedulePoll(delay = 550) {
    clearTimeout(pollTimer);
    const seq = selection, id = current;
    pollTimer = setTimeout(async () => {
      try {
        const result = await api(`${path(id)}/requests`);
        if (seq !== selection) return;
        if (!result.request || (active?.id && result.request.id !== active.id)) {
          // After a restart a successful turn may be on disk while the active job is gone.
          const previous = active;
          await open(id);
          if (previous && !terminal.has(previous.phase) && !active && current === id) {
            const thread = await api(path(id));
            if (current === id && !thread.turns.some(t => t.id === previous.id)) {
              input.value ||= previous.prompt;
              showProblem('This request was interrupted before it was saved. You can send it again.');
              controls();
            }
          }
          return;
        }
        showProblem();
        updateRequest(result.request);
      } catch (error) {
        if (seq !== selection) return;
        if (error.status === 401) { failure(error); return; }
        showProblem('Connection interrupted. Checking for your response…', true);
        schedulePoll(3000);
      }
    }, delay);
  }
  function requestId() {
    return Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('');
  }
  async function submit(event) {
    event.preventDefault();
    const prompt = input.value.trim();
    if (!prompt || send.disabled) return;
    const lookup = web.value;
    const seq = selection;
    working = true; controls(); showProblem(); say('Sending to host…');
    try {
      if (!current) {
        const convo = await api('conversations', 'POST', {});
        if (seq !== selection) return;
        current = convo.id;
        setHash(current);
        items.unshift(convo);
        el('thread-title').textContent = convo.title;
        drawList();
      }
      const url = `${path(current)}/requests`;
      const payload = {id: requestId(), prompt, web: lookup};
      let result;
      try { result = await api(url, 'POST', payload); } catch (error) {
        if (error.status !== 0 || seq !== selection) throw error;
        // Repeat the same request ID once, so a lost acknowledgement never queues a second turn.
        try { result = await api(url, 'POST', payload); } catch (retryError) {
          if (retryError.status !== 0) throw retryError;
          if (seq !== selection) return;
          result = {id: payload.id, phase: 'queued', prompt, answer: '', message: ''};
        }
      }
      if (seq !== selection) return;
      if (input.value.trim() === prompt) input.value = '';
      updateRequest(result);
      bottom();
      AgentHealth.refresh();
    } catch (error) {
      if (seq === selection) { say(); failure(error); }
    } finally {
      if (seq === selection) { working = false; controls(); }
    }
  }
  form.addEventListener('submit', submit);
  input.addEventListener('input', controls);
  input.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && event.keyCode !== 229) {
      event.preventDefault();
      if (!send.disabled) form.requestSubmit(send);
    }
  });
  access.addEventListener('submit', event => { event.preventDefault(); initialize(el('code').value); });
  el('recover').addEventListener('click', () => {
    AgentHealth.refresh();
    if (active && !terminal.has(active.phase)) schedulePoll(0);
    else if (current && session) open(current);
    else initialize();
  });
  stop.addEventListener('click', async () => {
    if (!active || stopping || terminal.has(active.phase)) return;
    const seq = selection;
    const id = active.id;
    stopping = true;
    controls();
    clearTimeout(pollTimer);
    try {
      const response = await api(`${path(current)}/requests/${id}`, 'DELETE');
      if (seq !== selection) return;
      updateRequest(response);
      input.focus();
      AgentHealth.refresh();
    } catch (error) {
      if (seq === selection) { failure(error); if (active) schedulePoll(); }
    } finally {
      if (seq === selection) { stopping = false; controls(); }
    }
  });
  el('history-toggle').addEventListener('click', () => {
    const expanded = el('history').classList.toggle('open');
    el('history-toggle').setAttribute('aria-expanded', String(expanded));
  });
  el('new').addEventListener('click', () => { reset(null); closeMobileHistory(); input.value = ''; input.focus(); controls(); });
  window.addEventListener('hashchange', () => {
    const hash = location.hash.slice(1);
    if (session && hash !== (current || '') && /^[a-f0-9]{32}$/.test(hash)) open(hash);
  });
  el('delete').addEventListener('click', () => { dialog.returnValue = ''; dialog.showModal(); });
  dialog.addEventListener('close', async () => {
    if (dialog.returnValue !== 'delete' || !current) return;
    const seq = selection, id = current;
    deleting = true; controls();
    try {
      await api(path(id), 'DELETE');
      if (seq !== selection) return;
      reset(null); input.value = ''; input.focus();
      await refreshList();
    } catch (error) {
      if (seq === selection || !current) failure(error);
    } finally {
      deleting = false; controls();
    }
  });
  function fill(task, focus) {
    if (!Object.hasOwn(tasks, task)) return;
    input.value = tasks[task];
    if (focus) { input.focus(); input.setSelectionRange(input.value.length, input.value.length); }
    controls();
  }
  document.querySelectorAll('[data-task]').forEach(button => {
    button.addEventListener('click', () => fill(button.dataset.task, true));
  });
  fill(new URLSearchParams(location.search).get('task'), false);
  if (AgentAPI.configured) initialize();
})();
