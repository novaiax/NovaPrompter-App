const paths = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/>',
  file: '<path d="M7 3.5h7l4 4V20a.5.5 0 0 1-.5.5h-11A1.5 1.5 0 0 1 5 19V5a1.5 1.5 0 0 1 2-1.5Z"/><path d="M14 4v4h4M8.5 12h6.5m-6.5 4h6.5"/>',
  import: '<path d="M12 3v12m-4-4 4 4 4-4M5 15v4a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-4"/>',
  export: '<path d="M12 15V3m-4 4 4-4 4 4M5 15v4a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-4"/>',
  external: '<path d="M7 17 17 7M7.5 7H17v9.5"/>',
  window: '<rect x="3.5" y="5" width="17" height="14" rx="2"/><path d="M3.5 9.5h17M7 7.25h.1"/>',
  settings: '<path d="M4 6h9m4 0h3M4 12h3m4 0h9M4 18h11m4 0h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>',
  keyboard: '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M7 10h.1m3.2 0h.1m3.2 0h.1m3.2 0h.1M8 14h8"/>',
  sparkles: '<path d="m11 4 1.8 4.2L17 10l-4.2 1.8L11 16l-1.8-4.2L5 10l4.2-1.8L11 4Zm7.5 9 .9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9.9-2.1ZM5 15.5V20m-2.25-2.25h4.5"/>',
  bookmark: '<path d="M7 4h10a1 1 0 0 1 1 1v15l-6-4-6 4V5a1 1 0 0 1 1-1Z"/>',
  chevron: '<path d="m8 10 4 4 4-4"/>',
  more: '<circle cx="5" cy="12" r="1" fill="currentColor"/><circle cx="12" cy="12" r="1" fill="currentColor"/><circle cx="19" cy="12" r="1" fill="currentColor"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M6 10.5v1a6 6 0 0 0 12 0v-1M12 17.5V21m-3 0h6"/>',
  wave: '<path d="M3 12h2m2-3v6m3-10v14m4-16v18m3-13v8m3-4h1"/>',
  timer: '<circle cx="12" cy="13" r="7.5"/><path d="M9.5 2.75h5M12 8.5V13l2.5 1.5"/>',
  play: '<path d="m9 5 11 7-11 7z" fill="currentColor" stroke-linejoin="round"/>',
  pause: '<path d="M9 5v14m6-14v14" stroke-width="3"/>',
  reset: '<path d="M4 10.5A8 8 0 1 1 6 18m-2-13v5.7h5.7"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  fullscreen: '<path d="M4 9V4h5m6 0h5v5m0 6v5h-5m-6 0H4v-5"/>',
  maximize: '<rect x="5" y="5" width="14" height="14" rx="1.5"/>',
  restore: '<path d="M8 5h10a1 1 0 0 1 1 1v10"/><rect x="5" y="8" width="11" height="11" rx="1"/>',
  minus: '<path d="M5 12h14"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  trash: '<path d="M4 6h16M9 6V4h6v2m3 0-1 14H7L6 6m4 4v6m4-6v6"/>',
  arrowRight: '<path d="M4 12h15m-6-6 6 6-6 6"/>',
  arrowLeft: '<path d="M20 12H5m6 6-6-6 6-6"/>',
  refresh: '<path d="M20 10a8 8 0 0 0-13-5L4 8m0-5v5h5m-5 6a8 8 0 0 0 13 5l3-3m0 5v-5h-5"/>',
  pin: '<path d="m8 4 12 12m-8-8-3 4-4 1 6 6 1-4 4-3M8 16l-4 4"/>',
  grip: '<path d="M6 9h12M6 15h12"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11.5V16m0-8h.01"/>'
};

export function icon(name, className = '') {
  return `<svg class="icon ${className}" aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round">${paths[name] || ''}</svg>`;
}

export function paintIcons(root = document) {
  for (const element of root.querySelectorAll('[data-icon]')) element.innerHTML = icon(element.dataset.icon);
}
