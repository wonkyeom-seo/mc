(function ansiConsoleModule(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.AnsiConsole = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  'use strict';

  const BASIC_COLORS = [
    '#1e1e1e', '#cd3131', '#0dbc79', '#e5e510',
    '#2472c8', '#bc3fbc', '#11a8cd', '#e5e5e5',
    '#666666', '#f14c4c', '#23d18b', '#f5f543',
    '#3b8eea', '#d670d6', '#29b8db', '#ffffff',
  ];
  const CSI_PATTERN = /\x1B\[[0-?]*[ -/]*[@-~]/g;
  const OSC_PATTERN = /\x1B\][^\x07]*(?:\x07|\x1B\\)/g;

  function color256(index) {
    const safeIndex = Math.max(0, Math.min(Number(index) || 0, 255));
    if (safeIndex < 16) return BASIC_COLORS[safeIndex];
    if (safeIndex >= 232) {
      const value = 8 + (safeIndex - 232) * 10;
      return `rgb(${value}, ${value}, ${value})`;
    }
    const value = safeIndex - 16;
    const levels = [0, 95, 135, 175, 215, 255];
    const red = levels[Math.floor(value / 36)];
    const green = levels[Math.floor((value % 36) / 6)];
    const blue = levels[value % 6];
    return `rgb(${red}, ${green}, ${blue})`;
  }

  function defaultStyle() {
    return {
      color: null,
      backgroundColor: null,
      bold: false,
      dim: false,
      italic: false,
      underline: false,
    };
  }

  function applyCodes(style, rawCodes) {
    const codes = (rawCodes || '0')
      .replaceAll(':', ';')
      .split(';')
      .map((value) => Number(value || 0));

    for (let index = 0; index < codes.length; index += 1) {
      const code = codes[index];
      if (code === 0) Object.assign(style, defaultStyle());
      else if (code === 1) style.bold = true;
      else if (code === 2) style.dim = true;
      else if (code === 3) style.italic = true;
      else if (code === 4) style.underline = true;
      else if (code === 22) {
        style.bold = false;
        style.dim = false;
      } else if (code === 23) style.italic = false;
      else if (code === 24) style.underline = false;
      else if (code === 39) style.color = null;
      else if (code === 49) style.backgroundColor = null;
      else if (code >= 30 && code <= 37) style.color = BASIC_COLORS[code - 30];
      else if (code >= 90 && code <= 97) style.color = BASIC_COLORS[code - 90 + 8];
      else if (code >= 40 && code <= 47) style.backgroundColor = BASIC_COLORS[code - 40];
      else if (code >= 100 && code <= 107) style.backgroundColor = BASIC_COLORS[code - 100 + 8];
      else if ((code === 38 || code === 48) && codes[index + 1] === 5) {
        const color = color256(codes[index + 2]);
        if (code === 38) style.color = color;
        else style.backgroundColor = color;
        index += 2;
      } else if ((code === 38 || code === 48) && codes[index + 1] === 2) {
        const channels = codes.slice(index + 2, index + 5)
          .map((value) => Math.max(0, Math.min(value || 0, 255)));
        const color = `rgb(${channels[0]}, ${channels[1]}, ${channels[2]})`;
        if (code === 38) style.color = color;
        else style.backgroundColor = color;
        index += 4;
      }
    }
  }

  function parseAnsi(value) {
    const text = String(value ?? '').replace(OSC_PATTERN, '');
    const segments = [];
    const style = defaultStyle();
    let cursor = 0;

    for (const match of text.matchAll(CSI_PATTERN)) {
      if (match.index > cursor) {
        segments.push({ text: text.slice(cursor, match.index), ...style });
      }
      if (match[0].endsWith('m')) {
        applyCodes(style, match[0].slice(2, -1));
      }
      cursor = match.index + match[0].length;
    }
    if (cursor < text.length) segments.push({ text: text.slice(cursor), ...style });
    return segments.filter((segment) => segment.text);
  }

  function stripAnsi(value) {
    return String(value ?? '').replace(OSC_PATTERN, '').replace(CSI_PATTERN, '');
  }

  return {
    color256,
    parseAnsi,
    stripAnsi,
  };
}));
