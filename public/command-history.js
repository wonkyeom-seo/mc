(function commandHistoryModule(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.CommandHistory = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  'use strict';

  function navigate(options) {
    const history = Array.isArray(options.history) ? options.history : [];
    let index = Number.isInteger(options.index) ? options.index : -1;
    let draft = String(options.draft ?? '');
    const current = String(options.current ?? '');
    if (!history.length) return { changed: false, index, draft, value: current };

    if (options.direction === 'up') {
      if (index === -1) {
        draft = current;
        index = history.length - 1;
      } else if (index > 0) {
        index -= 1;
      }
      return { changed: true, index, draft, value: history[index] };
    }

    if (options.direction === 'down' && index >= 0) {
      if (index < history.length - 1) {
        index += 1;
        return { changed: true, index, draft, value: history[index] };
      }
      return { changed: true, index: -1, draft, value: draft };
    }

    return { changed: false, index, draft, value: current };
  }

  return { navigate };
}));
