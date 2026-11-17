const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const http = require('node:http');
const { once } = require('node:events');
const { _electron } = require('playwright-core');
const { WebSocketServer } = require('ws');

const repo = path.resolve(__dirname, '..');
const executablePath = process.env.NOVAPROMPTER_TEST_EXE
  ? path.resolve(process.env.NOVAPROMPTER_TEST_EXE) : require('electron');
const packaged = Boolean(process.env.NOVAPROMPTER_TEST_EXE);
const line = 'Bonjour tout le monde. Ceci est un test de lecture. Nous parlons de la voix française. Merci de votre attention.';

function powerShell(script, params) {
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-File', path.join(__dirname, script), ...params], { encoding: 'utf8', windowsHide: true, timeout: 15_000 });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
}

async function launch(profile, extra = []) {
  const app = await _electron.launch({
    executablePath, args: [...(packaged ? [] : ['.']), '--user-data-dir=' + profile, ...extra], cwd: repo,
    timeout: 25_000
  });
  try {
    const page = await app.firstWindow();
    await page.locator('#script-list button').first().waitFor({ timeout: 8000 });
    return { app, page };
  } catch (error) {
    await app.close();
    throw error;
  }
}

async function waitText(page, selector, expect, timeout = 6000) {
  await page.waitForFunction(({ selector, expect }) => document.querySelector(selector)?.textContent.includes(expect),
    { selector, expect }, { timeout });
}

async function phase(page, expected, timeout = 8000) {
  await page.waitForFunction(expected => document.querySelector('#transport-light').dataset.phase === expected, expected, { timeout });
}

async function slider(page, selector, value) {
  await page.locator(selector).evaluate((node, value) => {
    node.value = value;
    node.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
}

function controls(page) {
  return {
    id: id => page.locator('#' + id),
    click: id => page.locator('#' + id).click(),
    field: (id, content) => page.locator('#' + id).fill(content),
    text: id => page.locator('#' + id).textContent()
  };
}

async function readNative(app, key, action) {
  return app.evaluate(({ BrowserWindow, screen }, { key, action }) => {
    const window = BrowserWindow.getAllWindows().find(item => item.getTitle().startsWith(key));
    if (!window) return null;
    if (action === 'focus') window.focus();
    if (action === 'compact') window.setBounds({ x: 50, y: 55, width: 510, height: 310 });
    if (action === 'clear-top') window.setAlwaysOnTop(false);
    return {
      ...window.getBounds(), minimized: window.isMinimized(), maximized: window.isMaximized(),
      fullscreen: window.isFullScreen(), pinned: window.isAlwaysOnTop(),
      scale: screen.getDisplayMatching(window.getBounds()).scaleFactor,
      handle: window.getNativeWindowHandle().readBigUInt64LE().toString()
    };
  }, { key, action });
}

async function useSettings(page, name = 'display') {
  await page.locator('#open-settings').click();
  await page.locator('#tab-' + name).click();
}

async function closeSettings(page) {
  await page.locator('#settings-dialog .dialog-footer [data-close]').click();
}

function mockServer() {
  const payloads = [];
  const server = http.createServer(async (req, res) => {
    res.setHeader('access-control-allow-origin', '*');
    res.setHeader('access-control-allow-methods', 'POST, OPTIONS');
    res.setHeader('access-control-allow-headers', 'authorization,content-type');
    res.setHeader('content-type', 'application/json');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
    let input = '';
    for await (const data of req) input += data;
    payloads.push({ route: req.url, body: JSON.parse(input), authorization: req.headers.authorization });
    if (req.url === '/auth/login') {
      res.end(JSON.stringify({ token: 'test-local-token' }));
    } else if (req.url === '/sync') {
      const scripts = [{ id: 'from-companion', title: 'Script synchronisé', content: 'Depuis le serveur de test.', updatedAt: 50 }];
      res.end(JSON.stringify({ scripts, tags: null }));
    } else { res.writeHead(404); res.end('{}'); }
  });
  const obs = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  const sceneChanges = [];
  obs.on('connection', ws => {
    const send = message => ws.send(JSON.stringify(message));
    send({ op: 0, d: { obsWebSocketVersion: '5.0.0', rpcVersion: 1 } });
    ws.on('message', data => {
      const { op, d } = JSON.parse(data);
      if (op === 1) send({ op: 2, d: { negotiatedRpcVersion: 1 } });
      if (op === 6) {
        if (d.requestType === 'SetCurrentProgramScene') sceneChanges.push(d.requestData.sceneName);
        send({ op: 7, d: {
          requestType: d.requestType, requestId: d.requestId, requestStatus: { result: true, code: 100 },
          responseData: d.requestType === 'GetSceneList'
            ? { currentProgramSceneName: 'Studio', scenes: [{ sceneName: 'Studio' }, { sceneName: 'Lecture' }] } : {}
        } });
      }
    });
  });
  server.listen(0, '127.0.0.1');
  return { server, obs, payloads, sceneChanges };
}

test('NovaPrompter Windows', { timeout: 160_000 }, async t => {
  const build = path.join(repo, 'build');
  await fs.mkdir(build, { recursive: true });
  const root = await fs.mkdtemp(path.join(build, 'test-desktop-'));
  const wav = path.join(root, 'voice-fr.wav');
  const profile = path.join(root, 'profile');
  const errors = [];
  let app, page, reader;
  const mocks = mockServer();
  await Promise.all([once(mocks.server, 'listening'), once(mocks.obs, 'listening')]);
  try {
    powerShell('make-voice-fixture.ps1', ['-Output', wav]);
    ({ app, page } = await launch(profile, ['--use-fake-device-for-media-stream', '--use-file-for-fake-audio-capture=' + wav]));
    page.on('pageerror', error => errors.push(error.message));
    const ui = controls(page);

    await t.test('bibliothèque, autosauvegarde, recherche, aperçu, nettoyage et annulation', async () => {
      assert.equal(await page.title(), 'NovaPrompter by novaiaweb');
      assert.equal(await page.locator('.app-titlebar .brand-credit').textContent(), 'by novaiaweb');
      assert.ok(await page.locator('.app-titlebar img').evaluate(img => img.complete && img.naturalWidth === 256));
      assert.equal(await ui.id('script-title').inputValue(), 'Une première lecture');
      await ui.click('new-script');
      await ui.field('script-title', 'Test voix et fenêtres');
      await ui.field('script-body', '1\n00:00:00,000 --> 00:00:02,000\n# **Bonjour**   [pause]');
      await ui.click('open-clean');
      assert.equal(await ui.id('clean-after').inputValue(), 'Bonjour [pause]');
      await ui.id('clean-time').uncheck();
      assert.match(await ui.id('clean-after').inputValue(), /00:00:00/);
      await ui.id('clean-time').check();
      await ui.click('apply-clean');
      assert.equal(await ui.id('script-body').inputValue(), 'Bonjour [pause]');
      await ui.click('toast-action');
      assert.match(await ui.id('script-body').inputValue(), /\*\*Bonjour\*\*/);
      await ui.field('script-body', line);
      await waitText(page, '#save-label', 'Enregistré');
      await ui.field('search-scripts', 'introuvable');
      await waitText(page, '#no-results', 'Aucun script trouvé');
      await ui.field('search-scripts', 'fenêtres');
      assert.equal(await page.locator('.script-item').count(), 1);
      await ui.field('search-scripts', '');
      assert.equal(await page.locator('video, [id*=recorder], [id*=cam-device]').count(), 0);
    });

    await t.test('prompteur synchronisé, toujours au premier plan et réduction réelle', async () => {
      const spawned = app.waitForEvent('window');
      await ui.click('open-reader');
      reader = await spawned;
      reader.on('pageerror', error => errors.push(error.message));
      await reader.locator('.reading-word').first().waitFor();
      assert.equal(await reader.locator('.reading-word').first().textContent(), 'Bonjour');
      assert.equal(await reader.title(), 'Prompteur · NovaPrompter by novaiaweb');
      assert.equal(await reader.locator('.reader-brand .brand-credit').textContent(), 'by novaiaweb');
      await reader.waitForFunction(() => document.hasFocus() || document.visibilityState === 'visible');
      assert.equal((await readNative(app, 'Prompteur')).pinned, true);
      await reader.locator('#btn-pin').click();
      await reader.waitForFunction(() => document.querySelector('#btn-pin').getAttribute('aria-pressed') === 'false');
      assert.equal((await readNative(app, 'Prompteur')).pinned, false);
      await reader.locator('#btn-min').click();
      await waitText(page, '#open-reader-label', 'Afficher');
      assert.equal((await readNative(app, 'Prompteur')).minimized, true);
      await ui.click('open-reader');
      assert.equal((await readNative(app, 'Prompteur')).minimized, false);
      await reader.locator('#btn-max').click();
      assert.equal((await readNative(app, 'Prompteur')).maximized, true);
      await reader.locator('#btn-max').click();
      assert.equal((await readNative(app, 'Prompteur')).maximized, false);
      await reader.keyboard.press('F11');
      await reader.waitForFunction(() => document.body.classList.contains('fullscreen'));
      await reader.keyboard.press('Escape');
      await reader.waitForFunction(() => !document.body.classList.contains('fullscreen'));
    });

    await t.test('micro sélectionné, capture PCM, reconnaissance française et déplacement en Voix', { timeout: 38_000 }, async () => {
      const close = reader.waitForEvent('close');
      await reader.locator('#btn-close').click();
      await close;
      await ui.click('test-mic');
      await waitText(page, '#voice-status', 'Microphone actif');
      await page.waitForFunction(() => document.querySelectorAll('#mic-device option').length > 1, null, { timeout: 5000 });
      await page.waitForFunction(() => document.querySelectorAll('#mic-meter .lit').length > 1, null, { timeout: 7000 });
      const device = await page.locator('#mic-device option').nth(1).getAttribute('value');
      await ui.id('mic-device').selectOption(device);
      await waitText(page, '#voice-status', 'Microphone actif');
      assert.equal(await ui.id('mic-device').inputValue(), device);
      await ui.click('test-mic');
      await waitText(page, '#voice-status', 'veille');
      const shown = app.waitForEvent('window');
      await ui.click('open-reader');
      reader = await shown;
      await reader.locator('.reading-word').first().waitFor();
      await readNative(app, 'Prompteur', 'compact');
      if (await reader.locator('#btn-pin').getAttribute('aria-pressed') === 'false') {
        await reader.locator('#btn-pin').click();
        await reader.waitForFunction(() => document.querySelector('#btn-pin').getAttribute('aria-pressed') === 'true');
      }
      await readNative(app, 'Prompteur', 'focus');

      await reader.locator('#btn-play').click();
      await phase(page, 'playing', 18_000);
      await page.waitForFunction(() => Number(document.querySelector('#progress').value) >= 90, null, { timeout: 13000 });
      assert.match(await ui.text('transcript'), /bonjour|monde|ceci|test|lecture|parlons|voix|française|merci|attention/i);
      if (process.env.NOVAPROMPTER_NATIVE_MOUSE === '1') {
        const before = await readNative(app, 'Prompteur', 'focus');
        const nativeAction = (action, bounds) => powerShell('windows-mouse.ps1', ['-Action', action,
          '-X', bounds.x, '-Y', bounds.y, '-Width', bounds.width, '-Height', bounds.height, '-Scale', bounds.scale, '-Handle', bounds.handle].map(String));
        nativeAction('drag', before);
        const moved = await readNative(app, 'Prompteur');
        assert.ok(Math.abs(moved.x - before.x) >= 20 && Math.abs(moved.y - before.y) >= 20, [before, moved].map(JSON.stringify).join(' → '));
        nativeAction('resize', moved);
        const bigger = await readNative(app, 'Prompteur');
        assert.ok(bigger.width > moved.width + 25 && bigger.height > moved.height + 20, [moved, bigger].map(JSON.stringify).join(' → '));
        nativeAction('shrink', bigger);
        const shrunk = await readNative(app, 'Prompteur');
        assert.ok(shrunk.width < bigger.width && shrunk.height < bigger.height, [bigger, shrunk].map(JSON.stringify).join(' → '));
        await reader.locator('#resize-grip').focus();
        await reader.keyboard.press('ArrowLeft');
        await reader.keyboard.press('ArrowUp');
        const smaller = await readNative(app, 'Prompteur');
        assert.ok(smaller.width < shrunk.width && smaller.height < shrunk.height);
      }
      await page.waitForFunction(() => Number(document.querySelector('#progress').value) >= 750, null, { timeout: 13000 });
      if ((await ui.text('play-label')) === 'Pause') await ui.click('play');
      const progressBefore = Number(await ui.id('progress').inputValue());
      await reader.locator('#stage').hover();
      await reader.mouse.wheel(0, -300);
      await page.waitForFunction(before => Number(document.querySelector('#progress').value) < before, progressBefore, { timeout: 5000 });
      assert.match(await ui.text('voice-status'), /veille/);
      const expectedBounds = await readNative(app, 'Prompteur');
      const finished = reader.waitForEvent('close');
      await reader.locator('#btn-close').click();
      await finished;
      const reopened = app.waitForEvent('window');
      await ui.click('open-reader');
      reader = await reopened;
      await reader.locator('#stage').waitFor();
      const bounds = await readNative(app, 'Prompteur');
      assert.equal(bounds.width, expectedBounds.width);
      assert.equal(bounds.height, expectedBounds.height);
      assert.equal(bounds.x, expectedBounds.x);
      assert.equal(bounds.y, expectedBounds.y);
    });

    await t.test('auto, vitesse, compte à rebours, repère de pause et fin de lecture', async () => {
      const closed = reader.waitForEvent('close');
      await reader.locator('#btn-close').click();
      await closed;
      await ui.click('mode-auto');
      await ui.field('script-body', '[pause] Un bref test de lecture.');
      await ui.click('reset-position');
      await useSettings(page, 'playback');
      await page.locator('[data-setting=countdown]').selectOption('3');
      await closeSettings(page);
      await slider(page, '#pace', 320);
      await ui.click('play');
      await phase(page, 'countdown');
      await phase(page, 'holding');
      await phase(page, 'done');
      assert.equal(await ui.text('progress-label'), '100 %');
      await ui.click('reset-position');
      assert.equal(await ui.text('progress-label'), '0 %');
      await useSettings(page, 'playback');
      await page.locator('[data-setting=countdown]').selectOption('0');
      await page.locator('#tab-display').click();
      await page.locator('[data-setting=mirrorH]').check();
      await page.locator('#reader-theme').selectOption('light');
      await closeSettings(page);
      assert.equal(await page.locator('#preview').evaluate(element => element.style.getPropertyValue('--flip-x')), '-1');
    });

    await t.test('import et export natifs, repère, duplication et suppression réversible', async () => {
      const imported = path.join(root, 'Un récit.md');
      const exported = path.join(root, 'Export.txt');
      const backup = path.join(root, 'Bibliotheque.json');
      await fs.writeFile(imported, 'Un café et une voix.', 'utf8');
      await app.evaluate(({ dialog }, { imported, exported, backup }) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [imported] });
        dialog.showSaveDialog = async (_window, opts) => ({
          canceled: false, filePath: opts.defaultPath.endsWith('.json') ? backup : exported
        });
      }, { imported, exported, backup });
      await ui.click('import-script');
      await page.waitForFunction(() => document.querySelector('#script-title').value === 'Un récit');
      await page.locator('#cue-menu summary').click();
      await page.locator('#cue-menu-items button', { hasText: 'RESPIRER' }).click();
      assert.match(await ui.id('script-body').inputValue(), /\[souffle\]/);
      await page.locator('#script-menu summary').click();
      await ui.click('export-script');
      await waitText(page, '#toast-message', 'Export terminé');
      assert.match(await fs.readFile(exported, 'utf8'), /Un café/);
      await useSettings(page, 'integrations');
      await ui.click('export-library');
      await page.locator('#settings-dialog').waitFor({ state: 'hidden' });
      assert.ok(JSON.parse(await fs.readFile(backup, 'utf8')).scripts.length >= 3);
      await page.locator('#script-menu summary').click();
      await ui.click('duplicate-script');
      assert.match(await ui.id('script-title').inputValue(), /copie$/);
      await page.locator('#script-menu summary').click();
      await ui.click('ask-delete');
      await ui.click('delete-script');
      await waitText(page, '#toast-message', 'Script supprimé');
      await ui.click('toast-action');
      assert.match(await ui.id('script-title').inputValue(), /copie$/);
    });

    await t.test('synchronisation et contrôle des scènes OBS contre des serveurs de test locaux', async () => {
      await useSettings(page, 'integrations');
      assert.equal(await ui.id('cloud-server').inputValue(), '');
      await ui.field('cloud-server', 'http://127.0.0.1:' + mocks.server.address().port);
      await ui.field('cloud-email', 'studio@example.test');
      await ui.field('cloud-password', 'mot-de-passe-de-test');
      await ui.click('cloud-signin');
      await waitText(page, '#cloud-status', 'Synchronisé');
      assert.ok(mocks.payloads.some(entry => entry.route === '/sync' && entry.authorization === 'Bearer test-local-token'));
      await ui.click('cloud-signout');
      await waitText(page, '#cloud-status', 'Non connecté');
      await ui.field('obs-address', 'ws://127.0.0.1:' + mocks.obs.address().port);
      await ui.click('connect-obs');
      await waitText(page, '#obs-status', 'OBS connecté');
      await ui.id('obs-scene').selectOption('Lecture');
      await ui.click('switch-scene');
      await waitText(page, '#obs-status', 'Scène active');
      assert.deepEqual(mocks.sceneChanges, ['Lecture']);
      await ui.click('connect-obs');
      await waitText(page, '#obs-status', 'Non connecté');
      await closeSettings(page);
    });

    await t.test('réouverture avec les scripts et les réglages enregistrés', async () => {
      await app.close();
      ({ app, page } = await launch(profile));
      assert.match(await page.locator('#script-title').inputValue(), /copie$/);
      assert.equal(await page.locator('#mode-auto').getAttribute('aria-pressed'), 'true');
      assert.equal(await page.locator('#preview').evaluate(element => element.style.getPropertyValue('--flip-x')), '-1');
      assert.ok(await page.getByRole('button', { name: /Script synchronisé/ }).count());
    });

    await t.test('lecture rapide et improvisée, arrêt à la bonne position puis rattrapage sans clic', { timeout: 40_000 }, async t => {
      await app.close();
      const rapidWav = path.join(root, 'voice-rapid-fr.wav');
      const intro = 'Bonjour et bienvenue dans notre atelier. Nous préparons cette présentation.';
      const skipped = 'Avant de commencer vérifiez soigneusement chaque réglage. Branchez le microphone puis installez votre écran. Prenez quelques secondes pour relire toutes les instructions et contrôler les différents paramètres du studio.';
      const aside = 'Hier près de la rivière nous avons croisé trois cyclistes. Ils se sont arrêtés pour déjeuner dans un jardin avec des tulipes et un gros chien. La pluie est arrivée juste avant leur départ.';
      const ending = 'Allumez la lumière bleue, observez les couleurs du tableau, puis éteignez le projecteur. Merci pour votre attention.';
      const spoken = [intro, aside, ending].join(' ');
      powerShell('make-voice-fixture.ps1', ['-Output', rapidWav, '-Rate', '6', '-Text', spoken]);
      const minutes = (await fs.stat(rapidWav)).size / (32000 * 60);
      const rate = Math.round(spoken.split(/\s+/).length / minutes);
      assert.ok(rate >= 215, 'Débit mesuré de ' + rate + ' mots/min');
      t.diagnostic('Voix française de synthèse, environ ' + rate + ' mots/min pauses comprises.');
      ({ app, page } = await launch(path.join(root, 'rapid-profile'), [
        '--use-fake-device-for-media-stream',
        '--use-file-for-fake-audio-capture=' + rapidWav
      ]));
      page.on('pageerror', error => errors.push(error.message));
      await page.locator('#script-body').fill([intro, skipped, ending].join('\n\n'));
      const spawned = app.waitForEvent('window');
      await page.locator('#open-reader').click();
      reader = await spawned;
      reader.on('pageerror', error => errors.push(error.message));
      await reader.locator('.reading-word').first().waitFor();

      await page.evaluate(() => {
        window.voiceTestEvents = [];
        window.nova.onSpeech(message => {
          if (message.type !== 'transcript' || !message.text) return;
          window.voiceTestEvents.push({
            text: message.text,
            value: Number(document.querySelector('#progress').value),
            waiting: document.querySelector('#transport-light').dataset.voiceWaiting === 'true'
          });
        });
      });

      await reader.locator('#btn-play').click();
      await phase(page, 'playing', 18_000);
      try {
        await page.waitForFunction(() => window.voiceTestEvents.some(event => /rivi[eè]re|cyclistes|tulipes/i.test(event.text) && event.waiting),
          null, { timeout: 15_000 });
        await waitText(reader, '#reader-status', 'En attente du texte');
        const current = Number(await page.locator('#progress').inputValue());
        assert.ok(current > 0 && current <= 200, 'Position pendant l’improvisation : ' + current / 10 + ' %');
        await page.waitForFunction(() => window.voiceTestEvents.some(event => /gros chien|tulipes|leur d[eé]part/i.test(event.text)),
          null, { timeout: 8500 });
        assert.equal(Number(await page.locator('#progress').inputValue()), current);
        await phase(page, 'done', 10000);
        assert.equal(await page.locator('#progress').inputValue(), '1000');
        await waitText(reader, '#reader-status', 'Terminé');
      } catch (error) {
        const readings = await page.evaluate(() => window.voiceTestEvents.filter((event, i, events) =>
          !i || event.waiting !== events[i-1].waiting || event.value !== events[i-1].value || i >= events.length - 3));
        t.diagnostic(JSON.stringify(readings));
        throw error;
      }
    });

    assert.deepEqual(errors, []);
  } finally {
    await app?.close().catch(() => {});
    for (const client of mocks.obs.clients) client.terminate();
    mocks.obs.close();
    mocks.server.close();
    const checked = await fs.realpath(root);
    const base = await fs.realpath(build);
    if (path.dirname(checked) === base && path.basename(checked).startsWith('test-desktop-')) {
      await fs.rm(checked, { recursive: true, force: true, maxRetries: 3 });
    }
  }
});
