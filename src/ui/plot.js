/**
 * Графики своими руками, обычным SVG.
 *
 * Раньше их рисовала Chart.js, которую приложение тянуло с внешнего адреса.
 * Там, где этот адрес недоступен — а у части провайдеров он недоступен, —
 * статистика оставалась пустыми прямоугольниками: цифры в таблице под ними
 * были, а графиков не было. Зависеть от чужого сервера ради трёх картинок
 * незачем, тем более что в проекте нет и остальных зависимостей.
 *
 * SVG рисуется один раз и дальше живёт сам: ни холста, ни разрушения при
 * уходе с экрана, ни утечек. Масштаб задаёт viewBox — картинка тянется по
 * ширине карточки и остаётся резкой на любом экране.
 *
 * Цвета берутся из темы готовыми значениями (см. themeColor): внутрь SVG
 * переменные CSS не протекают через атрибуты fill и stroke.
 */

const NS = 'http://www.w3.org/2000/svg';

/** Узел SVG: тот же el(), но в пространстве имён SVG. */
function svg(tag, attrs = {}, children = []) {
  const node = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue;
    node.setAttribute(key, String(value));
  }
  for (const child of [children].flat(Infinity)) {
    if (child == null || child === false) continue;
    node.append(child);
  }
  return node;
}

/**
 * Круглая шкала делений: 0, 5k, 10k… Подбирается так, чтобы делений было
 * три-четыре, а числа оставались круглыми — иначе подписи читаются хуже, чем
 * никакие.
 */
export function niceTicks(max, count = 4) {
  if (!(max > 0)) return [0];

  const raw = max / count;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const rounded = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= raw) || magnitude * 10;
  // Деньги считаем целыми: дробный шаг у сумм в динарах бессмысленен.
  const step = Math.max(1, rounded);

  // Верхнее деление обязано быть не ниже самого большого значения, иначе
  // линия уходит за край поля и график врёт.
  const top = Math.ceil(max / step) * step;

  const ticks = [];
  for (let value = 0; value <= top + step / 2; value += step) ticks.push(value);
  return ticks;
}

/** Короткая запись числа для подписей осей: 1 200 000 → 1.2M, 24 000 → 24k. */
export function compact(value) {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`;
  if (abs >= 1000) return `${Math.round(value / 1000)}k`;
  return String(Math.round(value));
}

/**
 * Кольцо долей.
 *
 * items: [{ value, color, label }]. Подписи рисуем не на кольце, а рядом —
 * легендой занимается вызывающий: на телефоне подписи внутри кольца всё
 * равно не помещаются.
 */
export function donut(items, { size = 220, thickness = 26 } = {}) {
  const total = items.reduce((sum, item) => sum + Math.max(0, item.value), 0);
  const radius = (size - thickness) / 2;
  const center = size / 2;
  const circumference = 2 * Math.PI * radius;

  // Начинаем сверху: так привычнее читать доли по часовой стрелке.
  let offset = 0;

  const rings = items
    .filter((item) => item.value > 0)
    .map((item) => {
      const share = total ? item.value / total : 0;
      const ring = svg('circle', {
        cx: center,
        cy: center,
        r: radius,
        fill: 'none',
        stroke: item.color,
        'stroke-width': thickness,
        'stroke-dasharray': `${share * circumference} ${circumference}`,
        'stroke-dashoffset': -offset * circumference,
        transform: `rotate(-90 ${center} ${center})`,
      });
      offset += share;
      return ring;
    });

  return svg('svg', {
    viewBox: `0 0 ${size} ${size}`,
    width: '100%',
    height: '100%',
    role: 'img',
    // Кольцо круглое, и места ему выделено по высоте карточки: вписываем
    // целиком и ставим посередине.
    style: 'display:block;margin:0 auto',
  }, rings);
}

/**
 * Линии по месяцам.
 *
 * lines: [{ label, color, values }] — значения по тем же подписям labels.
 * Точка ставится у каждого месяца: их тут единицы, и по точке видно, что
 * это измерение, а не изгиб линии.
 */
export function lines({
  labels, lines: series, grid, ink, width = 520, height = 240,
}) {
  const padLeft = 46;
  const padRight = 10;
  const padTop = 12;
  const padBottom = 26;

  const values = series.flatMap((line) => line.values);
  const max = Math.max(0, ...values);
  const ticks = niceTicks(max);
  const top = ticks[ticks.length - 1] || 1;

  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;

  const x = (index) => (labels.length < 2
    ? padLeft + plotW / 2
    : padLeft + (index * plotW) / (labels.length - 1));
  const y = (value) => padTop + plotH - (value / top) * plotH;

  const gridLines = ticks.map((tick) => svg('g', {}, [
    svg('line', {
      x1: padLeft, x2: width - padRight, y1: y(tick), y2: y(tick), stroke: grid, 'stroke-width': 1,
    }),
    svg('text', {
      x: padLeft - 8,
      y: y(tick) + 4,
      fill: ink,
      'font-size': 11,
      'text-anchor': 'end',
    }, [document.createTextNode(compact(tick))]),
  ]));

  const months = labels.map((label, index) => svg('text', {
    x: x(index),
    y: height - 8,
    fill: ink,
    'font-size': 11,
    'text-anchor': index === 0 ? 'start' : index === labels.length - 1 ? 'end' : 'middle',
  }, [document.createTextNode(label)]));

  const paths = series.map((line) => {
    const points = line.values.map((value, index) => [x(index), y(value)]);
    const d = points.map(([px, py], index) => `${index ? 'L' : 'M'}${px} ${py}`).join(' ');

    return svg('g', {}, [
      // Заливка под линией — мягкая подсветка площади, как было у Chart.js.
      points.length > 1
        ? svg('path', {
            d: `${d} L${points[points.length - 1][0]} ${padTop + plotH} L${points[0][0]} ${padTop + plotH} Z`,
            fill: line.color,
            opacity: 0.12,
          })
        : null,
      svg('path', {
        d, fill: 'none', stroke: line.color, 'stroke-width': 2, 'stroke-linejoin': 'round',
      }),
      ...points.map(([px, py]) => svg('circle', { cx: px, cy: py, r: 3, fill: line.color })),
    ]);
  });

  return svg('svg', {
    viewBox: `0 0 ${width} ${height}`,
    width: '100%',
    height: '100%',
    role: 'img',
    // Пропорции сохраняем: при растягивании по месту подписи осей
    // расплющивались бы вместе с полем.
    preserveAspectRatio: 'xMidYMid meet',
    style: 'display:block',
  }, [gridLines, paths, months]);
}

/**
 * Лежачие столбики — сравнение двух-трёх величин.
 *
 * Подпись и число пишем прямо на строке: отдельная ось ради двух значений
 * только отнимает место.
 */
export function barsH({ items, ink, format, width = 520, rowHeight = 54 }) {
  const padLeft = 10;
  const padRight = 10;
  const max = Math.max(0, ...items.map((item) => item.value)) || 1;
  const height = items.length * rowHeight;
  const barW = width - padLeft - padRight;

  const rows = items.map((item, index) => {
    const y = index * rowHeight + 20;
    const length = Math.max(2, (Math.max(0, item.value) / max) * barW);

    return svg('g', {}, [
      svg('text', {
        x: padLeft, y: y - 4, fill: ink, 'font-size': 12,
      }, [document.createTextNode(item.label)]),
      svg('rect', {
        x: padLeft, y, width: length, height: 18, rx: 7, fill: item.color,
      }),
      svg('text', {
        x: padLeft + length + 8,
        y: y + 14,
        fill: ink,
        'font-size': 12,
      }, [document.createTextNode(format(item.value))]),
    ]);
  });

  return svg('svg', {
    viewBox: `0 0 ${width} ${height}`,
    width: '100%',
    height: '100%',
    role: 'img',
    style: 'display:block;max-height:100%',
  }, rows);
}
