/* global grist, Chart */
(() => {
  'use strict';

  const MONTHS = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
  const COLORS = {
    blue: '#3b6ff5',
    green: '#24a779',
    blueSoft: 'rgba(59,111,245,.18)',
    greenSoft: 'rgba(36,167,121,.18)',
    grid: '#e9edf4',
    text: '#5d687f'
  };

  const state = { rows: [], charts: {}, mappingError: false };
  const el = (id) => document.getElementById(id);
  const fmtInt = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });
  const fmtPct = new Intl.NumberFormat('ru-RU', { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1 });

  Chart.defaults.font.family = 'Inter, system-ui, sans-serif';
  Chart.defaults.color = COLORS.text;
  Chart.defaults.animation.duration = 250;

  function number(value) {
    if (value === null || value === undefined || value === '') return null;
    if (Array.isArray(value) && value[0] === 'E') return null;
    const parsed = Number(String(value).replace(/\u00a0/g, '').replace('%', '').replace(',', '.').trim());
    return Number.isFinite(parsed) ? parsed : null;
  }

  function text(value) {
    if (value === null || value === undefined) return '';
    return String(value).trim();
  }

  function validDate(date) {
    return date instanceof Date && Number.isFinite(date.getTime());
  }

  function endOfDay(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
  }

  function parseDate(value) {
    if (value === null || value === undefined || value === '') return null;

    if (value instanceof Date) return validDate(value) ? endOfDay(value) : null;

    if (typeof value === 'number' && Number.isFinite(value)) {
      // Grist Date/DateTime обычно передаётся как Unix timestamp в секундах.
      const milliseconds = Math.abs(value) < 1e11 ? value * 1000 : value;
      const date = new Date(milliseconds);
      return validDate(date) ? endOfDay(date) : null;
    }

    const raw = String(value).trim();
    const ruDate = raw.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
    if (ruDate) {
      const date = new Date(Number(ruDate[3]), Number(ruDate[2]) - 1, Number(ruDate[1]));
      return validDate(date) ? endOfDay(date) : null;
    }

    const isoDate = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (isoDate) {
      const date = new Date(Number(isoDate[1]), Number(isoDate[2]) - 1, Number(isoDate[3]));
      return validDate(date) ? endOfDay(date) : null;
    }

    const parsed = new Date(raw);
    return validDate(parsed) ? endOfDay(parsed) : null;
  }

  function endOfMonth(year, month) {
    if (!year || !month || month < 1 || month > 12) return null;
    return new Date(year, month, 0, 23, 59, 59, 999);
  }

  function normalize(raw) {
    const total = number(raw.total) ?? 0;
    const completed = number(raw.completed) ?? 0;
    const scored = number(raw.scored) ?? 0;
    const explicitEndDate = parseDate(raw.endDate);

    let month = number(raw.month);
    let year = number(raw.year);
    let quarter = number(raw.quarter);

    if (explicitEndDate) {
      month = explicitEndDate.getMonth() + 1;
      year = explicitEndDate.getFullYear();
      quarter = Math.floor((month - 1) / 3) + 1;
    } else if (!quarter && month) {
      quarter = Math.floor((month - 1) / 3) + 1;
    }

    const endDate = explicitEndDate || endOfMonth(year, month);

    return {
      id: raw.id,
      course: text(raw.course) || 'Без названия',
      stream: text(raw.stream) || '—',
      month,
      quarter,
      year,
      endDate,
      total,
      completed,
      scored,
      cor: total > 0 ? completed / total : null,
      performance: completed > 0 && scored <= completed ? scored / completed : null
    };
  }

  function hasEnded(row) {
    return validDate(row.endDate) && row.endDate.getTime() <= Date.now();
  }

  function aggregate(rows) {
    const sums = rows.reduce((acc, row) => {
      acc.total += row.total;
      acc.completed += row.completed;
      acc.scored += row.scored;
      if (row.completed > 0 && row.scored <= row.completed) {
        acc.performanceCompleted += row.completed;
        acc.performanceScored += row.scored;
      }
      return acc;
    }, { total: 0, completed: 0, scored: 0, performanceCompleted: 0, performanceScored: 0 });

    return {
      ...sums,
      streams: rows.length,
      cor: sums.total > 0 ? sums.completed / sums.total : null,
      performance: sums.performanceCompleted > 0 ? sums.performanceScored / sums.performanceCompleted : null
    };
  }

  function groupRows(rows, granularity) {
    const groups = new Map();
    for (const row of rows) {
      if (!row.year || !row.quarter || (granularity === 'month' && !row.month)) continue;
      const key = granularity === 'month'
        ? `${row.year}-${String(row.month).padStart(2, '0')}`
        : `${row.year}-Q${row.quarter}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(row);
    }

    return [...groups.entries()]
      .map(([key, grouped]) => {
        const value = aggregate(grouped);
        const first = grouped[0];
        return {
          key,
          sort: granularity === 'month' ? first.year * 100 + first.month : first.year * 10 + first.quarter,
          label: granularity === 'month'
            ? `${MONTHS[first.month - 1]} ${String(first.year).slice(-2)}`
            : `Q${first.quarter} ${first.year}`,
          ...value
        };
      })
      .sort((a, b) => a.sort - b.sort);
  }

  function getFilteredRows() {
    const course = el('courseFilter').value;
    const year = el('yearFilter').value;
    const quarter = el('quarterFilter').value;
    return state.rows.filter((row) =>
      (course === 'all' || row.course === course) &&
      (year === 'all' || String(row.year) === year) &&
      (quarter === 'all' || String(row.quarter) === quarter)
    );
  }

  function option(select, value, label) {
    const node = document.createElement('option');
    node.value = value;
    node.textContent = label;
    select.appendChild(node);
  }

  function syncFilters() {
    const courseSelect = el('courseFilter');
    const yearSelect = el('yearFilter');
    const currentCourse = courseSelect.value;
    const currentYear = yearSelect.value;
    courseSelect.innerHTML = '<option value="all">Все курсы</option>';
    yearSelect.innerHTML = '<option value="all">Все годы</option>';

    [...new Set(state.rows.map((r) => r.course))]
      .sort((a, b) => a.localeCompare(b, 'ru'))
      .forEach((course) => option(courseSelect, course, course));

    [...new Set(state.rows.map((r) => r.year).filter(Boolean))]
      .sort((a, b) => b - a)
      .forEach((year) => option(yearSelect, String(year), String(year)));

    if ([...courseSelect.options].some((o) => o.value === currentCourse)) courseSelect.value = currentCourse;
    if ([...yearSelect.options].some((o) => o.value === currentYear)) yearSelect.value = currentYear;
  }

  function rateClass(value) {
    if (value === null) return '';
    if (value >= .75) return 'rate-good';
    if (value >= .50) return 'rate-mid';
    return 'rate-low';
  }

  function renderKpis(rows) {
    const kpi = aggregate(rows);
    el('kpiTotal').textContent = fmtInt.format(kpi.total);
    el('kpiStreams').textContent = `${fmtInt.format(kpi.streams)} ${plural(kpi.streams, ['поток', 'потока', 'потоков'])}`;
    el('kpiCompleted').textContent = fmtInt.format(kpi.completed);
    el('kpiCor').textContent = kpi.cor === null ? '—' : fmtPct.format(kpi.cor);
    el('kpiPerformance').textContent = kpi.performance === null ? '—' : fmtPct.format(kpi.performance);
    el('kpiScored').textContent = `${fmtInt.format(kpi.scored)} набрали более 50% баллов`;
  }

  function plural(value, forms) {
    const n = Math.abs(value) % 100;
    const n1 = n % 10;
    if (n > 10 && n < 20) return forms[2];
    if (n1 > 1 && n1 < 5) return forms[1];
    if (n1 === 1) return forms[0];
    return forms[2];
  }

  function baseOptions(percent = false) {
    return {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { position: 'bottom', labels: { usePointStyle: true, pointStyle: 'circle', boxWidth: 7, padding: 18 } },
        tooltip: {
          backgroundColor: '#172033',
          padding: 11,
          cornerRadius: 9,
          callbacks: percent ? { label: (ctx) => `${ctx.dataset.label}: ${fmtPct.format(ctx.raw / 100)}` } : {}
        }
      },
      scales: {
        x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 14 } },
        y: percent
          ? { min: 0, suggestedMax: 100, grid: { color: COLORS.grid }, ticks: { callback: (v) => `${v}%` } }
          : { beginAtZero: true, grid: { color: COLORS.grid }, ticks: { precision: 0 } }
      }
    };
  }

  function updateChart(name, canvasId, config) {
    if (state.charts[name]) state.charts[name].destroy();
    state.charts[name] = new Chart(el(canvasId), config);
  }

  function renderCharts(rows) {
    const granularity = el('granularityFilter').value;
    const groups = groupRows(rows, granularity);
    const labels = groups.map((g) => g.label);

    updateChart('rates', 'rateChart', {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'CoR',
            data: groups.map((g) => g.cor === null ? null : g.cor * 100),
            borderColor: COLORS.blue,
            backgroundColor: COLORS.blueSoft,
            pointBackgroundColor: COLORS.blue,
            pointRadius: 3,
            pointHoverRadius: 5,
            tension: .28,
            spanGaps: true
          },
          {
            label: 'Успеваемость',
            data: groups.map((g) => g.performance === null ? null : g.performance * 100),
            borderColor: COLORS.green,
            backgroundColor: COLORS.greenSoft,
            pointBackgroundColor: COLORS.green,
            pointRadius: 3,
            pointHoverRadius: 5,
            tension: .28,
            spanGaps: true
          }
        ]
      },
      options: baseOptions(true)
    });

    updateChart('students', 'studentChart', {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: 'Всего студентов',
            data: groups.map((g) => g.total),
            backgroundColor: COLORS.blueSoft,
            borderColor: COLORS.blue,
            borderWidth: 1,
            borderRadius: 6
          }
        ]
      },
      options: baseOptions(false)
    });
  }

  function periodText(row) {
    const month = row.month ? `${MONTHS[row.month - 1]} · ` : '';
    return `${month}Q${row.quarter} ${row.year}`;
  }

  function renderTable(rows) {
    const sorted = [...rows].sort((a, b) =>
      b.endDate.getTime() - a.endDate.getTime() ||
      a.course.localeCompare(b.course, 'ru') ||
      a.stream.localeCompare(b.stream, 'ru', { numeric: true })
    );

    el('tableCount').textContent = `${fmtInt.format(sorted.length)} ${plural(sorted.length, ['строка', 'строки', 'строк'])}`;
    el('detailsBody').innerHTML = sorted.map((row) => `
      <tr>
        <td><span class="period-pill">${escapeHtml(periodText(row))}</span></td>
        <td>${escapeHtml(row.course)}</td>
        <td>${escapeHtml(row.stream)}</td>
        <td class="num">${fmtInt.format(row.total)}</td>
        <td class="num">${fmtInt.format(row.completed)}</td>
        <td class="num">${fmtInt.format(row.scored)}</td>
        <td class="num ${rateClass(row.cor)}">${row.cor === null ? '—' : fmtPct.format(row.cor)}</td>
        <td class="num ${rateClass(row.performance)}">${row.performance === null ? '—' : fmtPct.format(row.performance)}</td>
      </tr>`).join('');
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
  }

  function destroyCharts() {
    Object.values(state.charts).forEach((chart) => chart.destroy());
    state.charts = {};
  }

  function setContentVisible(visible) {
    document.querySelectorAll('.dashboard-content')
      .forEach((node) => node.classList.toggle('hidden', !visible));
  }

  function showEmpty(message, allowReset = true) {
    destroyCharts();
    setContentVisible(false);
    el('emptyMessage').textContent = message;
    el('emptyResetFilters').classList.toggle('hidden', !allowReset);
    el('emptyState').classList.remove('hidden');
  }

  function hideEmpty() {
    el('emptyState').classList.add('hidden');
    setContentVisible(true);
  }

  function resetFilters() {
    el('courseFilter').value = 'all';
    el('yearFilter').value = 'all';
    el('quarterFilter').value = 'all';
    el('granularityFilter').value = 'quarter';
    render();
  }

  function render() {
    if (state.mappingError) {
      showEmpty('Сопоставьте обязательные колонки в панели настройки виджета Grist.', false);
      return;
    }

    if (state.rows.length === 0) {
      showEmpty('Нет завершённых потоков с заполненной датой окончания.', false);
      return;
    }

    const rows = getFilteredRows();
    if (rows.length === 0) {
      showEmpty('По выбранным фильтрам данных нет. Сбросьте фильтры или выберите другие значения.');
      return;
    }

    hideEmpty();
    renderKpis(rows);
    renderCharts(rows);
    renderTable(rows);
    el('updatedAt').textContent = `Обновлено: ${new Date().toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' })}`;
  }

  function bindEvents() {
    ['courseFilter', 'yearFilter', 'quarterFilter', 'granularityFilter']
      .forEach((id) => el(id).addEventListener('change', render));

    el('resetFilters').addEventListener('click', resetFilters);
    el('emptyResetFilters').addEventListener('click', resetFilters);
  }

  function setRows(rows) {
    state.mappingError = false;
    state.rows = rows
      .map(normalize)
      .filter((row) => row.course && hasEnded(row));
    syncFilters();
    render();
  }

  function setupGrist() {
    grist.ready({
      requiredAccess: 'read table',
      columns: [
        { name: 'course', title: 'Курс', description: 'Название курса', type: 'Text,Choice' },
        { name: 'stream', title: 'Поток', description: 'Номер или название потока' },
        { name: 'endDate', title: 'Дата окончания', description: 'Точная дата окончания потока. Необязательное поле', type: 'Date,DateTime', optional: true },
        { name: 'month', title: 'Месяц окончания', description: 'Номер месяца от 1 до 12', type: 'Int,Numeric' },
        { name: 'quarter', title: 'Квартал окончания', description: 'Номер квартала от 1 до 4', type: 'Int,Numeric' },
        { name: 'year', title: 'Год окончания', description: 'Год окончания обучения', type: 'Int,Numeric' },
        { name: 'total', title: 'Всего студентов', description: 'Количество студентов на потоке', type: 'Int,Numeric' },
        { name: 'completed', title: 'Окончили обучение', description: 'Количество окончивших обучение', type: 'Int,Numeric' },
        { name: 'scored', title: 'Набрали >50%', description: 'Количество студентов, набравших более 50% баллов', type: 'Int,Numeric' }
      ]
    });

    grist.onRecords((records) => {
      const mapped = grist.mapColumnNames(records);
      if (!mapped) {
        state.rows = [];
        state.mappingError = true;
        syncFilters();
        render();
        return;
      }
      setRows(mapped);
    });
  }

  function demoRows() {
    const rows = [];
    const courses = ['StartDA', 'HardDE', 'SysDes'];
    let id = 1;
    for (let year = 2024; year <= 2025; year++) {
      for (let quarter = 1; quarter <= 4; quarter++) {
        courses.forEach((course, ci) => {
          const total = 70 + ci * 18 + quarter * 6 + (year - 2024) * 12;
          const completed = Math.round(total * (.72 + ci * .08 + quarter * .018));
          const scored = Math.round(completed * (.48 + ci * .07 + quarter * .025));
          rows.push({
            id: id++,
            course,
            stream: `${year}-${quarter}-${ci + 1}`,
            month: quarter * 3,
            quarter,
            year,
            total,
            completed,
            scored
          });
        });
      }
    }
    return rows;
  }

  bindEvents();
  if (new URLSearchParams(window.location.search).has('demo')) setRows(demoRows());
  else setupGrist();
})();
