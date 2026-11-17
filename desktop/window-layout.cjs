const fs = require('node:fs');
const path = require('node:path');

function createWindowLayout(folder, screen) {
  const file = path.join(folder, 'windows.json');
  let saved = {};
  try { saved = JSON.parse(fs.readFileSync(file, 'utf8')) || {}; } catch {}

  function bounds(name, defaults, minimum, display) {
    const candidate = saved[name];
    const good = candidate && ['x', 'y', 'width', 'height'].every(key => Number.isFinite(candidate[key]));
    const area = (good ? screen.getDisplayMatching(candidate) : display).workArea;
    const width = Math.min(area.width, Math.max(minimum.width, good ? candidate.width : defaults.width));
    const height = Math.min(area.height, Math.max(minimum.height, good ? candidate.height : defaults.height));
    const x = good ? candidate.x : area.x + Math.round((area.width - width) / 2);
    const y = good ? candidate.y : area.y + Math.round((area.height - height) * (name === 'prompter' ? 0.13 : 0.42));
    return {
      x: Math.round(Math.min(Math.max(x, area.x), area.x + area.width - width)),
      y: Math.round(Math.min(Math.max(y, area.y), area.y + area.height - height)),
      width: Math.round(width), height: Math.round(height)
    };
  }

  function track(name, window) {
    let timer;
    const write = () => {
      clearTimeout(timer);
      if (window.isDestroyed() || window.isMinimized() || window.isFullScreen()) return;
      saved[name] = window.getNormalBounds();
      try {
        fs.writeFileSync(file + '.tmp', JSON.stringify(saved));
        fs.renameSync(file + '.tmp', file);
      } catch {}
    };
    const delay = () => { clearTimeout(timer); timer = setTimeout(write, 250); };
    window.on('resize', delay);
    window.on('move', delay);
    window.on('close', write);
    window.on('closed', () => clearTimeout(timer));
  }

  return { bounds, track };
}

module.exports = { createWindowLayout };
