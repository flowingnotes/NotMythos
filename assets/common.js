// Shared by every page: where the model server lives + a health check.
const Api = (() => {
  const KEY = 'agent.apiBase';
  const onLocal = ['localhost', '127.0.0.1'].includes(location.hostname);
  // Opened from the local server: talk to it directly. From GitHub Pages: your own computer.
  const fallback = onLocal ? location.origin : 'http://localhost:8000';
  function get() {
    try { return (localStorage.getItem(KEY) || fallback).replace(/\/+$/, ''); } catch (e) { return fallback; }
  }
  function set(v) {
    try { v ? localStorage.setItem(KEY, v.replace(/\/+$/, '')) : localStorage.removeItem(KEY); } catch (e) { /* storage blocked */ }
  }
  async function health(timeoutMs = 4000) {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), timeoutMs);
    try {
      const r = await fetch(get() + '/api/health', { signal: c.signal, cache: 'no-store' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.json();
    } finally { clearTimeout(t); }
  }
  return { get, set, health, fallback };
})();
