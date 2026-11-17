import test from 'node:test';
import assert from 'node:assert/strict';
import { Speech } from '../desktop/speech.cjs';
import { buildScript, spokenTokens } from '../windows/shared/script-model.js';
import { VoiceAlignment, matchUtterance } from '../windows/shared/alignment.js';
import { cleanScript } from '../windows/shared/clean-script.js';
import { normalizeSettings } from '../windows/shared/settings.js';
import { readImport } from '../windows/editor/storage.js';
import { normalizeTags } from '../windows/editor/tags.js';

test('le texte affiché et la voix partagent les positions des élisions et des repères', () => {
  const result = buildScript("L’été, c’est l’heure.\n[pause] L'œil au porte‑voix.", [{ name: 'pause', label: 'PAUSE', pause: 2 }]);
  assert.deepEqual(result.tokens, ['l', 'ete', 'c', 'est', 'l', 'heure', 'l', 'oeil', 'au', 'porte', 'voix']);
  assert.deepEqual(result.pauses, [{ at: 6, seconds: 2 }]);
  assert.equal(result.words, 6);
  assert.deepEqual(spokenTokens("AUJOURD’HUI — déjà"), ['aujourd', 'hui', 'deja']);
});

test('la reprise vocale utilise les nouvelles positions et ignore les répétitions du même partiel', () => {
  const tokens = spokenTokens('bonjour tout le monde puis bonjour tout le monde bienvenue au studio');
  const tracker = new VoiceAlignment();
  tracker.reset(0);
  assert.equal(tracker.update(tokens, 'bonjour tout', false), 2);
  assert.equal(tracker.update(tokens, 'bonjour tout le monde', false), 4);
  assert.equal(tracker.update(tokens, 'bonjour tout le monde', false), 4);
  assert.equal(tracker.update(tokens, 'bonjour tout le monde', true), 4);
  tracker.reset(5);
  assert.equal(tracker.update(tokens, 'bonjour tout le monde bienvenue au studio', true), tokens.length);
  tracker.reset(0);
  assert.equal(tracker.update(tokens, 'bonjour', true), 1);
});

test('l’alignement tolère un mot omis et rejette le bruit et les correspondances lointaines faibles', () => {
  const tokens = spokenTokens('Bonjour tout le monde ici dans notre studio lumière parole horizon merci.');
  assert.equal(matchUtterance(tokens, 0, 'bonjour le monde', true), 4);
  assert.equal(matchUtterance(tokens, 0, 'cuisine et jardin', true), 0);
  assert.equal(matchUtterance(tokens, 0, 'parole horizon', true), 0);
  assert.equal(matchUtterance(tokens, 10, 'merci', true), 10);
  assert.equal(matchUtterance(tokens, 11, 'merci', true), 12);
});

test('un ajout oral dans le même résultat ne décale pas la lecture et le texte reprend avec la suite', () => {
  const first = 'Bonjour et bienvenue dans notre atelier';
  const next = 'Nous allons vérifier plusieurs réglages importants avant de commencer';
  const aside = 'Hier je marchais en montagne avec des amis et il pleuvait tellement que nous avons décidé de prendre le train plutôt que le sentier';
  const source = spokenTokens(first + ' ' + next);
  const tracker = new VoiceAlignment();
  tracker.reset(0);
  const before = spokenTokens(first).length;
  assert.equal(tracker.update(source, first, false), before);
  assert.equal(tracker.update(source, first + ' enfin bref', false), before);
  assert.equal(tracker.update(source, first + ' ' + aside, false), before);
  assert.equal(tracker.waiting, true);
  assert.equal(tracker.update(source, first + ' ' + aside + ' nous allons', false), before);
  assert.equal(tracker.update(source, first + ' ' + aside + ' ' + next, false), source.length);
  assert.equal(tracker.waiting, false);
});

test('un passage bien identifié rattrape plusieurs dizaines de mots perdus', () => {
  const head = 'Bienvenue dans notre atelier';
  const gap = 'Nous allons vérifier plusieurs réglages importants avant de commencer. La première étape consiste à prendre quelques secondes pour relire puis ajuster soigneusement les paramètres du microphone avant votre présentation.';
  const resume = 'Allumez la lumière et observez les couleurs du tableau';
  const source = spokenTokens([head, gap, resume].join(' '));
  const tracker = new VoiceAlignment();
  tracker.reset(0);
  const position = spokenTokens(head).length;
  assert.equal(tracker.update(source, head, true), position);
  assert.equal(tracker.update(source, 'avec la lumière une fois peut être', false), position);
  assert.equal(tracker.update(source, 'avec la lumière une fois peut être', true), position);
  assert.equal(tracker.update(source, 'allumez lumière observez les couleurs du tableau', false), source.length);
});

test('le retour à une phrase répétée attend un contexte qui distingue sa position', () => {
  const intro = 'Nous vérifions le signal du microphone';
  const skip = 'Gardez une marge de sécurité afin de contrôler soigneusement tous les paramètres avant la lecture et prenez le temps de noter vos observations';
  const repeated = 'Regardez la lumière bleue puis observez le résultat';
  const source = spokenTokens([intro, skip, repeated, 'Inscrivez ensuite cette observation dans le carnet', repeated, 'Déplacez maintenant le projecteur vers la fenêtre'].join(' '));
  const tracker = new VoiceAlignment();
  tracker.reset(0);
  const current = spokenTokens(intro).length;
  assert.equal(tracker.update(source, intro, true), current);
  assert.equal(tracker.update(source, repeated, false), current);
  assert.equal(tracker.update(source, repeated + ' déplacez maintenant le projecteur vers la fenêtre', false), source.length);
});

test('réécouter un passage déjà lu ne déclenche pas le passage suivant et modifier un partiel ne le joue pas deux fois', () => {
  const first = 'Bienvenue dans notre atelier';
  const following = 'Puis bienvenue dans notre atelier encore une fois pour cette démonstration';
  const source = spokenTokens(first + ' ' + following);
  const tracker = new VoiceAlignment();
  tracker.reset(0);
  const current = spokenTokens(first).length;
  assert.equal(tracker.update(source, first, false), current);
  assert.equal(tracker.update(source, 'bienvenue vraiment dans notre atelier', true), current);
  assert.equal(tracker.update(source, first, true), current);
  assert.equal(tracker.update(source, 'encore une fois pour cette démonstration', true), source.length);
});

test('la fin du texte reste accessible après une parenthèse ou une recherche tardive', () => {
  const tracker = new VoiceAlignment();
  const source = spokenTokens('Nous terminons ici');
  tracker.reset(2);
  assert.equal(tracker.update(source, 'Je pense au prochain week-end', true), 2);
  assert.equal(tracker.update(source, 'ici', true), 3);
});

test('un retard du moteur conserve le son récent et une recherche manuelle écarte les anciens résultats', () => {
  const events = [];
  const messages = [];
  const speech = new Speech('', message => events.push(message));
  const session = 'test';
  speech.worker = { postMessage: message => messages.push(message) };
  speech.active = { session, generation: 0, epoch: 0, inFlight: 0, pending: [], ready: true };
  const ack = () => speech.onMessage({ type: 'ack', session });
  for (let n = 0; n < 52; n++) {
    speech.audio({ session, generation: 0, bytes: Uint8Array.of(n, 0).buffer });
  }
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'resync');
  assert.equal(messages.filter(msg => msg.type === 'audio').length, 4);
  speech.onMessage({ type: 'transcript', session, generation: 0, epoch: 0, text: 'ancien' });
  assert.equal(events.length, 1);
  for (let i = 0; i < 4; i++) ack();
  assert.equal(messages[4].type, 'seek');
  assert.equal(messages[5].epoch, 1);
  assert.ok(new Uint8Array(messages[5].bytes)[0] >= 35);
  speech.onMessage({ type: 'transcript', session, generation: 0, epoch: 1, text: 'récupéré' });
  assert.equal(events[1].text, 'récupéré');
  speech.seek({ session, generation: 1 });
  speech.onMessage({ type: 'transcript', session, generation: 0, epoch: 1, text: 'périmé' });
  assert.equal(events.length, 2);
  for (let i = 0; i < 4; i++) ack();
  assert.equal(messages.at(-1).type, 'seek');
  assert.equal(messages.at(-1).generation, 1);
  assert.equal(speech.active.pending.length, 0);
});

test('le nettoyage conserve les titres utiles, les repères et les mots des liens', () => {
  const source = '\uFEFFWEBVTT\r\n\r\ncue-1\r\n00:01.000 --> 00:04.000 align:start\r\n# **Mon titre**\r\n <i>Bonjour</i>   [pause]\r\n\r\n\r\n> [La suite](https://example.org).';
  assert.equal(cleanScript(source), 'Mon titre\nBonjour [pause]\n\nLa suite.');
  assert.equal(cleanScript(source, {timestamps: false, formatting: false, spacing: false}), source);
  assert.equal(cleanScript('L’âge de l’Île\nLa voix, 50 % du texte.'), 'L’âge de l’Île\nLa voix, 50 % du texte.');
  assert.equal(cleanScript('1\n00:00:00,000 --> 00:00:02,000\nSalut.\n\n2\n00:00:02,000 --> 00:00:05,000\nPlus loin.'), 'Salut.\n\nPlus loin.');
});

test('les réglages déjà enregistrés sont repris et les anciennes valeurs hors limites sont bornées', () => {
  const settings = normalizeSettings({ speed: 60, mode: 'auto', fontFamily: "'Lexend', sans-serif",
    opacity: .2, fontSize: 300, mirrorH: true, micDeviceId: 'device-old', colorBg: 'a;bad' });
  assert.equal(settings.pace, 150);
  assert.equal(settings.fontFamily, 'Lexend');
  assert.equal(settings.opacity, .5);
  assert.equal(settings.fontSize, 120);
  assert.equal(settings.mirrorH, true);
  assert.equal(settings.micDeviceId, 'device-old');
  assert.equal(settings.mode, 'auto');
  assert.equal(settings.colorBg, '#111420');
});

test('import de texte et de sauvegarde historique avec des identifiants locaux distincts', () => {
  assert.deepEqual(readImport({name: 'Voix claire.md', text: '# En scène\r\nBonjour'}).scripts.map(({ title, content }) => ({ title, content })),
    [{ title: 'Voix claire', content: '# En scène\nBonjour' }]);
  const record = { id: 'ancien', title: 'Réunion', content: 'Lisez lentement.' };
  const result = readImport({ name: 'backup.json', text: JSON.stringify({ scripts: [record, record] }) });
  assert.equal(result.scripts.length, 2);
  assert.notEqual(result.scripts[0].id, record.id);
  assert.notEqual(result.scripts[0].id, result.scripts[1].id);
  assert.throws(() => readImport({ name: 'backup.json', text: '{"scripts":[{}]}' }), /ne contient pas/);
});

test('les anciens repères et les couleurs personnalisées sont conservés et validés', () => {
  const tags = normalizeTags([
    {id:'t_pause', name:'pause', label:'⏸ PAUSE', color:'#ffd000', bgColor:'#2a2010', fontSize:1.1, pause:1},
    {name:'pause', label:'double'}, {name:'incorrect !', label:'à écarter'}
  ]);
  assert.deepEqual(tags, [{id:'t_pause', name:'pause', label:'⏸ PAUSE', color:'#ffd000', bgColor:'#2a2010', fontSize:1.1, pause:1}]);
});
