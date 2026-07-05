(() => {
  'use strict';

  const state = {
    token: sessionStorage.getItem('mc-control-token') || '',
    authRequired: false,
    today: '',
    status: null,
    socket: null,
    consoleEntries: [],
    currentLogDate: '',
    metricEntries: [],
    currentMetricDate: '',
    metricsIntervalMs: 5_000,
    commandHistory: (() => {
      try {
        const saved = JSON.parse(localStorage.getItem('mc-control-command-history') || '[]');
        return Array.isArray(saved) ? saved.filter((item) => typeof item === 'string').slice(-100) : [];
      } catch {
        return [];
      }
    })(),
    commandHistoryIndex: -1,
    commandDraft: '',
    currentDirectory: '',
    selectedFile: null,
    originalContent: '',
  };

  const elements = {
    authModal: document.querySelector('#authModal'),
    authForm: document.querySelector('#authForm'),
    authError: document.querySelector('#authError'),
    tokenInput: document.querySelector('#tokenInput'),
    navItems: [...document.querySelectorAll('[data-view]')],
    views: [...document.querySelectorAll('[data-view-panel]')],
    pageTitle: document.querySelector('#pageTitle'),
    pageEyebrow: document.querySelector('#pageEyebrow'),
    refreshButton: document.querySelector('#refreshButton'),
    headerStartButton: document.querySelector('#headerStartButton'),
    startButton: document.querySelector('#startButton'),
    stopButton: document.querySelector('#stopButton'),
    sidebarStatusDot: document.querySelector('#sidebarStatusDot'),
    sidebarStatusText: document.querySelector('#sidebarStatusText'),
    sidebarUptime: document.querySelector('#sidebarUptime'),
    heroStatusDot: document.querySelector('#heroStatusDot'),
    heroStatus: document.querySelector('#heroStatus'),
    statusBadge: document.querySelector('#statusBadge'),
    statusDescription: document.querySelector('#statusDescription'),
    uptimeValue: document.querySelector('#uptimeValue'),
    pidValue: document.querySelector('#pidValue'),
    memoryValue: document.querySelector('#memoryValue'),
    jarValue: document.querySelector('#jarValue'),
    serverDirectory: document.querySelector('#serverDirectory'),
    activityList: document.querySelector('#activityList'),
    metricsDate: document.querySelector('#metricsDate'),
    metricsRange: document.querySelector('#metricsRange'),
    metricsLive: document.querySelector('#metricsLive'),
    cpuMetricValue: document.querySelector('#cpuMetricValue'),
    memoryMetricValue: document.querySelector('#memoryMetricValue'),
    metricsUpdatedAt: document.querySelector('#metricsUpdatedAt'),
    cpuChart: document.querySelector('#cpuChart'),
    memoryChart: document.querySelector('#memoryChart'),
    logDate: document.querySelector('#logDate'),
    livePill: document.querySelector('#livePill'),
    consoleOutput: document.querySelector('#consoleOutput'),
    clearConsoleButton: document.querySelector('#clearConsoleButton'),
    commandForm: document.querySelector('#commandForm'),
    commandInput: document.querySelector('#commandInput'),
    sendCommandButton: document.querySelector('#sendCommandButton'),
    refreshFilesButton: document.querySelector('#refreshFilesButton'),
    breadcrumbs: document.querySelector('#breadcrumbs'),
    fileList: document.querySelector('#fileList'),
    editorFileName: document.querySelector('#editorFileName'),
    editorFileMeta: document.querySelector('#editorFileMeta'),
    fileEditor: document.querySelector('#fileEditor'),
    saveFileButton: document.querySelector('#saveFileButton'),
    editorStatus: document.querySelector('#editorStatus'),
    editorPanel: document.querySelector('.editor-panel'),
    toastContainer: document.querySelector('#toastContainer'),
  };

  const viewMeta = {
    dashboard: ['OVERVIEW', '서버 대시보드'],
    console: ['LIVE TERMINAL', '실시간 콘솔'],
    files: ['FILE MANAGER', '서버 파일 관리'],
  };

  async function api(path, options = {}) {
    const headers = new Headers(options.headers || {});
    if (state.token) headers.set('Authorization', `Bearer ${state.token}`);
    if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');

    const response = await fetch(path, { ...options, headers });
    const data = await response.json().catch(() => ({}));

    if (response.status === 401 && path !== '/api/auth/verify') {
      showAuth();
    }
    if (!response.ok) throw new Error(data.error || `요청 실패 (${response.status})`);
    return data;
  }

  function showAuth() {
    elements.authModal.classList.remove('hidden');
    setTimeout(() => elements.tokenInput.focus(), 0);
  }

  function hideAuth() {
    elements.authModal.classList.add('hidden');
    elements.authError.textContent = '';
    elements.tokenInput.value = '';
  }

  function toast(message, type = 'success') {
    const item = document.createElement('div');
    item.className = `toast ${type}`;
    item.textContent = message;
    elements.toastContainer.append(item);
    setTimeout(() => item.remove(), 3_500);
  }

  function setView(view) {
    if (!viewMeta[view]) return;
    elements.navItems.forEach((item) => item.classList.toggle('active', item.dataset.view === view));
    elements.views.forEach((panel) => panel.classList.toggle('active', panel.dataset.viewPanel === view));
    [elements.pageEyebrow.textContent, elements.pageTitle.textContent] = viewMeta[view];
    history.replaceState(null, '', `#${view}`);
    if (view === 'files') loadDirectory(state.currentDirectory);
    if (view === 'console') requestAnimationFrame(scrollConsoleToBottom);
  }

  function statusInfo(status) {
    const mapping = {
      stopped: {
        label: '서버 꺼짐',
        badge: 'OFFLINE',
        className: '',
        description: status.jarExists
          ? '서버가 정지되어 있습니다. 시작 버튼을 눌러 실행할 수 있습니다.'
          : '서버 JAR 파일이 없습니다. 설정된 서버 폴더에 JAR 파일을 추가하세요.',
      },
      starting: {
        label: '서버 시작 중',
        badge: 'STARTING',
        className: 'is-busy',
        description: 'Java 프로세스를 시작하고 Minecraft 월드를 불러오는 중입니다.',
      },
      running: {
        label: status.ready ? '서버 온라인' : '서버 실행 중',
        badge: status.ready ? 'ONLINE' : 'LOADING',
        className: status.ready ? 'is-online' : 'is-busy',
        description: status.ready
          ? 'Minecraft 서버가 정상적으로 실행 중이며 접속할 수 있습니다.'
          : '서버 프로세스가 실행 중입니다. 월드 준비 완료 메시지를 기다리고 있습니다.',
      },
      stopping: {
        label: '서버 종료 중',
        badge: 'STOPPING',
        className: 'is-busy',
        description: '월드 데이터를 안전하게 저장하고 서버를 종료하는 중입니다.',
      },
      crashed: {
        label: '비정상 종료',
        badge: 'CRASHED',
        className: 'is-error',
        description: '서버가 비정상적으로 종료되었습니다. 콘솔의 마지막 오류를 확인하세요.',
      },
    };
    return mapping[status.state] || mapping.stopped;
  }

  function applyDotClass(element, className) {
    element.classList.remove('is-online', 'is-busy', 'is-error');
    if (className) element.classList.add(className);
  }

  function renderStatus(status) {
    state.status = status;
    const info = statusInfo(status);
    const active = ['starting', 'running', 'stopping'].includes(status.state);
    const controllable = ['starting', 'running'].includes(status.state);

    elements.heroStatus.textContent = info.label;
    elements.sidebarStatusText.textContent = info.label;
    elements.statusBadge.textContent = info.badge;
    elements.statusDescription.textContent = info.description;
    applyDotClass(elements.heroStatusDot, info.className);
    applyDotClass(elements.sidebarStatusDot, info.className);

    elements.startButton.disabled = active || !status.jarExists;
    elements.headerStartButton.disabled = active || !status.jarExists;
    elements.stopButton.disabled = !controllable;
    elements.commandInput.disabled = !controllable;
    elements.sendCommandButton.disabled = !controllable;
    elements.headerStartButton.innerHTML = active
      ? '<svg viewBox="0 0 24 24"><path d="M7 7h10v10H7V7Z"/></svg>실행 중'
      : '<svg viewBox="0 0 24 24"><path d="m8 5 11 7-11 7V5Z"/></svg>서버 시작';

    elements.pidValue.textContent = status.pid || '—';
    elements.memoryValue.textContent = `${status.memory.min || '—'} / ${status.memory.max || '—'}`;
    elements.jarValue.textContent = `${status.jarName}${status.jarExists ? '' : ' (없음)'}`;
    elements.serverDirectory.textContent = status.serverDirectory;
    updateUptime();
    renderMetrics();
  }

  function formatDuration(seconds) {
    if (!seconds) return '0초';
    const days = Math.floor(seconds / 86_400);
    const hours = Math.floor((seconds % 86_400) / 3_600);
    const minutes = Math.floor((seconds % 3_600) / 60);
    const secs = seconds % 60;
    if (days) return `${days}일 ${hours}시간`;
    if (hours) return `${hours}시간 ${minutes}분`;
    if (minutes) return `${minutes}분 ${secs}초`;
    return `${secs}초`;
  }

  function updateUptime() {
    const status = state.status;
    if (!status || !status.startedAt || !['starting', 'running', 'stopping'].includes(status.state)) {
      elements.uptimeValue.textContent = '—';
      elements.sidebarUptime.textContent = '가동 안 함';
      return;
    }
    const seconds = Math.max(0, Math.floor((Date.now() - new Date(status.startedAt).getTime()) / 1_000));
    const duration = formatDuration(seconds);
    elements.uptimeValue.textContent = duration;
    elements.sidebarUptime.textContent = duration;
  }

  function visibleMetricEntries() {
    const entries = state.metricEntries;
    const range = elements.metricsRange.value;
    if (!entries.length || range === 'all') return entries;
    const rangeMs = Number(range) * 60_000;
    const endTime = state.currentMetricDate === state.today
      ? Date.now()
      : new Date(entries[entries.length - 1].timestamp).getTime();
    return entries.filter((entry) => new Date(entry.timestamp).getTime() >= endTime - rangeMs);
  }

  function roundedChartMaximum(value, minimum, step) {
    return Math.max(minimum, Math.ceil(value / step) * step);
  }

  function drawMetricChart(canvas, entries, options) {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (!width || !height) return;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    const context = canvas.getContext('2d');
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);

    if (!entries.length) {
      context.fillStyle = '#626b63';
      context.font = '11px ui-monospace, monospace';
      context.textAlign = 'center';
      context.fillText('저장된 데이터가 없습니다.', width / 2, height / 2);
      return;
    }

    const padding = { top: 16, right: 17, bottom: 28, left: 48 };
    const plotWidth = Math.max(1, width - padding.left - padding.right);
    const plotHeight = Math.max(1, height - padding.top - padding.bottom);
    const values = entries.map((entry) => Number(entry[options.key]) || 0);
    const maximum = options.maximum(Math.max(...values));
    const times = entries.map((entry) => new Date(entry.timestamp).getTime());
    const firstTime = Math.min(...times);
    const lastTime = Math.max(...times);
    const timeSpan = Math.max(lastTime - firstTime, 1);

    context.strokeStyle = '#252b26';
    context.lineWidth = 1;
    context.fillStyle = '#59615a';
    context.font = '9px ui-monospace, monospace';
    context.textAlign = 'right';
    context.textBaseline = 'middle';
    for (let index = 0; index <= 4; index += 1) {
      const y = padding.top + (plotHeight * index) / 4;
      context.beginPath();
      context.moveTo(padding.left, y);
      context.lineTo(width - padding.right, y);
      context.stroke();
      context.fillText(options.formatAxis(maximum * (1 - index / 4)), padding.left - 8, y);
    }

    context.textAlign = 'center';
    context.textBaseline = 'top';
    [0, 0.5, 1].forEach((position) => {
      const timestamp = firstTime + timeSpan * position;
      const x = padding.left + plotWidth * position;
      context.fillText(
        new Date(timestamp).toLocaleTimeString('ko-KR', {
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        }),
        x,
        height - padding.bottom + 10,
      );
    });

    const points = entries.map((entry, index) => ({
      x: padding.left + ((times[index] - firstTime) / timeSpan) * plotWidth,
      y: padding.top + plotHeight - (values[index] / maximum) * plotHeight,
    }));
    if (points.length === 1) points[0].x = padding.left + plotWidth;

    const gradient = context.createLinearGradient(0, padding.top, 0, padding.top + plotHeight);
    gradient.addColorStop(0, options.fill);
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
    context.beginPath();
    context.moveTo(points[0].x, padding.top + plotHeight);
    points.forEach((point) => context.lineTo(point.x, point.y));
    context.lineTo(points[points.length - 1].x, padding.top + plotHeight);
    context.closePath();
    context.fillStyle = gradient;
    context.fill();

    context.beginPath();
    points.forEach((point, index) => {
      if (index === 0) context.moveTo(point.x, point.y);
      else context.lineTo(point.x, point.y);
    });
    context.strokeStyle = options.color;
    context.lineWidth = 1.6;
    context.lineJoin = 'round';
    context.stroke();

    const latest = points[points.length - 1];
    context.beginPath();
    context.arc(latest.x, latest.y, 3, 0, Math.PI * 2);
    context.fillStyle = options.color;
    context.fill();
  }

  function renderMetrics() {
    const entries = visibleMetricEntries();
    const latest = state.metricEntries[state.metricEntries.length - 1];
    const isHistory = Boolean(state.currentMetricDate && state.currentMetricDate !== state.today);
    const serverActive = ['starting', 'running', 'stopping'].includes(state.status?.state);
    const fresh = latest
      && Date.now() - new Date(latest.timestamp).getTime() < state.metricsIntervalMs * 2.5
      && serverActive
      && !isHistory;

    elements.metricsLive.classList.toggle('active', Boolean(fresh));
    elements.metricsLive.classList.toggle('history', isHistory);
    elements.metricsLive.innerHTML = fresh
      ? '<i></i> LIVE'
      : isHistory
        ? '<i></i> HISTORY'
        : '<i></i> 대기 중';

    elements.cpuMetricValue.textContent = latest ? `${Number(latest.cpuPercent).toFixed(1)}%` : '—';
    elements.memoryMetricValue.textContent = latest ? formatBytes(latest.rssBytes) : '—';
    elements.metricsUpdatedAt.textContent = latest
      ? `마지막 수집 ${new Date(latest.timestamp).toLocaleString('ko-KR', { hour12: false })}`
      : '서버 실행 후 자동으로 수집됩니다.';

    drawMetricChart(elements.cpuChart, entries, {
      key: 'cpuPercent',
      color: '#72e06f',
      fill: 'rgba(114, 224, 111, 0.22)',
      maximum: (value) => roundedChartMaximum(value, 100, 25),
      formatAxis: (value) => `${Math.round(value)}%`,
    });
    drawMetricChart(elements.memoryChart, entries, {
      key: 'rssBytes',
      color: '#71a9f7',
      fill: 'rgba(113, 169, 247, 0.22)',
      maximum: (value) => roundedChartMaximum(value, 512 * 1024 * 1024, 256 * 1024 * 1024),
      formatAxis: (value) => {
        if (value >= 1024 ** 3) return `${(value / 1024 ** 3).toFixed(1)}G`;
        return `${Math.round(value / 1024 ** 2)}M`;
      },
    });
  }

  function entryClass(entry) {
    if (entry.stream === 'command') return 'command';
    if (entry.stream === 'system') return 'system';
    if (entry.stream === 'stderr' || /\b(ERROR|SEVERE|Exception)\b/i.test(entry.message)) return 'error';
    if (/\bWARN(?:ING)?\b/i.test(entry.message)) return 'warn';
    return 'output';
  }

  function addConsoleEntry(entry, shouldScroll = true) {
    const empty = elements.consoleOutput.querySelector('.terminal-empty');
    empty?.remove();

    const line = document.createElement('div');
    const classification = entryClass(entry);
    line.className = `console-line ${classification}`;

    const time = document.createElement('time');
    time.dateTime = entry.timestamp;
    time.textContent = new Date(entry.timestamp).toLocaleTimeString('ko-KR', { hour12: false });

    const stream = document.createElement('span');
    stream.className = 'console-stream';
    stream.textContent = entry.stream === 'stdout' ? 'INFO' : entry.stream.toUpperCase();

    const message = document.createElement('span');
    message.className = 'console-message';
    const renderedMessage = entry.stream === 'command' ? `> ${entry.message}` : entry.message;
    const segments = window.AnsiConsole?.parseAnsi(renderedMessage) || [{ text: renderedMessage }];
    segments.forEach((segment) => {
      const text = document.createElement('span');
      text.textContent = segment.text;
      if (segment.color) text.style.color = segment.color;
      if (segment.backgroundColor) text.style.backgroundColor = segment.backgroundColor;
      if (segment.bold) text.classList.add('ansi-bold');
      if (segment.dim) text.classList.add('ansi-dim');
      if (segment.italic) text.classList.add('ansi-italic');
      if (segment.underline) text.classList.add('ansi-underline');
      message.append(text);
    });

    line.append(time, stream, message);
    elements.consoleOutput.append(line);
    if (elements.consoleOutput.children.length > 2_000) {
      elements.consoleOutput.firstElementChild?.remove();
    }
    if (shouldScroll) scrollConsoleToBottom();
  }

  function scrollConsoleToBottom() {
    elements.consoleOutput.scrollTop = elements.consoleOutput.scrollHeight;
  }

  function renderActivity(entries) {
    elements.activityList.replaceChildren();
    const recent = entries.slice(-6).reverse();
    if (!recent.length) {
      const empty = document.createElement('div');
      empty.className = 'empty-state compact';
      empty.textContent = '아직 기록된 활동이 없습니다.';
      elements.activityList.append(empty);
      return;
    }

    recent.forEach((entry) => {
      const row = document.createElement('div');
      row.className = 'activity-entry';
      const time = document.createElement('time');
      time.textContent = new Date(entry.timestamp).toLocaleTimeString('ko-KR', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      });
      const marker = document.createElement('i');
      marker.className = `stream-${entryClass(entry) === 'error' ? 'error' : entry.stream}`;
      const message = document.createElement('span');
      const activityMessage = entry.stream === 'command'
        ? `명령 실행: ${entry.message}`
        : entry.message;
      message.textContent = window.AnsiConsole?.stripAnsi(activityMessage) || activityMessage;
      row.append(time, marker, message);
      elements.activityList.append(row);
    });
  }

  async function loadLogDates() {
    const data = await api('/api/logs/dates');
    state.today = data.today;
    const dates = [...new Set([data.today, ...data.dates])];
    const selected = dates.includes(state.currentLogDate) ? state.currentLogDate : data.today;
    elements.logDate.replaceChildren(...dates.map((date) => {
      const option = document.createElement('option');
      option.value = date;
      option.textContent = date === data.today ? `${date} · 오늘` : date;
      return option;
    }));
    elements.logDate.value = selected;
    state.currentLogDate = selected;
    updateLivePill();
  }

  async function loadLogs(date = state.currentLogDate || state.today) {
    const data = await api(`/api/logs?date=${encodeURIComponent(date)}&limit=1000`);
    state.currentLogDate = data.date;
    state.consoleEntries = data.entries;
    elements.consoleOutput.replaceChildren();
    if (!data.entries.length) {
      const empty = document.createElement('div');
      empty.className = 'terminal-empty';
      empty.textContent = data.date === state.today
        ? '아직 기록된 콘솔 출력이 없습니다.'
        : '이 날짜에는 저장된 콘솔 기록이 없습니다.';
      elements.consoleOutput.append(empty);
    } else {
      data.entries.forEach((entry) => addConsoleEntry(entry, false));
      scrollConsoleToBottom();
    }
    renderActivity(data.date === state.today ? data.entries : state.consoleEntries);
    updateLivePill();
  }

  async function loadMetricDates() {
    const data = await api('/api/metrics/dates');
    state.today = data.today;
    const dates = [...new Set([data.today, ...data.dates])];
    const selected = dates.includes(state.currentMetricDate) ? state.currentMetricDate : data.today;
    elements.metricsDate.replaceChildren(...dates.map((date) => {
      const option = document.createElement('option');
      option.value = date;
      option.textContent = date === data.today ? `${date} · 오늘` : date;
      return option;
    }));
    elements.metricsDate.value = selected;
    state.currentMetricDate = selected;
  }

  async function loadMetrics(date = state.currentMetricDate || state.today) {
    const data = await api(`/api/metrics?date=${encodeURIComponent(date)}&maxPoints=2000`);
    state.currentMetricDate = data.date;
    state.metricEntries = data.entries;
    state.metricsIntervalMs = data.intervalMs || 5_000;
    elements.metricsDate.value = data.date;
    renderMetrics();
  }

  function updateLivePill() {
    const live = state.currentLogDate === state.today;
    elements.livePill.classList.toggle('history', !live);
    elements.livePill.innerHTML = live ? '<i></i> LIVE' : '<i></i> HISTORY';
  }

  function connectSocket() {
    state.socket?.disconnect();
    state.socket = io({ auth: { token: state.token } });
    state.socket.on('server:status', renderStatus);
    state.socket.on('console:entry', (entry) => {
      if (state.currentLogDate === state.today) {
        state.consoleEntries.push(entry);
        if (state.consoleEntries.length > 2_000) state.consoleEntries.shift();
        addConsoleEntry(entry);
        renderActivity(state.consoleEntries);
      }
    });
    state.socket.on('metrics:entry', (entry) => {
      if (state.currentMetricDate !== state.today) return;
      const existingIndex = state.metricEntries.findIndex((item) => item.id === entry.id);
      if (existingIndex >= 0) state.metricEntries[existingIndex] = entry;
      else state.metricEntries.push(entry);
      if (state.metricEntries.length > 20_000) state.metricEntries.shift();
      renderMetrics();
    });
    state.socket.on('connect_error', (error) => {
      if (/인증/.test(error.message)) showAuth();
    });
  }

  async function refreshStatus() {
    renderStatus(await api('/api/status'));
  }

  async function runServerAction(action) {
    const label = action === 'start' ? '시작' : '종료';
    try {
      const result = await api(`/api/server/${action}`, { method: 'POST' });
      renderStatus(result);
      toast(`서버 ${label} 요청을 보냈습니다.`);
    } catch (error) {
      toast(error.message, 'error');
    }
  }

  function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    if (!bytes) return '—';
    const units = ['B', 'KB', 'MB', 'GB'];
    const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    return `${(bytes / 1024 ** index).toFixed(index ? 1 : 0)} ${units[index]}`;
  }

  function renderBreadcrumbs(directory) {
    elements.breadcrumbs.replaceChildren();
    const root = document.createElement('button');
    root.type = 'button';
    root.className = 'breadcrumb-button';
    root.textContent = 'server';
    root.addEventListener('click', () => loadDirectory(''));
    elements.breadcrumbs.append(root);

    let accumulated = '';
    directory.split('/').filter(Boolean).forEach((part) => {
      accumulated = accumulated ? `${accumulated}/${part}` : part;
      const target = accumulated;
      const separator = document.createElement('span');
      separator.className = 'breadcrumb-separator';
      separator.textContent = '/';
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'breadcrumb-button';
      button.textContent = part;
      button.addEventListener('click', () => loadDirectory(target));
      elements.breadcrumbs.append(separator, button);
    });
  }

  function fileIcon(type) {
    return type === 'directory'
      ? '<svg viewBox="0 0 24 24"><path d="M3 5h7l2 2h9v12H3V5Zm2 4v8h14V9H5Z"/></svg>'
      : '<svg viewBox="0 0 24 24"><path d="M6 3h8l4 4v14H6V3Zm2 2v14h8V9h-4V5H8Zm5 0v3h3l-3-3Z"/></svg>';
  }

  async function loadDirectory(directory = '') {
    try {
      const data = await api(`/api/files?path=${encodeURIComponent(directory)}`);
      state.currentDirectory = data.path;
      renderBreadcrumbs(data.path);
      elements.fileList.replaceChildren();

      if (!data.entries.length) {
        const empty = document.createElement('div');
        empty.className = 'empty-state compact';
        empty.textContent = '이 폴더는 비어 있습니다.';
        elements.fileList.append(empty);
        return;
      }

      data.entries.forEach((entry) => {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = `file-row ${entry.type}`;
        row.dataset.path = entry.path;
        if (state.selectedFile?.path === entry.path) row.classList.add('active');

        const name = document.createElement('span');
        name.className = 'file-name';
        name.innerHTML = fileIcon(entry.type);
        const nameText = document.createElement('span');
        nameText.textContent = entry.name;
        name.append(nameText);

        const size = document.createElement('span');
        size.className = 'file-size';
        size.textContent = entry.type === 'directory' ? '폴더' : formatBytes(entry.size);
        row.append(name, size);
        row.addEventListener('click', () => {
          if (entry.type === 'directory') loadDirectory(entry.path);
          else if (entry.type === 'symlink') toast('심볼릭 링크는 열 수 없습니다.', 'error');
          else openFile(entry.path, row);
        });
        elements.fileList.append(row);
      });
    } catch (error) {
      toast(error.message, 'error');
    }
  }

  async function openFile(path, row) {
    try {
      const file = await api(`/api/file?path=${encodeURIComponent(path)}`);
      state.selectedFile = file;
      state.originalContent = file.content;
      elements.fileEditor.value = file.content;
      elements.fileEditor.disabled = false;
      elements.editorFileName.textContent = file.path.split('/').pop();
      elements.editorFileMeta.textContent = `${file.path} · ${formatBytes(file.size)}`;
      elements.editorStatus.textContent = '저장된 상태';
      elements.saveFileButton.disabled = true;
      document.querySelectorAll('.file-row.active').forEach((item) => item.classList.remove('active'));
      row?.classList.add('active');
      elements.editorPanel.classList.add('mobile-open');
    } catch (error) {
      toast(error.message, 'error');
    }
  }

  async function saveFile() {
    if (!state.selectedFile) return;
    elements.saveFileButton.disabled = true;
    elements.editorStatus.textContent = '저장 중…';
    try {
      const result = await api('/api/file', {
        method: 'PUT',
        body: JSON.stringify({
          path: state.selectedFile.path,
          content: elements.fileEditor.value,
          version: state.selectedFile.version,
        }),
      });
      state.selectedFile = { ...state.selectedFile, ...result, content: elements.fileEditor.value };
      state.originalContent = elements.fileEditor.value;
      elements.editorStatus.textContent = '저장 완료';
      elements.editorFileMeta.textContent = `${result.path} · ${formatBytes(result.size)}`;
      toast('파일을 저장했습니다.');
      loadDirectory(state.currentDirectory);
    } catch (error) {
      elements.editorStatus.textContent = '저장 실패';
      elements.saveFileButton.disabled = false;
      toast(error.message, 'error');
    }
  }

  async function initialize() {
    try {
      const bootstrap = await fetch('/api/bootstrap').then((response) => response.json());
      state.authRequired = bootstrap.authRequired;
      state.today = bootstrap.today;
      if (bootstrap.authRequired) {
        if (!state.token) {
          showAuth();
          return;
        }
        await api('/api/auth/verify', {
          method: 'POST',
          body: JSON.stringify({ token: state.token }),
        });
      }
      hideAuth();
      await startApp();
    } catch {
      state.token = '';
      sessionStorage.removeItem('mc-control-token');
      showAuth();
    }
  }

  async function startApp() {
    connectSocket();
    await Promise.all([refreshStatus(), loadLogDates(), loadMetricDates()]);
    await Promise.all([loadLogs(state.today), loadMetrics(state.today)]);
    setView(location.hash.slice(1) || 'dashboard');
  }

  elements.authForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const token = elements.tokenInput.value;
    try {
      await fetch('/api/auth/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      }).then(async (response) => {
        if (!response.ok) {
          const data = await response.json();
          throw new Error(data.error);
        }
      });
      state.token = token;
      sessionStorage.setItem('mc-control-token', token);
      hideAuth();
      await startApp();
    } catch (error) {
      elements.authError.textContent = error.message;
    }
  });

  elements.navItems.forEach((item) => item.addEventListener('click', () => setView(item.dataset.view)));
  document.querySelectorAll('[data-go-view]').forEach((item) => {
    item.addEventListener('click', () => setView(item.dataset.goView));
  });
  elements.refreshButton.addEventListener('click', async () => {
    try {
      await Promise.all([refreshStatus(), loadLogDates(), loadMetricDates()]);
      await Promise.all([
        loadLogs(state.currentLogDate),
        loadMetrics(state.currentMetricDate),
      ]);
      if (document.querySelector('#view-files').classList.contains('active')) {
        await loadDirectory(state.currentDirectory);
      }
      toast('최신 상태로 갱신했습니다.');
    } catch (error) {
      toast(error.message, 'error');
    }
  });
  elements.startButton.addEventListener('click', () => runServerAction('start'));
  elements.headerStartButton.addEventListener('click', () => runServerAction('start'));
  elements.stopButton.addEventListener('click', () => runServerAction('stop'));
  elements.logDate.addEventListener('change', () => loadLogs(elements.logDate.value));
  elements.metricsDate.addEventListener('change', () => loadMetrics(elements.metricsDate.value));
  elements.metricsRange.addEventListener('change', renderMetrics);
  elements.clearConsoleButton.addEventListener('click', () => {
    elements.consoleOutput.innerHTML = '<div class="terminal-empty">화면을 비웠습니다. 저장된 로그는 삭제되지 않았습니다.</div>';
  });
  elements.commandForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const command = elements.commandInput.value.trim();
    if (!command) return;
    elements.sendCommandButton.disabled = true;
    try {
      await api('/api/console/command', {
        method: 'POST',
        body: JSON.stringify({ command }),
      });
      if (state.commandHistory[state.commandHistory.length - 1] !== command) {
        state.commandHistory.push(command);
        state.commandHistory = state.commandHistory.slice(-100);
        localStorage.setItem(
          'mc-control-command-history',
          JSON.stringify(state.commandHistory),
        );
      }
      state.commandHistoryIndex = -1;
      state.commandDraft = '';
      elements.commandInput.value = '';
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      elements.sendCommandButton.disabled = !['starting', 'running'].includes(state.status?.state);
      elements.commandInput.focus();
    }
  });
  elements.commandInput.addEventListener('keydown', (event) => {
    if (!['ArrowUp', 'ArrowDown'].includes(event.key) || !state.commandHistory.length) return;
    event.preventDefault();
    const result = window.CommandHistory.navigate({
      history: state.commandHistory,
      index: state.commandHistoryIndex,
      draft: state.commandDraft,
      current: elements.commandInput.value,
      direction: event.key === 'ArrowUp' ? 'up' : 'down',
    });
    state.commandHistoryIndex = result.index;
    state.commandDraft = result.draft;
    elements.commandInput.value = result.value;
    elements.commandInput.setSelectionRange(
      elements.commandInput.value.length,
      elements.commandInput.value.length,
    );
  });
  elements.refreshFilesButton.addEventListener('click', () => loadDirectory(state.currentDirectory));
  elements.fileEditor.addEventListener('input', () => {
    const dirty = state.selectedFile && elements.fileEditor.value !== state.originalContent;
    elements.saveFileButton.disabled = !dirty;
    elements.editorStatus.textContent = dirty ? '저장하지 않은 변경사항' : '저장된 상태';
  });
  elements.fileEditor.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      if (!elements.saveFileButton.disabled) saveFile();
    }
  });
  elements.saveFileButton.addEventListener('click', saveFile);
  window.addEventListener('hashchange', () => setView(location.hash.slice(1) || 'dashboard'));
  window.addEventListener('resize', renderMetrics);
  setInterval(updateUptime, 1_000);

  initialize();
})();
