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

  const state = { rows: [], charts: {}, mappingError: false, preferredType: 'b2c' };
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

  function percentage(value) {
    const parsed = number(value);
    if (parsed === null) return null;
    return Math.abs(parsed) > 1 ? parsed / 100 : parsed;
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

  function normalize(raw) {
    return {
      id: raw.id,
      course: text(raw.course) || 'Без названия',
      stream: text(raw.stream) || '—',
      typePotok: text(raw.type_potok) || 'Без типа',
      endDate: parseDate(raw.endDate),
      month: number(raw.month),
      quarter: number(raw.quarter),
      year: number(raw.year),
      totalNew: number(raw.total_new) ?? 0,
      totalCor: number(raw.total_cor) ?? 0,
      totalScoredMoreHalf: number(raw.total_scored_more_half) ?? 0,
      cor: percentage(raw.CoR),
      performance: percentage(raw.completed)
    };
  }

  function hasEndDate(row) {
    return validDate(row.endDate);
  }

  function hasEnded(row) {
    const today = endOfDay(new Date());
    return hasEndDate(row) && row.endDate.getTime() <= today.getTime();
  }

  function aggregate(rows) {
    const sums = rows.reduce((acc, row) => {
      acc.totalNew += row.totalNew;
      acc.totalCor += row.totalCor;
      acc.totalScoredMoreHalf += row.totalScoredMoreHalf;

      if (row.cor !== null) {
        acc.corSimpleSum += row.cor;
        acc.corSimpleCount += 1;
        if (row.totalNew > 0) {
          acc.corWeightedSum += row.cor * row.totalNew;
          acc.corWeight += row.totalNew;
        }
      }

      if (row.performance !== null) {
        acc.performanceSimpleSum += row.performance;
        acc.performanceSimpleCount += 1;
        if (row.totalCor > 0) {
          acc.performanceWeightedSum += row.performance * row.totalCor;
          acc.performanceWeight += row.totalCor;
        }
      }
      return acc;
    }, {
      totalNew: 0,
      totalCor: 0,
      totalScoredMoreHalf: 0,
      corWeightedSum: 0,
      corWeight: 0,
      corSimpleSum: 0,
      corSimpleCount: 0,
      performanceWeightedSum: 0,
      performanceWeight: 0,
      performanceSimpleSum: 0,
      performanceSimpleCount: 0
    });

    return {
      total: sums.totalNew,
      totalCor: sums.totalCor,
      scored: sums.totalScoredMoreHalf,
      streams: rows.length,
      cor: sums.corWeight > 0
        ? sums.corWeightedSum / sums.corWeight
        : (sums.corSimpleCount > 0 ? sums.corSimpleSum / sums.corSimpleCount : null),
      performance: sums.performanceWeight > 0
        ? sums.performanceWeightedSum / sums.performanceWeight
        : (sums.performanceSimpleCount > 0 ? sums.performanceSimpleSum / sums.performanceSimpleCount : null)
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
    const typePotok = el('typeFilter').value;
    const year = el('yearFilter').value;
    const quarter = el('quarterFilter').value;
    return state.rows.filter((row) =>
      (course === 'all' || row.course === course) &&
      (typePotok === 'all' || row.typePotok === typePotok) &&
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
    const typeSelect = el('typeFilter');
    const yearSelect = el('yearFilter');
    const currentCourse = courseSelect.value;
    const currentYear = yearSelect.value;

    courseSelect.innerHTML = '<option value="all">Все курсы</option>';
    typeSelect.innerHTML = '<option value="all">Все типы</option>';
    yearSelect.innerHTML = '<option value="all">Все годы</option>';

    [...new Set(state.rows.map((r) => r.course))]
      .sort((a, b) => a.localeCompare(b, 'ru'))
      .forEach((course) => option(courseSelect, course, course));

    [...new Set(state.rows.map((r) => r.typePotok).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, 'ru'))
      .forEach((typePotok) => option(typeSelect, typePotok, typePotok));

    [...new Set(state.rows.map((r) => r.year).filter(Boolean))]
      .sort((a, b) => b - a)
      .forEach((year) => option(yearSelect, String(year), String(year)));

    if ([...courseSelect.options].some((o) => o.value === currentCourse)) courseSelect.value = currentCourse;
    if ([...yearSelect.options].some((o) => o.value === currentYear)) yearSelect.value = currentYear;

    if (state.preferredType === 'all') {
      typeSelect.value = 'all';
    } else {
      const preferred = [...typeSelect.options]
        .find((o) => o.value.toLocaleLowerCase('ru') === state.preferredType.toLocaleLowerCase('ru'));
      const defaultB2c = [...typeSelect.options]
        .find((o) => o.value.toLocaleLowerCase('ru') === 'b2c');
      typeSelect.value = preferred?.value || defaultB2c?.value || 'all';
    }
  }

  function rateClass(value) {
    if (value === null) return '';
    if (value >= .75) return 'rate-good';
    if (value >= .50) return 'rate-mid';
    return 'rate-low';
  }

  function comparisonRowsForSelectedPeriod() {
    const course = el('courseFilter').value;
    const yearValue = el('yearFilter').value;
    const quarterValue = el('quarterFilter').value;

    // Сравнение показываем только для конкретных курса, года и квартала.
    if (course === 'all' || yearValue === 'all' || quarterValue === 'all') return null;

    const typePotok = el('typeFilter').value;
    const year = Number(yearValue);
    const quarter = Number(quarterValue);

    const previousQuarter = quarter === 1 ? 4 : quarter - 1;
    const previousYear = quarter === 1 ? year - 1 : year;
    const nextQuarter = quarter === 4 ? 1 : quarter + 1;
    const nextYear = quarter === 4 ? year + 1 : year;

    const baseRows = state.rows.filter((row) =>
      row.course === course &&
      (typePotok === 'all' || row.typePotok === typePotok)
    );

    return {
      current: baseRows.filter((row) => row.year === year && row.quarter === quarter),
      previous: baseRows.filter((row) => row.year === previousYear && row.quarter === previousQuarter),
      next: baseRows.filter((row) => row.year === nextYear && row.quarter === nextQuarter)
    };
  }

  function completedTotal(rows) {
    return rows
      .filter(hasEnded)
      .reduce((sum, row) => sum + row.totalCor, 0);
  }

  function comparisonValue(current, reference, label, percent = false) {
    if (current === null || current === undefined || reference === null || reference === undefined) return null;

    const diff = current - reference;
    const arrow = diff > 0 ? '↑' : diff < 0 ? '↓' : '→';
    const tone = diff > 0 ? 'good' : diff < 0 ? 'bad' : 'neutral';
    const absDiff = Math.abs(diff);

    if (percent) {
      const points = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(absDiff * 100);
      return { text: `${arrow} ${points} п.п. ${label}`, tone };
    }

    return { text: `${arrow} ${fmtInt.format(absDiff)} ${label}`, tone };
  }

  function setKpiComparisons(id, comparisons = []) {
    const node = el(id);
    if (!node) return;

    node.innerHTML = '';

    comparisons.filter(Boolean).forEach((comparison) => {
      const line = document.createElement('span');
      line.className = `kpi-compare-line compare-${comparison.tone}`;
      line.textContent = comparison.text;
      node.appendChild(line);
    });

    node.classList.toggle('hidden', node.childElementCount === 0);
  }

  function hideKpiComparisons() {
    ['kpiTotalCompare', 'kpiCompletedCompare', 'kpiCorCompare', 'kpiPerformanceCompare']
      .forEach((id) => setKpiComparisons(id));
  }

  function renderKpis(rows) {
    const kpi = aggregate(rows);
    const endedTotal = completedTotal(rows);

    el('kpiTotal').textContent = fmtInt.format(kpi.total);
    el('kpiStreams').textContent = `${fmtInt.format(kpi.streams)} ${plural(kpi.streams, ['поток', 'потока', 'потоков'])}`;
    el('kpiCompleted').textContent = fmtInt.format(endedTotal);
    el('kpiCor').textContent = kpi.cor === null ? '—' : fmtPct.format(kpi.cor);
    el('kpiPerformance').textContent = kpi.performance === null ? '—' : fmtPct.format(kpi.performance);
    el('kpiScored').textContent = `${fmtInt.format(kpi.scored)} набрали более 50% баллов`;

    const comparison = comparisonRowsForSelectedPeriod();
    if (!comparison || comparison.current.length === 0) {
      hideKpiComparisons();
      return;
    }

    const current = aggregate(comparison.current);
    const previous = comparison.previous.length ? aggregate(comparison.previous) : null;
    const next = comparison.next.length ? aggregate(comparison.next) : null;

    setKpiComparisons('kpiTotalCompare', [
      previous ? comparisonValue(current.total, previous.total, 'к предыдущему кварталу') : null,
      next ? comparisonValue(next.total, current.total, 'в следующем квартале') : null
    ]);

    setKpiComparisons('kpiCompletedCompare', [
      previous ? comparisonValue(completedTotal(comparison.current), completedTotal(comparison.previous), 'к предыдущему кварталу') : null,
      next ? comparisonValue(completedTotal(comparison.next), completedTotal(comparison.current), 'в следующем квартале') : null
    ]);

    setKpiComparisons('kpiCorCompare', [
      previous ? comparisonValue(current.cor, previous.cor, 'к предыдущему кварталу', true) : null,
      next ? comparisonValue(next.cor, current.cor, 'в следующем квартале', true) : null
    ]);

    setKpiComparisons('kpiPerformanceCompare', [
      previous ? comparisonValue(current.performance, previous.performance, 'к предыдущему кварталу', true) : null,
      next ? comparisonValue(next.performance, current.performance, 'в следующем квартале', true) : null
    ]);
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
        <td class="cell-period cell-center"><span class="period-pill">${escapeHtml(periodText(row))}</span></td>
        <td class="cell-course cell-left" title="${escapeHtml(row.course)}"><span class="cell-text">${escapeHtml(row.course)}</span></td>
        <td class="cell-stream cell-left" title="${escapeHtml(row.stream)}"><span class="cell-text">${escapeHtml(row.stream)}</span></td>
        <td class="cell-type cell-center"><span class="type-pill">${escapeHtml(row.typePotok)}</span></td>
        <td class="cell-status cell-center"><span class="status-pill ${hasEnded(row) ? 'status-done' : 'status-active'}">${hasEnded(row) ? 'Завершён' : 'Идёт'}</span></td>
        <td class="cell-center">${fmtInt.format(row.totalNew)}</td>
        <td class="cell-center">${fmtInt.format(row.totalCor)}</td>
        <td class="cell-center">${fmtInt.format(row.totalScoredMoreHalf)}</td>
        <td class="cell-center ${rateClass(row.cor)}">${row.cor === null ? '—' : fmtPct.format(row.cor)}</td>
        <td class="cell-center ${rateClass(row.performance)}">${row.performance === null ? '—' : fmtPct.format(row.performance)}</td>
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
    state.preferredType = 'b2c';
    const b2cOption = [...el('typeFilter').options]
      .find((o) => o.value.toLocaleLowerCase('ru') === 'b2c');
    el('typeFilter').value = b2cOption?.value || 'all';
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
      showEmpty('Нет потоков с заполненной датой окончания.', false);
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

    el('typeFilter').addEventListener('change', () => {
      state.preferredType = el('typeFilter').value;
      render();
    });

    el('resetFilters').addEventListener('click', resetFilters);
    el('emptyResetFilters').addEventListener('click', resetFilters);
  }

  function setRows(rows) {
    state.mappingError = false;
    state.rows = rows
      .map(normalize)
      .filter((row) => row.course && hasEndDate(row));
    syncFilters();
    render();
  }

  function setupGrist() {
    grist.ready({
      requiredAccess: 'read table',
      columns: [
        { name: 'course', title: 'Курс', description: 'Название курса', type: 'Text,Choice' },
        { name: 'stream', title: 'Поток', description: 'Номер или название потока' },
        { name: 'type_potok', title: 'Тип потока', description: 'Тип потока, например b2c', type: 'Text,Choice' },
        { name: 'endDate', title: 'Дата окончания', description: 'Дата окончания потока', type: 'Date,DateTime' },
        { name: 'month', title: 'Месяц окончания', description: 'Номер месяца от 1 до 12', type: 'Int,Numeric' },
        { name: 'quarter', title: 'Квартал окончания', description: 'Номер квартала от 1 до 4', type: 'Int,Numeric' },
        { name: 'year', title: 'Год окончания', description: 'Год окончания обучения', type: 'Int,Numeric' },
        { name: 'total_new', title: 'Всего студентов', description: 'Готовое значение из существующей колонки', type: 'Int,Numeric' },
        { name: 'total_cor', title: 'CoR, кол-во', description: 'Готовое количество из существующей колонки', type: 'Int,Numeric' },
        { name: 'total_scored_more_half', title: 'Набрали >50%, кол-во', description: 'Готовое количество из существующей колонки', type: 'Int,Numeric' },
        { name: 'CoR', title: 'CoR, %', description: 'Готовый процент из существующей колонки', type: 'Numeric' },
        { name: 'completed', title: 'Набрали >50%, %', description: 'Готовый процент из существующей колонки', type: 'Numeric' }
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
          const totalNew = 70 + ci * 18 + quarter * 6 + (year - 2024) * 12;
          const totalCor = Math.max(totalNew - 3 - ci, 1);
          const totalScoredMoreHalf = Math.round(totalCor * (.48 + ci * .07 + quarter * .025));
          rows.push({
            id: id++,
            course,
            stream: `${year}-${quarter}-${ci + 1}`,
            type_potok: ci === 2 ? 'b2b' : 'b2c',
            endDate: new Date(year, quarter * 3, 0),
            month: quarter * 3,
            quarter,
            year,
            total_new: totalNew,
            total_cor: totalCor,
            total_scored_more_half: totalScoredMoreHalf,
            CoR: totalCor / totalNew,
            completed: totalCor > 0 ? totalScoredMoreHalf / totalCor : 0
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
