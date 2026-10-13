(function (root) {
  'use strict';

  const NS = 'http://www.w3.org/2000/svg';
  const MONO = {
    bg: '#F0EFEB',
    ink: '#1C1C1A',
    muted: '#6A6963',
    faint: '#4A4944',
    grid: '#DEDDD6',
    gridSoft: '#E7E6E0',
    ladder: ['#1C1C1A', '#4A4944', '#6A6963', '#8F8E88', '#B0AFA9', '#C6C5BF', '#D8D7D1'],
  };
  const charts = new Map();
  let pinnedRecord = null;
  let styleInstalled = false;

  function svgNode(parent, tag, attrs) {
    const node = document.createElementNS(NS, tag);
    Object.entries(attrs || {}).forEach(([name, value]) => {
      if (value !== undefined && value !== null) node.setAttribute(name, String(value));
    });
    parent.appendChild(node);
    return node;
  }

  function svgText(parent, x, y, value, opts) {
    const o = opts || {};
    const node = svgNode(parent, 'text', {
      x, y,
      'font-size': o.size || 8,
      'font-weight': o.weight || 600,
      fill: o.fill || MONO.muted,
      'text-anchor': o.anchor || 'start',
      'letter-spacing': o.spacing,
      'dominant-baseline': o.baseline,
      'aria-hidden': o.decorative ? 'true' : undefined,
    });
    node.textContent = value;
    return node;
  }

  function installMotionStyles() {
    if (styleInstalled || !document.head) return;
    styleInstalled = true;
    const style = document.createElement('style');
    style.setAttribute('data-lieflat-chart-motion', '');
    style.textContent = `
      @keyframes lieflatMonoPop { from { opacity: 0; transform: scale(.72); } to { opacity: 1; transform: none; } }
      @keyframes lieflatMonoFade { from { opacity: 0; } to { opacity: 1; } }
      .lf-chart-svg { display:block; width:100%; height:auto; overflow:visible; font-family:inherit; }
      .lf-chart-svg .lf-mark { opacity:0; transform-box:fill-box; transform-origin:center; }
      .lf-chart-svg[data-revealed="true"] .lf-mark { animation:lieflatMonoPop .46s cubic-bezier(.2,.7,.3,1) both; animation-delay:var(--lf-delay,0ms); }
      .lf-chart-svg[data-revealed="true"] .lf-fade { animation:lieflatMonoFade .5s ease both; animation-delay:var(--lf-delay,0ms); }
      .lf-chart-svg [data-mark]:focus { outline:none; stroke:#1C1C1A !important; stroke-width:2.2px !important; }
      .lf-chart-svg [data-mark][aria-pressed="true"] { stroke:#1C1C1A !important; stroke-width:2.2px !important; }
      @media (prefers-reduced-motion:reduce) {
        .lf-chart-svg .lf-mark,.lf-chart-svg .lf-fade { opacity:1; animation:none !important; }
      }
    `;
    document.head.appendChild(style);
  }

  function prepareSvg(id, title, description, viewBox, readoutId) {
    const svg = document.getElementById(id);
    if (!svg) return null;
    const previousState = charts.get(id);
    if (previousState && previousState.controller) previousState.controller.abort();
    svg.replaceChildren();
    svg.setAttribute('viewBox', viewBox);
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    svg.setAttribute('role', 'group');
    svg.setAttribute('class', `${svg.getAttribute('class') || ''} lf-chart-svg`.trim());
    svg.setAttribute('aria-labelledby', `${id}-title ${id}-desc`);
    svg.setAttribute('aria-describedby', readoutId);
    svg.setAttribute('focusable', 'false');
    svgNode(svg, 'title', { id: `${id}-title` }).textContent = title;
    svgNode(svg, 'desc', { id: `${id}-desc` }).textContent = description;
    svg.dataset.revealed = 'false';

    const controller = new AbortController();
    const state = { id, readoutId, svg, marks: [], pinnedIndex: -1, defaultMessage: description, controller };
    charts.set(id, state);
    svg.addEventListener('keydown', (event) => onChartKeydown(state, event), { signal: controller.signal });
    svg.addEventListener('pointerleave', () => {
      if (pinnedRecord) {
        const { state: pinnedState, mark } = pinnedRecord;
        updateReadout(pinnedState, mark.message, mark.url, mark.linkLabel);
        showTooltip(mark.message, null, true);
        return;
      }
      const focused = svg.contains(document.activeElement);
      if (!focused) hideTooltip();
    }, { signal: controller.signal });
    svg.addEventListener('click', (event) => {
      if (event.target === svg) reveal(svg, true);
    }, { signal: controller.signal });
    revealWhenVisible(svg);
    return state;
  }

  function reveal(svg, replay) {
    if (!svg) return;
    if (replay) {
      svg.dataset.revealed = 'false';
      // Force style recalculation so the Lieflat entrance can be replayed.
      void svg.getBoundingClientRect().width;
    }
    svg.dataset.revealed = 'true';
  }

  function revealWhenVisible(svg) {
    if (!svg || typeof IntersectionObserver === 'undefined') {
      reveal(svg, false);
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        reveal(svg, false);
        observer.disconnect();
      }
    }, { threshold: 0.12 });
    observer.observe(svg);
  }

  function safeUrl(value) {
    if (!value) return null;
    try {
      const url = new URL(value, document.baseURI);
      return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
    } catch (_) {
      return null;
    }
  }

  function updateReadout(state, text, url, linkLabel) {
    const readout = document.getElementById(state.readoutId);
    if (!readout) return;
    readout.replaceChildren();
    const message = document.createElement('span');
    message.textContent = text;
    readout.appendChild(message);
    const href = safeUrl(url);
    if (href) {
      const link = document.createElement('a');
      link.href = href;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = linkLabel || 'Open GitHub evidence';
      readout.append(' ');
      readout.appendChild(link);
    }
  }

  function showTooltip(text, event, isPinned) {
    const tooltip = document.getElementById('chart-tooltip');
    if (!tooltip) return;
    tooltip.textContent = text;
    tooltip.hidden = false;
    tooltip.dataset.pinned = isPinned ? 'true' : 'false';
    if (event && Number.isFinite(event.clientX) && Number.isFinite(event.clientY)) {
      tooltip.style.left = `${Math.max(8, Math.min(event.clientX + 14, window.innerWidth - 320))}px`;
      tooltip.style.top = `${Math.max(8, Math.min(event.clientY + 14, window.innerHeight - 96))}px`;
    }
  }

  function hideTooltip() {
    const tooltip = document.getElementById('chart-tooltip');
    if (!tooltip || pinnedRecord) return;
    tooltip.hidden = true;
    tooltip.textContent = '';
    delete tooltip.dataset.pinned;
  }

  function describeMark(mark, event, pin) {
    const { state, node, message, url, linkLabel, index } = mark;
    if (pin) {
      if (pinnedRecord && pinnedRecord.mark !== mark) pinnedRecord.mark.node.setAttribute('aria-pressed', 'false');
      pinnedRecord = { state, mark };
    }
    state.marks.forEach((candidate) => candidate.node.setAttribute('aria-pressed', pinnedRecord && candidate === pinnedRecord.mark ? 'true' : 'false'));
    updateReadout(state, message, url, linkLabel);
    showTooltip(message, event, Boolean(pin || (pinnedRecord && pinnedRecord.mark === mark)));
    if (pin) {
      state.pinnedIndex = index;
    }
  }

  function addMark(state, node, message, url, linkLabel, delayMs) {
    const index = state.marks.length;
    const mark = { state, node, message, url, linkLabel, index };
    node.classList.add('lf-mark');
    node.setAttribute('data-mark', 'true');
    node.setAttribute('data-mark-index', String(index));
    node.setAttribute('id', `${state.id}-mark-${index}`);
    node.setAttribute('role', 'button');
    node.setAttribute('aria-label', message);
    node.setAttribute('aria-pressed', 'false');
    node.setAttribute('tabindex', index === 0 ? '0' : '-1');
    node.style.setProperty('--lf-delay', `${Math.max(0, delayMs || 0)}ms`);
    const title = svgNode(node, 'title', {});
    title.textContent = message;
    const listenerOptions = { signal: state.controller.signal };
    node.addEventListener('pointerenter', (event) => {
      if (!pinnedRecord || pinnedRecord.mark !== mark) describeMark(mark, event, false);
      else showTooltip(mark.message, event, true);
    }, listenerOptions);
    node.addEventListener('focus', (event) => {
      reveal(state.svg, false);
      if (!pinnedRecord || pinnedRecord.mark !== mark) describeMark(mark, event, false);
      else showTooltip(mark.message, event, true);
    }, listenerOptions);
    node.addEventListener('click', (event) => {
      event.stopPropagation();
      describeMark(mark, event, true);
    }, listenerOptions);
    node.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        describeMark(mark, event, true);
      }
    }, listenerOptions);
    state.marks.push(mark);
    return node;
  }

  function onChartKeydown(state, event) {
    if (event.key === 'Escape') {
      if (pinnedRecord) {
        const previous = pinnedRecord;
        pinnedRecord = null;
        previous.state.pinnedIndex = -1;
        previous.state.marks.forEach((mark) => mark.node.setAttribute('aria-pressed', 'false'));
        updateReadout(previous.state, previous.state.defaultMessage);
        hideTooltip();
      }
      return;
    }
    if (!['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End'].includes(event.key) || !state.marks.length) return;
    event.preventDefault();
    const activeIndex = state.marks.findIndex((mark) => mark.node === document.activeElement);
    let nextIndex = activeIndex < 0 ? 0 : activeIndex;
    if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = state.marks.length - 1;
    else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') nextIndex = (nextIndex + 1) % state.marks.length;
    else nextIndex = (nextIndex - 1 + state.marks.length) % state.marks.length;
    state.marks.forEach((mark, index) => mark.node.setAttribute('tabindex', index === nextIndex ? '0' : '-1'));
    state.marks[nextIndex].node.focus();
  }

  function addFaded(node, delayMs) {
    node.classList.add('lf-fade');
    node.style.setProperty('--lf-delay', `${Math.max(0, delayMs || 0)}ms`);
    return node;
  }

  function deterministic(index, salt) {
    return Math.abs(((index * 73856093) ^ (salt * 19349663)) % 1000) / 1000;
  }

  function monthName(date) {
    const value = String(date || '').slice(5, 7);
    const names = { '01': 'JAN', '02': 'FEB', '03': 'MAR', '04': 'APR', '05': 'MAY', '06': 'JUN', '07': 'JUL', '08': 'AUG', '09': 'SEP', '10': 'OCT', '11': 'NOV', '12': 'DEC' };
    return names[value] || '';
  }

  function isUtcWeekend(date) {
    const match = String(date || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!match) return false;
    const day = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))).getUTCDay();
    return day === 0 || day === 6;
  }

  function shortDate(date) {
    const match = String(date || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    return match ? `${match[2]}/${match[3]}` : String(date || '');
  }

  function renderActivity(activity) {
    const state = prepareSvg(
      'activity-chart',
      'Daily commit activity',
      'Lieflat L3 Barcode Lollipop: each vertical hairline marks a calendar day and its dot is placed by the number of commits on a zero-based vertical scale. Zero-commit days remain visible; hollow dots mark UTC weekends.',
      '0 0 800 300',
      'activity-readout'
    );
    if (!state) return;
    const rows = Array.isArray(activity) ? activity.slice().sort((a, b) => String(a.date).localeCompare(String(b.date))) : [];
    const top = 30;
    const base = 226;
    const xStart = 48;
    const xSpan = 728;
    const max = Math.max(1, ...rows.map((row) => Math.max(0, Number(row.commits) || 0)));
    if (!rows.length) {
      svgText(state.svg, 400, 160, 'No daily activity data supplied', { size: 12, fill: MONO.muted, anchor: 'middle' });
      updateReadout(state, 'Daily commit activity is unavailable.');
      return;
    }

    const xAt = (index) => rows.length === 1 ? 412 : xStart + index * xSpan / (rows.length - 1);
    const plotHeight = 152;
    const yTicks = [...new Set([0, Math.ceil(max / 2), max])];
    yTicks.forEach((value) => {
      const y = base - value / max * plotHeight;
      svgNode(state.svg, 'line', { x1: xStart, y1: y, x2: xStart + xSpan, y2: y, stroke: MONO.gridSoft, 'stroke-width': 0.6 });
      svgText(state.svg, 38, y + 2.5, String(value), { size: 7, fill: MONO.muted, anchor: 'end' });
    });
    for (let i = 0; i < rows.length; i += 1) {
      const x = xAt(i);
      const guide = svgNode(state.svg, 'line', {
        x1: x, y1: top, x2: x, y2: base,
        stroke: MONO.grid, 'stroke-width': 0.7,
      });
      addFaded(guide, i * 6);
    }

    const peaks = [];
    rows.map((row) => Math.max(0, Number(row.commits) || 0))
      .map((value, index) => ({ value, index }))
      .sort((a, b) => b.value - a.value || a.index - b.index)
      .forEach(({ index, value }) => {
        if (value > 0 && peaks.every((existing) => Math.abs(existing - index) >= Math.max(4, Math.floor(rows.length / 12)))) peaks.push(index);
      });
    const peakSet = new Set(peaks.slice(0, 3));

    rows.forEach((row, index) => {
      const commits = Math.max(0, Number(row.commits) || 0);
      const x = xAt(index);
      const y = base - commits / max * plotHeight;
      const stem = svgNode(state.svg, 'line', {
        x1: x, y1: y, x2: x, y2: base,
        stroke: commits > 0 ? MONO.ink : MONO.ladder[5],
        'stroke-width': commits > 0 ? 1 : 0.8,
        'stroke-linecap': 'round',
      });
      addFaded(stem, 180 + index * 7);
      const radius = peakSet.has(index) ? 4.4 : 2.35;
      const weekend = isUtcWeekend(row.date);
      const dot = svgNode(state.svg, 'circle', {
        cx: x, cy: y, r: radius,
        fill: weekend ? MONO.bg : MONO.ink,
        stroke: weekend ? MONO.ink : (commits > 0 ? MONO.bg : MONO.ladder[5]),
        'stroke-width': weekend ? 1.1 : (commits > 0 ? 0.35 : 1),
      });
      const people = Number(row.uniqueAuthors) || 0;
      const cumulative = Number(row.cumulativeAuthors) || 0;
      const message = `${row.date}: ${commits} commits${row.uniqueAuthors !== undefined ? ` by ${people} linked accounts` : ''}${row.cumulativeAuthors !== undefined ? `; ${cumulative} cumulative linked accounts` : ''}${weekend ? '; UTC weekend' : ''}.`;
      addMark(state, dot, message, null, null, 180 + index * 7);
      if (peakSet.has(index)) {
        const label = svgText(state.svg, x, Math.max(18, y - 9), String(commits), { size: 8, weight: 800, fill: MONO.ink, anchor: 'middle' });
        addFaded(label, 650 + index * 5);
      }
      const currentMonth = monthName(row.date);
      const previousMonth = index ? monthName(rows[index - 1].date) : '';
      if (currentMonth && currentMonth !== previousMonth) {
        svgText(state.svg, x, 250, currentMonth, { size: 7, fill: MONO.muted, spacing: '.1em', anchor: 'middle' });
      }
    });
    svgNode(state.svg, 'line', { x1: xStart, y1: base, x2: xStart + xSpan, y2: base, stroke: MONO.grid, 'stroke-width': 0.8 });
    svgText(state.svg, xStart, 266, shortDate(rows[0].date), { size: 7, fill: MONO.muted, anchor: 'start' });
    svgText(state.svg, xStart + xSpan, 266, shortDate(rows[rows.length - 1].date), { size: 7, fill: MONO.muted, anchor: 'end' });
    svgText(state.svg, 412, 289, 'ONE DOT = ONE CALENDAR DAY · HEIGHT = COMMITS · HOLLOW = UTC WEEKEND', { size: 7, weight: 600, fill: MONO.muted, spacing: '.1em', anchor: 'middle' });
    updateReadout(state, `${rows.length} calendar days; ${rows.reduce((total, row) => total + (Number(row.commits) || 0), 0)} commits total. The vertical scale runs from zero to ${max} commits; hollow dots mark UTC weekends. Focus a dot and use arrow keys to inspect daily activity.`);
  }

  function compactLogin(login) {
    const value = String(login || 'unknown');
    return value.length > 14 ? `${value.slice(0, 12)}…` : value;
  }

  function renderContributors(contributors) {
    const state = prepareSvg(
      'contributor-chart',
      'Top contributors by commits',
      'Lieflat F5 Tick Rows: the top eight commit-attributed identities are ranked horizontally. One full tick equals 25 commits; the final partial tick is proportional to the remainder.',
      '0 0 440 332',
      'contributor-readout'
    );
    if (!state) return;
    const rows = (Array.isArray(contributors) ? contributors.slice() : [])
      .sort((a, b) => (Number(b.contributions) || 0) - (Number(a.contributions) || 0) || String(a.login).localeCompare(String(b.login)))
      .slice(0, 8);
    if (!rows.length) {
      svgText(state.svg, 220, 170, 'No contributor data supplied', { size: 12, fill: MONO.muted, anchor: 'middle' });
      updateReadout(state, 'Commit-attributed contributor data is unavailable.');
      return;
    }
    const unit = 25;
    const maxUnits = Math.max(1, ...rows.map((row) => (Number(row.contributions) || 0) / unit));
    const pitch = Math.min(15, 224 / maxUnits);
    const x0 = 142;
    const rowY = (index) => 36 + index * 33;

    rows.forEach((row, index) => {
      const count = Math.max(0, Number(row.contributions) || 0);
      const whole = Math.floor(count / unit);
      const remainder = count % unit;
      const y = rowY(index);
      const label = compactLogin(row.login);
      const leftLabel = svgText(state.svg, 132, y + 4, label, { size: 7.1, weight: 700, fill: MONO.muted, anchor: 'end', spacing: '.02em' });
      leftLabel.setAttribute('aria-hidden', 'true');
      svgNode(state.svg, 'line', { x1: x0, y1: y + 11, x2: x0 + Math.ceil(maxUnits) * pitch, y2: y + 11, stroke: MONO.grid, 'stroke-width': 0.6 });
      for (let tick = 0; tick < whole; tick += 1) {
        const x = x0 + tick * pitch + pitch / 2;
        const line = svgNode(state.svg, 'line', {
          x1: x, y1: y + 10, x2: x, y2: y - 1,
          stroke: MONO.ink, 'stroke-width': 1.15, 'stroke-linecap': 'round',
        });
        const commitsAtEnd = Math.min(count, (tick + 1) * unit);
        const message = `${row.login}: at least ${commitsAtEnd} of ${count} commit-attributed commits; each tick represents 25.`;
        addMark(state, line, message, row.url, `Open ${row.login} on GitHub`, 100 + index * 50 + tick * 10);
        if (tick % 5 === 4) {
          const marker = svgNode(state.svg, 'circle', { cx: x, cy: y + 15, r: 0.85, fill: MONO.faint });
          addFaded(marker, 100 + index * 50 + tick * 10);
        }
      }
      if (remainder > 0) {
        const x = x0 + whole * pitch + pitch / 2;
        const fraction = remainder / unit;
        const height = 11 * fraction;
        const partial = svgNode(state.svg, 'line', {
          x1: x, y1: y + 10, x2: x, y2: y + 10 - height,
          stroke: MONO.ladder[2], 'stroke-width': 1.5, 'stroke-linecap': 'round',
        });
        const message = `${row.login}: ${count} commit-attributed commits; ${whole} full ticks of 25 and a final partial tick for ${remainder}.`;
        addMark(state, partial, message, row.url, `Open ${row.login} on GitHub`, 100 + index * 50 + whole * 10);
      }
      const labelX = x0 + (count / unit) * pitch + 8;
      const total = svgText(state.svg, Math.min(430, labelX), y + 4, String(count), { size: 9.5, weight: 800, fill: MONO.ink });
      addFaded(total, 420 + index * 55);
    });
    svgText(state.svg, x0, 318, 'ONE FULL TICK = 25 COMMITS · PARTIAL TICK = REMAINDER / 25', { size: 7, weight: 600, fill: MONO.muted, spacing: '.08em' });
    updateReadout(state, `Showing ${rows.length} commit-attributed identities; a partial tick is proportional to the remainder after groups of 25 commits.`);
  }

  function renderParticipation(authors) {
    const state = prepareSvg(
      'participation-chart',
      'Merged-PR authors by repeat participation',
      'Lieflat L14 Hundred Field adapted as two unit-decomposed fields: each dot is one real author of a merged pull request, grouped by one merged PR or multiple merged PRs.',
      '0 0 520 350',
      'participation-readout'
    );
    if (!state) return;
    const rows = (Array.isArray(authors) ? authors.slice() : []).sort((a, b) => String(a.login).localeCompare(String(b.login)));
    if (!rows.length) {
      svgText(state.svg, 260, 178, 'No merged-author data supplied', { size: 12, fill: MONO.muted, anchor: 'middle' });
      updateReadout(state, 'Merged-PR author data is unavailable.');
      return;
    }
    const groups = [
      { key: 'repeat', name: 'REPEAT AUTHORS', filter: (row) => Number(row.mergedPrCount) > 1, center: [150, 155], shade: MONO.ink },
      { key: 'single', name: 'ONE MERGED PR', filter: (row) => Number(row.mergedPrCount) === 1, center: [370, 155], shade: MONO.ladder[5] },
    ];
    const assigned = new Set();
    groups.forEach((group, groupIndex) => {
      const members = rows.filter(group.filter);
      members.forEach((row) => assigned.add(row.login));
      const [cx, cy] = group.center;
      const points = [];
      members.forEach((row, index) => {
        const angle = index * 137.508 + groupIndex * 55;
        const radius = 4 + Math.sqrt(index) * 5.9 + deterministic(index + 1, groupIndex + 2) * 3;
        const radians = angle * Math.PI / 180;
        const x = cx + radius * Math.cos(radians);
        const y = cy + radius * Math.sin(radians);
        points.push([x, y]);
      });
      points.forEach(([x, y], index) => {
        if (index % 5 === 0) {
          const spoke = svgNode(state.svg, 'line', { x1: cx, y1: cy, x2: x, y2: y, stroke: MONO.grid, 'stroke-width': 0.55 });
          addFaded(spoke, groupIndex * 100 + index * 8);
        }
        const row = members[index];
        const dot = svgNode(state.svg, 'circle', { cx: x, cy: y, r: 2.05, fill: group.shade, stroke: MONO.bg, 'stroke-width': 0.35 });
        const count = Number(row.mergedPrCount) || 0;
        const bucket = count > 1 ? 'repeat author' : 'one merged PR';
        const message = `${row.login}: ${count} merged PR${count === 1 ? '' : 's'} (${bucket}).`;
        addMark(state, dot, message, row.url, `Open ${row.login} on GitHub`, 100 + groupIndex * 180 + index * 8);
      });
      const edge = members.length ? 4 + Math.sqrt(members.length - 1) * 5.9 + 3 : 0;
      svgText(state.svg, cx, cy + edge + 21, `${group.name} · ${members.length}`, { size: 8, weight: 800, fill: group.shade, anchor: 'middle', spacing: '.09em' });
    });
    const other = rows.filter((row) => !assigned.has(row.login));
    if (other.length) {
      other.forEach((row) => {
        const dot = svgNode(state.svg, 'circle', { cx: 260, cy: 316, r: 2.2, fill: MONO.ladder[5] });
        addMark(state, dot, `${row.login}: ${Number(row.mergedPrCount) || 0} merged PRs; the count is outside the two displayed groups.`, row.url, `Open ${row.login} on GitHub`, 2200);
      });
    }
    svgText(state.svg, 260, 337, `ONE DOT = ONE AUTHOR · ${rows.length} DISTINCT MERGED-PR AUTHORS`, { size: 7, weight: 600, fill: MONO.muted, anchor: 'middle', spacing: '.09em' });
    const repeat = rows.filter((row) => Number(row.mergedPrCount) > 1).length;
    const single = rows.filter((row) => Number(row.mergedPrCount) === 1).length;
    updateReadout(state, `${rows.length} distinct authors with merged PRs: ${repeat} repeat authors and ${single} with exactly one merged PR. Arrow keys move between dots; select one to pin its GitHub profile.`);
  }

  function fallbackBucketRange(label) {
    const value = String(label || '').toLowerCase().replace(/\s+/g, '');
    if (value.includes('under_1') || value.includes('<1')) return [0, 1];
    const plus = value.match(/(\d+(?:\.\d+)?)h?\+|(?:\d+(?:\.\d+)?)h?_plus/);
    if (plus) return [Number(plus[1]), Infinity];
    const range = value.match(/(\d+(?:\.\d+)?)\D+(\d+(?:\.\d+)?)/);
    if (range) return [Number(range[1]), Number(range[2])];
    return [NaN, NaN];
  }

  function normalizedBucketLabel(label) {
    const value = String(label || '');
    const replacements = [
      [/under_1h/i, '<1 h'], [/1_to_6h/i, '1–6 h'], [/6_to_12h/i, '6–12 h'],
      [/12_to_24h/i, '12–24 h'], [/24_to_48h/i, '24–48 h'], [/48h_plus/i, '48 h+'],
    ];
    for (const [pattern, result] of replacements) if (pattern.test(value)) return result;
    return value.replace(/_/g, ' ');
  }

  function renderMergeDistribution(prSample) {
    const state = prepareSvg(
      'merge-chart',
      'Merged pull-request durations',
      'Lieflat F1 Rung Bars used as a six-bin frequency chart. Each horizontal rung is one merged pull request in the bounded sample; bins are elapsed hours from opening to merge.',
      '0 0 440 320',
      'merge-readout'
    );
    if (!state) return;
    const sample = prSample || {};
    const durations = sample.merge_duration_hours || {};
    const histogram = Array.isArray(durations.histogram) ? durations.histogram : [];
    const records = Array.isArray(sample.records) ? sample.records.filter((row) => row.merged_at && typeof row.merge_duration_hours === 'number' && Number.isFinite(row.merge_duration_hours)) : [];
    const bins = histogram.map((bin) => {
      const fallback = fallbackBucketRange(bin.label);
      const lower = Number.isFinite(Number(bin.min_hours_inclusive)) ? Number(bin.min_hours_inclusive) : fallback[0];
      const upper = bin.max_hours_exclusive === null ? Infinity : (Number.isFinite(Number(bin.max_hours_exclusive)) ? Number(bin.max_hours_exclusive) : fallback[1]);
      const members = Number.isFinite(lower) ? records.filter((row) => {
        const value = Number(row.merge_duration_hours);
        return value >= lower && value < upper;
      }) : [];
      return { ...bin, lower, upper, members, count: members.length, shortLabel: normalizedBucketLabel(bin.label) };
    });
    if (!bins.length) {
      svgText(state.svg, 220, 164, 'No merge-duration sample supplied', { size: 12, fill: MONO.muted, anchor: 'middle' });
      updateReadout(state, sample.sample_definition || 'Merge-duration sample is unavailable.');
      return;
    }
    const expectedCounts = [10, 8, 28, 12, 18, 4];
    const actualCounts = bins.map((bin) => bin.count);
    const total = actualCounts.reduce((sum, count) => sum + count, 0);
    const countsMatch = bins.length === expectedCounts.length
      && actualCounts.every((count, index) => count === expectedCounts[index])
      && total === 80;
    if (!countsMatch) {
      const detail = `Duration chart validation failed: expected six bins [${expectedCounts.join(', ')}] (80 total), received [${actualCounts.join(', ')}] (${total} total).`;
      svgText(state.svg, 220, 142, 'Duration sample does not match audited counts', { size: 10, fill: MONO.ink, anchor: 'middle' });
      svgText(state.svg, 220, 162, `Expected 10, 8, 28, 12, 18, 4 · received ${actualCounts.join(', ')}`, { size: 7.5, fill: MONO.muted, anchor: 'middle' });
      updateReadout(state, detail);
      console.error(detail);
      return;
    }
    const base = 252;
    const step = 5.5;
    const xAt = (index) => 45 + index * 69;
    bins.forEach((bin, index) => {
      const x = xAt(index);
      const count = bin.count;
      for (let tick = 0; tick < count; tick += 1) {
        const y = base - tick * step;
        const halfWidth = 13 - 1.5 + deterministic(tick + 1, index + 2) * 3;
        const rung = svgNode(state.svg, 'line', {
          x1: x - halfWidth, y1: y, x2: x + halfWidth, y2: y,
          stroke: MONO.ink, 'stroke-width': 1.05, 'stroke-linecap': 'round',
          opacity: 0.78 + deterministic(tick + 2, index + 4) * 0.22,
        });
        const record = bin.members[tick];
        const prLabel = record && record.number ? `PR #${record.number}` : 'Merged PR';
        const hours = record ? Number(record.merge_duration_hours) : null;
        const durationLabel = hours === null ? '' : `; ${hours.toFixed(2)} hours from open to merge`;
        const text = `${bin.shortLabel}: ${prLabel}${durationLabel}. One rung represents one PR in the sampled bin.`;
        addMark(state, rung, text, record && record.url, record && record.number ? `Open PR #${record.number} on GitHub` : null, 80 + index * 60 + tick * 8);
        if (tick % 5 === 4) {
          const dot = svgNode(state.svg, 'circle', { cx: x + 17.5, cy: y, r: 0.8, fill: MONO.faint });
          addFaded(dot, 80 + index * 60 + tick * 8);
        }
      }
      const top = count ? base - (count - 1) * step : base;
      const countLabel = svgText(state.svg, x, Math.max(18, top - 10), String(count), { size: 10, weight: 800, fill: MONO.ink, anchor: 'middle' });
      addFaded(countLabel, 460 + index * 75);
      svgText(state.svg, x, base + 20, bin.shortLabel, { size: 6.7, weight: 700, fill: MONO.muted, anchor: 'middle' });
    });
    svgNode(state.svg, 'line', { x1: 24, y1: base + 4, x2: 416, y2: base + 4, stroke: MONO.grid, 'stroke-width': 0.8 });
    svgText(state.svg, 220, 306, 'ONE RUNG = ONE MERGED PR · RECENTLY UPDATED CLOSED-PR SAMPLE', { size: 6.5, weight: 600, fill: MONO.muted, anchor: 'middle', spacing: '.06em' });
    updateReadout(state, `Showing ${total} merged PRs across ${bins.length} duration bins. ${sample.sample_definition || 'The sample is bounded and is not a random estimate of overall review time.'} Focus a rung for its PR and merge duration.`);
  }

  function renderCharts(data) {
    if (!root.document) return;
    pinnedRecord = null;
    hideTooltip();
    installMotionStyles();
    const source = data || {};
    renderActivity(source.activity);
    renderContributors(source.contributors);
    renderParticipation(source.mergedAuthors);
    renderMergeDistribution(source.prSample);
  }

  root.renderCharts = renderCharts;
  if (typeof module !== 'undefined' && module.exports) module.exports = { renderCharts };
})(typeof window !== 'undefined' ? window : globalThis);
