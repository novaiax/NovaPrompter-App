import { readJson } from '../shared/settings.js';

const $ = selector => document.querySelector(selector);
const KEY = 'novaprompter:sync';
export function setupIntegrations(bridge, { snapshot, merge, notify }) {
  const config = { server: '', token: '', email: '', auto: false, ...readJson(KEY, {}) };
  config.server = String(config.server || '').trim().replace(/\/+$/, '');
  let revision = 0;
  let cloudBusy = false;
  let timer;
  let pending = false;
  let obsConnected = false;

  function persist() {
    try { localStorage.setItem(KEY, JSON.stringify(config)); }
    catch { notify('Les réglages de synchronisation n’ont pas pu être enregistrés.'); }
  }

  function renderCloud() {
    const connected = Boolean(config.server && config.token);
    $('#cloud-server').value = config.server;
    $('#cloud-server').disabled = connected || cloudBusy;
    $('#cloud-email').value = config.email || $('#cloud-email').value;
    $('#cloud-login').hidden = connected;
    $('#cloud-auth-actions').hidden = connected;
    $('#cloud-sync-actions').hidden = !connected;
    $('#cloud-autosync-wrap').hidden = !connected;
    $('#cloud-autosync').checked = Boolean(config.auto);
    $('#cloud-status').textContent = connected ? `Connecté · ${config.email || 'Compte NovaPrompter'}` : 'Non connecté';
  }

  function setCloudBusy(busy) {
    cloudBusy = busy;
    $('#cloud-server').disabled = busy || Boolean(config.token);
    for (const button of ['cloud-signin', 'cloud-signup', 'cloud-sync']) $(`#${button}`).disabled = busy;
  }

  function server(value) {
    let parsed;
    try { parsed = new URL(value); } catch {}
    if (!parsed || parsed.username || parsed.password || parsed.search || parsed.hash
      || !(parsed.protocol === 'https:' || (parsed.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(parsed.hostname)))) {
      throw new Error('Saisissez une adresse HTTPS ou une adresse locale valide.');
    }
    return parsed.href.replace(/\/+$/, '');
  }

  async function api(route, { body, url = config.server, token = config.token } = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = 'Bearer ' + token;
    const response = await fetch(server(url) + route, {
      method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(12_000)
    });
    if (response.ok) return response.json();
    throw new Error(({
      400: 'Vérifiez les informations saisies.', 401: 'Connexion refusée. Vérifiez vos identifiants ou reconnectez-vous.',
      409: 'Un compte utilise déjà cette adresse e-mail.', 413: 'La bibliothèque est trop volumineuse pour le serveur.'
    })[response.status] || `Le serveur a répondu avec le statut ${response.status}.`);
  }

  function failure(error) {
    $('#cloud-status').textContent = error instanceof TypeError || error.name === 'TimeoutError'
      ? 'Serveur inaccessible. Vérifiez l’adresse et votre connexion.' : error.message;
  }

  async function sync() {
    if (!config.token) return;
    if (cloudBusy) { pending = true; return; }
    setCloudBusy(true);
    const version = revision;
    const sent = snapshot();
    $('#cloud-status').textContent = 'Synchronisation…';
    try {
      const result = await api('/sync', { body: sent.payload });
      if (version !== revision) return;
      merge(result, sent);
      $('#cloud-status').textContent = 'Synchronisé à ' + new Intl.DateTimeFormat('fr', { timeStyle: 'short' }).format(new Date());
    } catch (error) {
      if (version === revision) failure(error);
    } finally {
      setCloudBusy(false);
      if (pending) {
        pending = false;
        schedule();
      }
    }
  }

  async function authenticate(route) {
    const email = $('#cloud-email').value.trim();
    const password = $('#cloud-password').value;
    if (!email || !$('#cloud-email').checkValidity() || !password) {
      $('#cloud-status').textContent = 'Renseignez une adresse e-mail et un mot de passe.';
      return;
    }
    setCloudBusy(true);
    try {
      const url = server($('#cloud-server').value);
      const account = await api('/auth/' + route, { url, body: { email, password }, token: '' });
      if (!account.token) throw new Error('Réponse de connexion incomplète.');
      config.server = url;
      config.email = email;
      config.token = account.token;
      $('#cloud-password').value = '';
      revision++;
      persist();
      renderCloud();
    } catch (error) { failure(error); }
    finally { setCloudBusy(false); }
    if (config.token) sync();
  }

  function schedule() {
    clearTimeout(timer);
    if (config.auto && config.token) timer = setTimeout(sync, 3000);
  }

  renderCloud();
  $('#cloud-server').addEventListener('change', event => {
    config.server = event.target.value.trim();
    persist();
  });
  $('#cloud-signin').addEventListener('click', () => authenticate('login'));
  $('#cloud-signup').addEventListener('click', () => authenticate('register'));
  $('#cloud-sync').addEventListener('click', sync);
  $('#cloud-signout').addEventListener('click', () => {
    revision++;
    clearTimeout(timer);
    pending = false;
    config.token = '';
    config.auto = false;
    persist();
    renderCloud();
  });
  $('#cloud-autosync').addEventListener('change', event => {
    config.auto = event.target.checked;
    persist();
    schedule();
  });

  function renderObs() {
    $('#connect-obs').textContent = obsConnected ? 'Déconnecter OBS' : 'Connecter OBS';
    $('#obs-scene').hidden = $('#switch-scene').hidden = !obsConnected;
  }
  bridge.onObsClose(() => {
    obsConnected = false;
    $('#obs-status').textContent = 'Non connecté';
    renderObs();
  });
  $('#connect-obs').addEventListener('click', async event => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      if (obsConnected) {
        await bridge.disconnectObs();
        obsConnected = false;
        $('#obs-status').textContent = 'Non connecté';
      } else {
        $('#obs-status').textContent = 'Connexion à OBS…';
        const { scenes, current } = await bridge.connectObs({
          url: $('#obs-address').value.trim(), password: $('#obs-password').value
        });
        $('#obs-password').value = '';
        $('#obs-scene').replaceChildren(...scenes.map(scene => new Option(scene, scene, false, current === scene)));
        $('#obs-status').textContent = 'OBS connecté';
        obsConnected = true;
      }
    } catch (error) {
      $('#obs-status').textContent = error.message.replace(/^Error invoking remote method .*?: Error: /, '');
    } finally {
      renderObs();
      button.disabled = false;
    }
  });
  $('#switch-scene').addEventListener('click', async () => {
    const scene = $('#obs-scene').value;
    if (!scene) return;
    try {
      await bridge.setObsScene(scene);
      $('#obs-status').textContent = 'Scène active · ' + scene;
    } catch { $('#obs-status').textContent = 'Impossible de changer la scène OBS.'; }
  });

  return { schedule };
}
