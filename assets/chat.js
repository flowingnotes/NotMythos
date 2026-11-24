(function () {
  const $ = (id) => document.getElementById(id);
  const log = $('log'), input = $('input'), sendBtn = $('send'), stopBtn = $('stop');
  const STORE = 'agent.chat', WEBKEY = 'agent.web';
  let history = [];      // [{role, content}]
  let ctrl = null;       // AbortController of the running request

  // ---- persistence (best effort)
  function save() { try { localStorage.setItem(STORE, JSON.stringify(history.slice(-40))); } catch (e) {} }
  function load() { try { history = JSON.parse(localStorage.getItem(STORE) || '[]').filter(m => m && typeof m.content === 'string'); } catch (e) { history = []; } }

  // ---- safe rendering: never uses innerHTML with model/web text
  function render(el, text) {
    el.textContent = '';
    const re = /```([\w+-]*)\n?([\s\S]*?)(```|$)/g;
    let last = 0, m;
    while ((m = re.exec(text)) !== null) {
      if (m.index > last) el.append(document.createTextNode(text.slice(last, m.index)));
      const pre = document.createElement('pre'), code = document.createElement('code');
      code.textContent = m[2].replace(/\n$/, '');
      const btn = document.createElement('button');
      btn.className = 'copy'; btn.textContent = 'Copy';
      btn.onclick = () => navigator.clipboard && navigator.clipboard.writeText(code.textContent).then(() => { btn.textContent = 'Copied'; setTimeout(() => btn.textContent = 'Copy', 1200); });
      pre.append(btn, code); el.append(pre);
      last = re.lastIndex;
      if (m[0] === '') re.lastIndex++;
    }
    if (last < text.length) el.append(document.createTextNode(text.slice(last)));
  }
  function addMsg(role, text) {
    const d = document.createElement('div');
    d.className = 'msg ' + role;
    render(d, text);
    log.append(d); log.scrollTop = log.scrollHeight;
    return d;
  }
  function addSources(parent, sources) {
    const box = document.createElement('div'); box.className = 'sources';
    box.append(document.createTextNode('Sources: '));
    sources.forEach((s, i) => {
      if (!/^https?:\/\//i.test(s.url)) return;
      const a = document.createElement('a');
      a.href = s.url; a.target = '_blank'; a.rel = 'noopener noreferrer';
      a.textContent = '[' + s.n + '] ' + (s.title || s.url).slice(0, 60);
      box.append(a);
      if (i < sources.length - 1) box.append(document.createTextNode('  '));
    });
    parent.append(box);
  }

  // ---- connection status
  async function checkServer() {
    try {
      const h = await Api.health();
      $('dot').className = 'dot ok'; $('state').textContent = h.busy ? 'Online (busy)' : 'Online';
      $('banner').classList.remove('show');
      return true;
    } catch (e) {
      $('dot').className = 'dot bad'; $('state').textContent = 'Offline';
      $('banner').classList.add('show');
      return false;
    }
  }

  // ---- sending
  function setBusy(b) {
    sendBtn.disabled = b; input.disabled = b;
    stopBtn.style.display = b ? '' : 'none';
    if (!b) input.focus();
  }
  async function send() {
    const text = input.value.trim();
    if (!text || ctrl) return;
    input.value = ''; autosize();
    history.push({ role: 'user', content: text });
    addMsg('user', text); save();
    const bubble = addMsg('assistant', '');
    const status = document.createElement('div'); status.className = 'statusline'; status.textContent = 'Thinking...';
    log.append(status);
    let answer = '', sources = [], failed = false, pending = false;
    const paint = () => { pending = false; render(bubble, answer); log.scrollTop = log.scrollHeight; };

    ctrl = new AbortController(); setBusy(true);
    try {
      const res = await fetch(Api.get() + '/api/chat', {
        method: 'POST', signal: ctrl.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: history.slice(-12), web: $('web').value }),
      });
      if (!res.ok) {
        let msg = 'HTTP ' + res.status;
        try { msg = (await res.json()).error || msg; } catch (e) {}
        throw new Error(msg);
      }
      const reader = res.body.getReader(), dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
          if (!line) continue;
          let ev; try { ev = JSON.parse(line); } catch (e) { continue; }
          if (ev.type === 'status') status.textContent = ev.text;
          else if (ev.type === 'sources') sources = ev.sources || [];
          else if (ev.type === 'token') { status.textContent = ''; answer += ev.text; if (!pending) { pending = true; requestAnimationFrame(paint); } }
          else if (ev.type === 'error') { failed = true; answer += (answer ? '\n\n' : '') + '[error] ' + ev.message; }
        }
      }
    } catch (e) {
      if (e.name === 'AbortError') answer += (answer ? '\n' : '') + '[stopped]';
      else { failed = true; answer += (answer ? '\n\n' : '') + '[error] ' + (e.message === 'Failed to fetch' ? 'Cannot reach the model server. Is ./launch.sh serve running?' : e.message); checkServer(); }
    } finally {
      render(bubble, answer || '(no response)');
      if (sources.length) addSources(bubble, sources);
      status.remove();
      if (answer && !failed) { history.push({ role: 'assistant', content: answer }); save(); }
      else if (failed) { history.pop(); save(); }   // don't keep a failed turn in the context
      ctrl = null; setBusy(false);
    }
  }

  function autosize() { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 180) + 'px'; }

  // ---- wiring
  sendBtn.onclick = send;
  stopBtn.onclick = () => ctrl && ctrl.abort();
  input.addEventListener('input', autosize);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });
  $('clear').onclick = () => { if (ctrl) ctrl.abort(); history = []; save(); log.textContent = ''; };
  $('retry').onclick = checkServer;
  $('settings').onclick = () => {
    const v = prompt('Model server address (leave empty for the default):', Api.get());
    if (v === null) return;
    const t = v.trim();
    if (t && !/^https?:\/\/[^\s]+$/i.test(t)) { alert('Enter a full address like http://localhost:8000'); return; }
    Api.set(t); checkServer();
  };
  try { $('web').value = localStorage.getItem(WEBKEY) || 'auto'; } catch (e) {}
  $('web').onchange = () => { try { localStorage.setItem(WEBKEY, $('web').value); } catch (e) {} };

  load();
  history.forEach(m => addMsg(m.role, m.content));
  checkServer(); setInterval(checkServer, 5000);
  input.focus();
})();
