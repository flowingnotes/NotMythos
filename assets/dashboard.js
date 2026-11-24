(function () {
  const $ = (id) => document.getElementById(id);
  async function refresh() {
    try {
      const h = await Api.health();
      $('dot').className = 'dot ok';
      $('state').textContent = h.busy ? 'Online (busy)' : 'Online';
      $('model').textContent = h.model || '-';
      $('adapter').textContent = h.adapter || 'base model';
      $('web').textContent = h.web && h.web.enabled ? 'On (' + h.web.mode + ')' : 'Off';
      $('help').classList.remove('show');
    } catch (e) {
      $('dot').className = 'dot bad';
      $('state').textContent = 'Offline';
      $('model').textContent = '-';
      $('adapter').textContent = '-';
      $('web').textContent = '-';
      $('help').classList.add('show');
    }
    $('api').textContent = Api.get();
  }
  refresh();
  setInterval(refresh, 5000);
})();
