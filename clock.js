/* Ticking Type — движок аналоговых часов.
   Чистый ES, без зависимостей. Запускать только по HTTP (см. README):
   при file:// упадёт fetch() манифеста и getImageData «затравит» canvas. */

(() => {
  'use strict';

  // --- Константы соглашения по ассетам ------------------------------------
  const DIALS_DIR = './assets/dials/';
  const HANDS_DIR = './assets/hands/';
  const MANIFEST  = './dials.json';

  // Параметры теней из раздела 7 брифа. Значения заданы для эталонной стороны
  // SHADOW_REF (px) и масштабируются под реальный размер сцены на экране,
  // чтобы тень не была жёстко прибита к пикселям. Свет — сверху-слева.
  const SHADOW_REF = 1000;
  const SHADOWS = {
    hour:   { x: 2, y: 3, blur: 4  },
    minute: { x: 3, y: 5, blur: 7  },
    second: { x: 5, y: 8, blur: 11 },
    cap:    { x: 2, y: 3, blur: 5  },
  };

  // --- DOM -----------------------------------------------------------------
  const scene  = document.getElementById('scene');
  const dialEl = document.getElementById('dial');
  const rot = {
    hour:   document.querySelector('[data-hand="hour"]   .layer__rot'),
    minute: document.querySelector('[data-hand="minute"] .layer__rot'),
    second: document.querySelector('[data-hand="second"] .layer__rot'),
    cap:    document.querySelector('[data-hand="cap"]    .layer__rot'),
  };
  const handEls = {
    hour:   document.querySelector('[data-hand="hour"]'),
    minute: document.querySelector('[data-hand="minute"]'),
    second: document.querySelector('[data-hand="second"]'),
    cap:    document.querySelector('[data-hand="cap"]'),
  };

  // --- Манифест ------------------------------------------------------------
  // Элемент массива принимается в двух видах (раздел 4):
  //   "dial-01.png"                              -> { file, hands: null }
  //   { "file": "...", "hands": "steel-light" }  -> as is, hands опционален
  // В v1 поле hands нигде не читается, форма заложена под будущее расширение.
  function normalizeEntry(entry) {
    if (typeof entry === 'string') return { file: entry, hands: null };
    if (entry && typeof entry === 'object' && typeof entry.file === 'string') {
      return { file: entry.file, hands: entry.hands ?? null };
    }
    return null; // битый элемент — отфильтруем
  }

  // --- Загрузка и декодирование циферблата --------------------------------
  // Возвращает запись с уже декодированным <img>. decoded — промис готовности,
  // чтобы при листании дождаться картинку, не показывая пустой кадр.
  function makeDial(entry) {
    const img = new Image();
    img.decoding = 'async';
    img.src = DIALS_DIR + entry.file;
    const decoded = (img.decode
      ? img.decode().catch(() => waitOnload(img))
      : waitOnload(img)
    ).then(() => img);
    return { ...entry, img, src: img.src, decoded };
  }

  function waitOnload(img) {
    return new Promise((resolve, reject) => {
      if (img.complete && img.naturalWidth) return resolve();
      img.addEventListener('load', () => resolve(), { once: true });
      img.addEventListener('error', reject, { once: true });
    });
  }

  // --- Фон страницы из кромки циферблата (раздел 10) -----------------------
  // Усредняем цвет по тонкой рамке по периметру изображения (не один пиксель —
  // устойчиво к лёгкой текстуре). Альфа-взвешенно: прозрачные пиксели не врут.
  const COLOR_CANVAS = document.createElement('canvas');
  const SAMPLE = 128;        // во столько ужимаем картинку для семпла
  const BAND = 0.08;         // толщина рамки = 8% стороны

  function edgeColor(img) {
    const c = COLOR_CANVAS;
    c.width = SAMPLE;
    c.height = SAMPLE;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.clearRect(0, 0, SAMPLE, SAMPLE);
    ctx.drawImage(img, 0, 0, SAMPLE, SAMPLE);

    let data;
    try {
      data = ctx.getImageData(0, 0, SAMPLE, SAMPLE).data;
    } catch (e) {
      // Затравленный canvas (например file://) — фон не считаем.
      console.warn('edgeColor: getImageData failed, оставляю текущий фон', e);
      return null;
    }

    const band = Math.max(1, Math.round(SAMPLE * BAND));
    let r = 0, g = 0, b = 0, a = 0;
    for (let y = 0; y < SAMPLE; y++) {
      const onEdgeRow = y < band || y >= SAMPLE - band;
      for (let x = 0; x < SAMPLE; x++) {
        const onEdge = onEdgeRow || x < band || x >= SAMPLE - band;
        if (!onEdge) continue;
        const i = (y * SAMPLE + x) * 4;
        const al = data[i + 3];
        if (al === 0) continue;          // прозрачное — пропускаем
        const w = al / 255;
        r += data[i]     * w;
        g += data[i + 1] * w;
        b += data[i + 2] * w;
        a += w;
      }
    }
    if (a === 0) return null;            // вся кромка прозрачна — фон не трогаем
    return `rgb(${Math.round(r / a)}, ${Math.round(g / a)}, ${Math.round(b / a)})`;
  }

  function applyBackground(dial) {
    const col = edgeColor(dial.img);
    if (col) document.documentElement.style.setProperty('--page-bg', col);
  }

  // --- Тени: масштабирование под размер сцены (раздел 7) -------------------
  function updateShadows() {
    const side = scene.clientWidth || 1;
    const k = side / SHADOW_REF;
    for (const name of Object.keys(SHADOWS)) {
      const s = SHADOWS[name];
      const el = handEls[name];
      el.style.setProperty('--sx', (s.x * k).toFixed(2) + 'px');
      el.style.setProperty('--sy', (s.y * k).toFixed(2) + 'px');
      el.style.setProperty('--sblur', (s.blur * k).toFixed(2) + 'px');
    }
  }

  // --- Логика времени (раздел 8) -------------------------------------------
  // На каждом тике пересчитываем углы заново из системного времени — без
  // накопления дрейфа. Видимый прыжок только у секундной стрелки.
  function tick() {
    const now = new Date();
    const seconds = now.getSeconds();
    const minutes = now.getMinutes() + seconds / 60;
    const hours   = (now.getHours() % 12) + minutes / 60;

    setAngle('second', seconds * 6);   // дискретный шаг 6°/сек
    setAngle('minute', minutes * 6);
    setAngle('hour',   hours * 30);
  }

  function setAngle(name, deg) {
    rot[name].style.setProperty('--angle', deg + 'deg');
  }

  // Обновление синхронизируем с границей секунды, не setInterval(1000).
  function scheduleTick() {
    tick();
    const delay = 1000 - (Date.now() % 1000);
    setTimeout(scheduleTick, delay);
  }

  // --- Листание (раздел 9) -------------------------------------------------
  // Клик в любом месте → следующий циферблат по кругу. Если нужный ещё не
  // догрузился — остаёмся на текущем до готовности, без рывка и пустого кадра.
  let dials = [];
  let displayIndex = 0;
  let targetIndex = 0;
  let stepping = false;

  function showDial(index) {
    const d = dials[index];
    dialEl.src = d.src;
    applyBackground(d);
  }

  async function step() {
    if (stepping) return;
    stepping = true;
    while (displayIndex !== targetIndex) {
      const next = (displayIndex + 1) % dials.length;
      await dials[next].decoded;        // ждём готовности, текущий остаётся виден
      showDial(next);
      displayIndex = next;
    }
    stepping = false;
  }

  function onActivate() {
    if (dials.length < 2) return;
    targetIndex = (targetIndex + 1) % dials.length;
    step();
  }

  // --- Загрузка inline SVG стрелок -----------------------------------------
  // Стрелки именно inline (а не <img src=".svg">), чтобы код мог управлять
  // fill через currentColor / --hand-color без второго комплекта.
  async function loadHands() {
    const names = ['hour', 'minute', 'second', 'cap'];
    await Promise.all(names.map(async (name) => {
      try {
        const res = await fetch(HANDS_DIR + name + '.svg');
        if (!res.ok) throw new Error(res.status);
        rot[name].innerHTML = await res.text();
      } catch (e) {
        console.error('Не загрузилась стрелка', name, e);
      }
    }));
  }

  // --- Старт ---------------------------------------------------------------
  async function init() {
    await loadHands();
    updateShadows();
    scheduleTick();

    let manifest;
    try {
      const res = await fetch(MANIFEST);
      if (!res.ok) throw new Error('manifest ' + res.status);
      manifest = await res.json();
    } catch (e) {
      console.error('Не прочитан dials.json. Запущено по HTTP? см. README.', e);
      return;
    }

    const entries = (manifest.dials || []).map(normalizeEntry).filter(Boolean);
    if (entries.length === 0) {
      console.error('dials.json пуст или битый.');
      return;
    }

    // Первый циферблат грузим и ждём; сцену не показываем до его готовности —
    // нельзя мигнуть голыми стрелками, и фон считается из пикселей картинки.
    const first = makeDial(entries[0]);
    dials = [first];
    try {
      await first.decoded;
    } catch (e) {
      console.error('Первый циферблат не загрузился', e);
      return;
    }

    showDial(0);
    requestAnimationFrame(() => scene.classList.add('is-ready')); // мягкий fade-in

    // Остальные догружаем в фоне, старт не блокируют.
    for (let i = 1; i < entries.length; i++) {
      dials.push(makeDial(entries[i]));
    }

    document.addEventListener('click', onActivate);
    window.addEventListener('resize', updateShadows);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
