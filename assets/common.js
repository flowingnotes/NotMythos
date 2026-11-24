/* GitHub Pages serves only files. Requests go to the configured AI host. */
const AgentAPI = (() => {
  const loopback = host => ['localhost', '127.0.0.1'].includes(host);
  const tokenPattern = /^[A-Za-z0-9_-]{43}$/;
  const origin = (() => {
    try {
      const url = new URL(globalThis.CODING_AGENT_API_ORIGIN?.trim());
      if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) return null;
      if (url.protocol === 'https:' || (
        url.protocol === 'http:' && loopback(url.hostname) && loopback(location.hostname)
      )) return url.origin;
    } catch { /* an unset or invalid endpoint is rendered as setup required */ }
    return null;
  })();
  const key = `coding-agent:session:v1:${new URL('.', location.href).pathname}:${origin}`;
  let memory = null, storageAvailable = true;
  function readToken() {
    if (storageAvailable) {
      try { return localStorage.getItem(key); } catch { storageAvailable = false; }
    }
    return memory;
  }
  function saveToken(token) {
    memory = token;
    if (!storageAvailable) return;
    try {
      if (token) localStorage.setItem(key, token);
      else localStorage.removeItem(key);
    } catch { storageAvailable = false; }
  }
  async function request(path, method = 'GET', body) {
    if (!origin) throw Object.assign(new Error('The AI host is not configured.'), {status: 0});
    const saved = path === 'health' ? null : readToken();
    const headers = {};
    if (saved && tokenPattern.test(saved)) headers.Authorization = `Bearer ${saved}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const control = new AbortController();
    const timer = setTimeout(() => control.abort(), 6500);
    try {
      const response = await fetch(`${origin}/api/${path}`, {
        method, headers, credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer',
        signal: control.signal, cache: 'no-store',
        ...(body === undefined ? {} : {body: JSON.stringify(body)}),
      });
      if (response.status === 204) return null;
      let result;
      try { result = await response.json(); } catch {
        const missing = new Error('The host is not responding. Check the connection and try again.');
        missing.status = response.status === 200 ? 0 : response.status;
        throw missing;
      }
      if (!response.ok) throw Object.assign(new Error(result.error || 'The host couldn’t complete this request.'), {status: response.status});
      if (path === 'session' && method === 'GET' && !result.active && saved && saved === readToken()) {
        saveToken(null);
      }
      if (path === 'session' && method === 'POST' && response.status === 201) {
        if (typeof result.token !== 'string' || !tokenPattern.test(result.token)) {
          throw Object.assign(new Error('The host did not return a valid browser session.'), {status: 0});
        }
        saveToken(result.token);
        return {active: result.active, expires_days: result.expires_days};
      }
      return result;
    } catch (error) {
      if (error instanceof TypeError || error.name === 'AbortError') {
        throw Object.assign(new Error('Connection interrupted. Try again when the host responds.'), {status: 0});
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
  return {request, configured: Boolean(origin)};
})();

const AgentHealth = (() => {
  let flight = null, timer, current;
  const models = {
    checking: ['Checking host', 'Checking whether the host can accept requests.'],
    ready: ['Host ready', 'The model can accept a request now.'],
    demo: ['Demo mode', 'This preview uses scripted replies, not the Qwen model.'],
    busy: ['Host busy', 'The host is processing a response. New requests can join the queue.'],
    full: ['Queue full', 'All waiting spots are taken. Try again shortly.'],
    starting: ['Model starting', 'The host is loading the model. Try again when it’s ready.'],
    unavailable: ['Model unavailable', 'The host is online, but the model couldn’t start. Contact the operator if this persists.'],
    offline: ['Host offline', 'Can’t reach the host. The page will check again automatically.'],
    unconfigured: ['Host not configured', 'The website operator needs to connect this site to the AI host.'],
  };
  function paint(health, status) {
    const state = {health, status};
    current = state;
    const [label, description] = models[status];
    const values = {
      label, description, chat: description,
      engine: health?.model || 'Not reported',
      adapter: health?.state === 'ready' ? health.adapter || (health.demo ? 'Not used in demo' : 'Base model only') : 'Not reported',
      queue: health?.state === 'ready' ? `${health.queued} of ${health.capacity} waiting spots used` : 'Not reported',
      web: health ? (health.web.enabled ? 'Available' : 'Off') : 'Not reported',
    };
    document.querySelectorAll('.host-status').forEach(node => { node.dataset.status = status; });
    document.querySelectorAll('[data-health]').forEach(node => {
      const text = values[node.dataset.health];
      if (node.textContent !== text) node.textContent = text;
    });
    if (health?.session_days) {
      document.querySelectorAll('[data-session-days]').forEach(node => {
        node.textContent = health.session_days;
      });
    }
    const connection = document.getElementById('connection');
    if (connection) {
      connection.hidden = !['offline', 'unavailable', 'starting', 'demo', 'unconfigured'].includes(status) && !health?.demo;
      const text = connection.querySelector('[data-health]');
      if (health?.demo && status !== 'demo') text.textContent = `${models.demo[1]} ${description}`;
      connection.querySelector('button').hidden = Boolean(health?.demo) || status === 'unconfigured';
    }
    document.dispatchEvent(new CustomEvent('agent-health', {detail: state}));
  }
  function refresh() {
    if (!AgentAPI.configured) return Promise.resolve(current);
    if (flight) return flight;
    clearTimeout(timer);
    flight = (async () => {
      try {
        const h = await AgentAPI.request('health');
        const status = h.state === 'ready'
          ? (h.queued >= h.capacity ? 'full' : h.busy ? 'busy' : h.demo ? 'demo' : 'ready')
          : (models[h.state] ? h.state : 'unavailable');
        paint(h, status);
      } catch {
        paint(null, 'offline');
      } finally {
        flight = null;
        timer = setTimeout(refresh, document.hidden ? 25000 : 6000);
      }
      return current;
    })();
    return flight;
  }
  document.querySelectorAll('[data-refresh]').forEach(button => button.addEventListener('click', async () => {
    if (button.getAttribute('aria-busy') === 'true') return;
    const saved = button.textContent;
    button.setAttribute('aria-busy', 'true');
    button.textContent = 'Checking…';
    await refresh();
    button.removeAttribute('aria-busy');
    button.textContent = saved;
  }));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
  window.addEventListener('online', refresh);
  if (AgentAPI.configured) refresh();
  else {
    paint(null, 'unconfigured');
    document.querySelectorAll('[data-refresh]').forEach(button => { button.disabled = true; });
  }
  return {refresh, get current() { return current; }};
})();
