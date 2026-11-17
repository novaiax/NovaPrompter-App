import { icon } from '../shared/icons.js';
import { sanitizeName } from './tags.js';

const $ = selector => document.querySelector(selector);
const fields = [
  ['label', 'Libellé', 'text', 'maxlength="36" required'],
  ['name', 'Code', 'text', 'maxlength="24" required'],
  ['color', 'Texte', 'color', ''],
  ['bgColor', 'Fond', 'color', ''],
  ['pause', 'Pause (s)', 'number', 'min="0" max="20" step=".5" required']
];

export function createCueEditor({ getTags, setTags, insertCue }) {
  const list = $('#cue-list');
  const menu = $('#cue-menu-items');

  function formFor(tag) {
    const form = document.createElement('form');
    form.className = 'cue-form';
    form.innerHTML = '<div class="cue-fields"></div><div class="inline-actions">'
      + '<label class="check-row"><input type="checkbox" name="transparent"> Fond transparent</label>'
      + '<button type="submit" class="button secondary">Enregistrer</button>'
      + (tag ? '<button type="button" class="button quiet danger-text">Supprimer</button>' : '')
      + '</div><p class="dialog-note" role="status"></p>';
    for (const [name, label, type, attributes] of fields) {
      const field = document.createElement('label');
      field.className = 'field';
      field.innerHTML = `${label}<input name="${name}" type="${type}" ${attributes}>`;
      form.querySelector('.cue-fields').appendChild(field);
      field.querySelector('input').value = tag?.[name] ?? ({ color: '#c9b8ff', bgColor: '#302447', pause: 0 }[name] ?? '');
    }
    if (tag?.bgColor === 'transparent') form.elements.bgColor.value = '#302447';
    form.elements.transparent.checked = tag?.bgColor === 'transparent';
    form.addEventListener('submit', event => {
      event.preventDefault();
      const data = Object.fromEntries(new FormData(form));
      const name = sanitizeName(data.name);
      if (!name || getTags().some(other => other.name === name && other.id !== tag?.id)) {
        form.querySelector('[role=status]').textContent = 'Choisissez un code unique.';
        return;
      }
      const updated = {
        id: tag?.id || 't_' + crypto.randomUUID(),
        name, label: data.label.trim() || name, color: data.color,
        bgColor: data.transparent ? 'transparent' : data.bgColor,
        pause: Number(data.pause), fontSize: tag?.fontSize || 1
      };
      const next = tag ? getTags().map(other => other.id === tag.id ? updated : other) : [...getTags(), updated];
      if (setTags(next, tag?.name === name ? null : [tag?.name, name])) render();
    });
    form.querySelector('button[type=button]')?.addEventListener('click', event => {
      const button = event.currentTarget;
      if (!button.dataset.confirm) {
        button.dataset.confirm = 'true';
        button.textContent = 'Confirmer la suppression';
        return;
      }
      if (setTags(getTags().filter(other => other.id !== tag.id), [tag.name, null])) render();
    });
    return form;
  }

  function render() {
    list.replaceChildren();
    menu.replaceChildren();
    for (const tag of getTags()) {
      const wrapper = document.createElement('details');
      const row = document.createElement('summary');
      row.className = 'cue-row';
      row.innerHTML = '<i class="cue-dot"></i><strong></strong><code></code><span class="cue-edit">'
        + icon('chevron') + '</span>';
      row.querySelector('i').style.backgroundColor = tag.color;
      row.querySelector('strong').textContent = tag.label;
      row.querySelector('code').textContent = `[${tag.name}]`;
      wrapper.append(row);
      wrapper.addEventListener('toggle', () => {
        if (wrapper.open && !wrapper.querySelector('form')) wrapper.append(formFor(tag));
      });
      list.append(wrapper);

      const button = document.createElement('button');
      button.type = 'button';
      button.innerHTML = '<i class="cue-dot"></i><span></span>';
      button.querySelector('i').style.backgroundColor = tag.color;
      button.querySelector('span').textContent = tag.label;
      button.addEventListener('click', () => insertCue(tag.name));
      menu.append(button);
    }
    if (!getTags().length) {
      const note = document.createElement('button');
      note.type = 'button';
      note.textContent = 'Configurer les repères';
      note.addEventListener('click', () => $('#add-cue').dispatchEvent(new Event('open-cues')));
      menu.append(note);
    }
  }

  $('#add-cue').addEventListener('click', () => {
    if (list.querySelector('.new-cue')) return;
    const form = formFor(null);
    form.classList.add('new-cue');
    list.appendChild(form);
    form.elements.label.focus();
  });
  render();
  return { render };
}
