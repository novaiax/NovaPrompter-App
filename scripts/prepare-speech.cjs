const { createHash } = require('node:crypto');
const { existsSync } = require('node:fs');
const fs = require('node:fs/promises');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.join(__dirname, '..', 'build');
const cache = path.join(root, 'speech-downloads');
const output = path.join(root, 'speech');
const assets = [
  {
    name: 'engine.zip',
    url: 'https://github.com/alphacep/vosk-api/releases/download/v0.3.45/vosk-win64-0.3.45.zip',
    sha256: 'f1dcc9cca460630f81ea8f71794f69c80bed6556d2a4e6237b5785e1d2dff34b',
    directory: 'vosk-win64-0.3.45'
  },
  {
    name: 'model.zip',
    url: 'https://alphacephei.com/vosk/models/vosk-model-small-fr-0.22.zip',
    sha256: 'cabf6180e177eb9b3a9a9d43a437bd5e549f3a7d09525e5d69a3fed787be12ad',
    directory: 'vosk-model-small-fr-0.22'
  }
];
const dlls = ['libvosk.dll', 'libgcc_s_seh-1.dll', 'libstdc++-6.dll', 'libwinpthread-1.dll'];
const required = [
  ...dlls,
  'model-fr/am/final.mdl',
  'model-fr/graph/Gr.fst',
  'model-fr/graph/HCLr.fst',
  'model-fr/conf/model.conf',
  'Apache-2.0.txt',
  'NOTICE.txt'
];

async function download(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`Téléchargement impossible (HTTP ${response.status}) : ${url}`);
  return Buffer.from(await response.arrayBuffer());
}

async function unpack(asset) {
  const file = path.join(cache, asset.name);
  const zip = existsSync(file) ? await fs.readFile(file) : await download(asset.url);
  if (createHash('sha256').update(zip).digest('hex') !== asset.sha256) {
    throw new Error(`Archive invalide. Vérifiez ou retirez ${file}, puis relancez la préparation.`);
  }
  if (!existsSync(file)) await fs.writeFile(file, zip);
  const result = spawnSync('tar.exe', ['-xf', file, '-C', cache], { windowsHide: true, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || result.error?.message || 'Extraction impossible.');
  return path.join(cache, asset.directory);
}

async function main() {
  if (process.platform !== 'win32' || process.arch !== 'x64') {
    throw new Error('La distribution de NovaPrompter cible Windows x64.');
  }
  if (required.every(file => existsSync(path.join(output, file)))) return;
  await fs.mkdir(cache, { recursive: true });
  await fs.mkdir(output, { recursive: true });
  const [engine, model, license] = await Promise.all([
    ...assets.map(unpack),
    download('https://raw.githubusercontent.com/alphacep/vosk-api/v0.3.45/COPYING')
  ]);
  await fs.cp(model, path.join(output, 'model-fr'), { recursive: true });
  await Promise.all(dlls.map(file => fs.copyFile(path.join(engine, file), path.join(output, file))));
  await fs.writeFile(path.join(output, 'Apache-2.0.txt'), license);
  await fs.writeFile(path.join(output, 'NOTICE.txt'), [
    'Vosk API 0.3.45, Copyright 2020–2021 Alpha Cephei Inc., Apache License 2.0.',
    'https://github.com/alphacep/vosk-api/tree/v0.3.45',
    'Vosk model small fr 0.22, Apache License 2.0.',
    'https://alphacephei.com/vosk/models',
    'The Vosk Windows distribution includes the GCC runtime (GPLv3 with GCC Runtime Library Exception)',
    'and MinGW-w64 winpthreads. Corresponding source and license notices are available from:',
    'https://gcc.gnu.org/git.html',
    'https://www.gnu.org/licenses/gcc-exception-3.1.html',
    'https://www.mingw-w64.org/source/',
    ''
  ].join('\n'));
  console.log('Reconnaissance française prête.');
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
