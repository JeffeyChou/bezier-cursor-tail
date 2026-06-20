const SVG_NS = 'http://www.w3.org/2000/svg';
const STYLE_ID = 'bezier-cursor-tail-style';

export const DEFAULT_STROKE_OPTIONS = Object.freeze({
  initialWidth: 0.4,
  endWidth: 0.1,
  maxSpeed: 2.0,
  widthDiffStep: 0.1,
  bezierStep: 0.1,
  maxWidth: 11,
  minWidth: 1.2,
  minSampleMs: 8,
  minSampleDistance: 2,
  color: '#111827',
  tool: 'pen',
});

export const DEFAULT_TAIL_OPTIONS = Object.freeze({
  color: '#ff2626',
  maxWidth: 11,
  minWidth: 1.2,
  minOpacity: 0.12,
  maxPoints: 520,
  fadeMs: 2800,
  minSampleMs: 12,
  minSampleDistance: 3,
  pointerSize: 26,
  enabled: true,
  showPointer: true,
  autoBind: true,
});

export const DEFAULT_CANVAS_OPTIONS = Object.freeze({
  color: '#111827',
  size: 5,
  strokeEraserRadius: 10,
  minSampleMs: 8,
  minSampleDistance: 2,
  autoBind: true,
  preserveOnResize: true,
  tool: 'pen',
});

function finiteNumber(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

function positiveNumber(value, fallback) {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function pointFromEvent(event, offsetElement) {
  const source = event.touches && event.touches[0] ? event.touches[0] : event;
  const time = source.timeStamp && source.timeStamp > 0 ? source.timeStamp : Date.now();

  if (offsetElement) {
    const rect = offsetElement.getBoundingClientRect();
    return {
      x: Math.round((source.clientX - rect.left) * 10) / 10,
      y: Math.round((source.clientY - rect.top) * 10) / 10,
      time,
    };
  }

  return {
    x: Math.round(source.clientX * 10) / 10,
    y: Math.round(source.clientY * 10) / 10,
    time,
  };
}

export function strokeDistance(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

export function clampStrokeWidth(width) {
  if (!Number.isFinite(width)) return DEFAULT_STROKE_OPTIONS.initialWidth;
  return Math.max(0.05, Math.min(1, width));
}

export function createStrokeModel(options = {}) {
  const initialWidth = clampStrokeWidth(
    finiteNumber(options.initialWidth, DEFAULT_STROKE_OPTIONS.initialWidth),
  );

  return {
    points: [],
    lastPoint: null,
    lastWidth: initialWidth,
    lastTime: 0,
    maxWidth: positiveNumber(options.maxWidth, DEFAULT_STROKE_OPTIONS.maxWidth),
    minWidth: positiveNumber(options.minWidth, DEFAULT_STROKE_OPTIONS.minWidth),
    minSampleMs: Math.max(0, finiteNumber(options.minSampleMs, DEFAULT_STROKE_OPTIONS.minSampleMs)),
    minSampleDistance: Math.max(
      0,
      finiteNumber(options.minSampleDistance, DEFAULT_STROKE_OPTIONS.minSampleDistance),
    ),
    tool: options.tool || DEFAULT_STROKE_OPTIONS.tool,
    color: options.color || DEFAULT_STROKE_OPTIONS.color,
    compositeOperation: options.compositeOperation,
    initialWidth,
    endWidth: clampStrokeWidth(finiteNumber(options.endWidth, DEFAULT_STROKE_OPTIONS.endWidth)),
    maxSpeed: positiveNumber(options.maxSpeed, DEFAULT_STROKE_OPTIONS.maxSpeed),
    widthDiffStep: positiveNumber(
      options.widthDiffStep,
      DEFAULT_STROKE_OPTIONS.widthDiffStep,
    ),
    bezierStep: positiveNumber(options.bezierStep, DEFAULT_STROKE_OPTIONS.bezierStep),
  };
}

export function strokeLineWidth(begin, end, beginWidth, options = {}) {
  const maxSpeed = positiveNumber(options.maxSpeed, DEFAULT_STROKE_OPTIONS.maxSpeed);
  const smoothStep = positiveNumber(options.step, 0.1);
  const elapsed = Math.max(1, end.time - begin.time);
  const distance = strokeDistance(begin, end);
  const speed = Math.min(maxSpeed, distance / elapsed);
  let width = (maxSpeed - speed) / maxSpeed;
  const maxDiff = distance * smoothStep;

  if (width < 0.05) width = 0.05;
  if (Math.abs(width - beginWidth) > maxDiff) {
    width = width > beginWidth ? beginWidth + maxDiff : beginWidth - maxDiff;
  }

  return clampStrokeWidth(width);
}

export function addStrokePoint(points, point) {
  const prev = points[points.length - 1];
  if (prev && prev.x === point.x && prev.y === point.y) return false;

  points.push({
    x: point.x,
    y: point.y,
    w: clampStrokeWidth(point.w),
  });
  return true;
}

export function differentialAddStrokePoint(points, point, options = {}) {
  const last = points[points.length - 1];
  if (!last) return addStrokePoint(points, point);

  const widthDiffStep = positiveNumber(
    options.widthDiffStep,
    DEFAULT_STROKE_OPTIONS.widthDiffStep,
  );
  const steps = Math.floor(Math.abs(point.w - last.w) / widthDiffStep) + 1;

  for (let i = 1; i < steps; i += 1) {
    addStrokePoint(points, {
      x: last.x + ((point.x - last.x) * i) / steps,
      y: last.y + ((point.y - last.y) * i) / steps,
      w: last.w + ((point.w - last.w) * i) / steps,
    });
  }

  return addStrokePoint(points, point);
}

export function quadraticBezierStroke(points, begin, control, end, options = {}) {
  const bezierStep = positiveNumber(options.bezierStep, DEFAULT_STROKE_OPTIONS.bezierStep);
  const widthDiffStep = positiveNumber(
    options.widthDiffStep,
    DEFAULT_STROKE_OPTIONS.widthDiffStep,
  );

  for (let t = bezierStep; t <= 1.0001; t += bezierStep) {
    const inv = 1 - t;
    differentialAddStrokePoint(
      points,
      {
        x: inv * inv * begin.x + 2 * t * inv * control.x + t * t * end.x,
        y: inv * inv * begin.y + 2 * t * inv * control.y + t * t * end.y,
        w: begin.w + t * (end.w - begin.w),
      },
      { widthDiffStep },
    );
  }
}

export function actualStrokeWidth(model, width) {
  return model.minWidth + (model.maxWidth - model.minWidth) * clampStrokeWidth(width);
}

export function pointToSegmentDistance(point, start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSq = dx * dx + dy * dy;

  if (lengthSq === 0) return strokeDistance(point, start);

  const t = Math.max(
    0,
    Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSq),
  );

  return strokeDistance(point, {
    x: start.x + t * dx,
    y: start.y + t * dy,
  });
}

export function getRenderableOperations(history) {
  const operations = [];

  for (const entry of history || []) {
    if (!entry) continue;

    if (entry.type === 'erase-stroke') {
      const index = operations.findIndex((operation) => operation.id === entry.targetId);
      if (index >= 0) operations.splice(index, 1);
      continue;
    }

    if (entry.points && entry.points.length) operations.push(entry);
  }

  return operations;
}

export function findStrokeOperationIndex(operations, point, options = {}) {
  const canvasWidth = positiveNumber(options.canvasWidth, 1);
  const canvasHeight = positiveNumber(options.canvasHeight, 1);
  const radius = Math.max(0, finiteNumber(options.radius, DEFAULT_CANVAS_OPTIONS.strokeEraserRadius));
  let bestIndex = -1;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (let i = operations.length - 1; i >= 0; i -= 1) {
    const operation = operations[i];
    if (!operation || operation.tool === 'eraser' || !operation.points || !operation.points.length) {
      continue;
    }

    const scaleX = operation.canvasWidth ? canvasWidth / operation.canvasWidth : 1;
    const scaleY = operation.canvasHeight ? canvasHeight / operation.canvasHeight : 1;
    const scale = Math.max(0.1, (scaleX + scaleY) / 2);
    const model = {
      maxWidth: operation.maxWidth * scale,
      minWidth: operation.minWidth * scale,
    };
    const points = operation.points.map((candidate) => ({
      x: candidate.x * scaleX,
      y: candidate.y * scaleY,
      w: candidate.w,
    }));

    if (points.length === 1) {
      const hitDistance = strokeDistance(point, points[0]);
      const hitRadius = radius + actualStrokeWidth(model, points[0].w) / 2;
      if (hitDistance <= hitRadius && hitDistance < bestDistance) {
        bestDistance = hitDistance;
        bestIndex = i;
      }
      continue;
    }

    for (let j = 1; j < points.length; j += 1) {
      const start = points[j - 1];
      const end = points[j];
      const hitDistance = pointToSegmentDistance(point, start, end);
      const hitRadius = radius + actualStrokeWidth(model, Math.max(start.w, end.w)) / 2;

      if (hitDistance <= hitRadius && hitDistance < bestDistance) {
        bestDistance = hitDistance;
        bestIndex = i;
      }
    }
  }

  return bestIndex;
}

export function insertStrokePoint(model, point) {
  const len = model.points.length;
  const sample = {
    x: point.x,
    y: point.y,
    time: Number.isFinite(point.time) ? point.time : Date.now(),
  };

  if (len === 0) {
    addStrokePoint(model.points, { x: sample.x, y: sample.y, w: model.initialWidth });
    model.lastPoint = sample;
    model.lastTime = sample.time;
    model.lastWidth = model.initialWidth;
    return true;
  }

  const distance = strokeDistance(sample, model.lastPoint);
  if (sample.time - model.lastTime < model.minSampleMs || distance < model.minSampleDistance) {
    return false;
  }

  const step = len > 4 ? 0.05 : 0.2;
  let width = (
    strokeLineWidth(model.lastPoint, sample, model.lastWidth, {
      maxSpeed: model.maxSpeed,
      step,
    }) + model.lastWidth
  ) / 2;
  const generated = [];
  const previousRendered = model.points[len - 1];

  addStrokePoint(generated, previousRendered);

  if (len === 1) {
    const mid = {
      x: (model.lastPoint.x + sample.x + 1) / 2,
      y: (model.lastPoint.y + sample.y + 1) / 2,
      w: width,
    };
    differentialAddStrokePoint(generated, mid, model);
    width = mid.w;
  } else {
    quadraticBezierStroke(
      generated,
      previousRendered,
      model.lastPoint,
      {
        x: (model.lastPoint.x + sample.x) / 2,
        y: (model.lastPoint.y + sample.y) / 2,
        w: width,
      },
      model,
    );
  }

  for (let i = 1; i < generated.length; i += 1) {
    addStrokePoint(model.points, generated[i]);
  }

  model.lastPoint = sample;
  model.lastTime = sample.time;
  model.lastWidth = width;
  return true;
}

export function finishStrokeModel(model, point) {
  if (!model || !model.points.length || !point) return false;

  const generated = [];
  const previousRendered = model.points[model.points.length - 1];
  addStrokePoint(generated, previousRendered);
  differentialAddStrokePoint(
    generated,
    { x: point.x, y: point.y, w: model.endWidth },
    model,
  );

  for (let i = 1; i < generated.length; i += 1) {
    addStrokePoint(model.points, generated[i]);
  }

  return true;
}

export function drawStrokeDot(ctx, point, model) {
  configureCanvasStroke(ctx, actualStrokeWidth(model, model.initialWidth), model);
  ctx.beginPath();
  ctx.arc(
    point.x,
    point.y,
    Math.max(actualStrokeWidth(model, model.initialWidth) / 2, 1),
    0,
    Math.PI * 2,
  );
  ctx.fill();
  ctx.globalCompositeOperation = 'source-over';
}

export function configureCanvasStroke(ctx, width, model) {
  const isEraser = model.tool === 'eraser';
  ctx.globalCompositeOperation = model.compositeOperation || (isEraser ? 'destination-out' : 'source-over');
  ctx.strokeStyle = isEraser ? 'rgba(0,0,0,1)' : (model.color || DEFAULT_STROKE_OPTIONS.color);
  ctx.fillStyle = isEraser ? 'rgba(0,0,0,1)' : (model.color || DEFAULT_STROKE_OPTIONS.color);
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
}

export function drawStrokeSegment(ctx, start, end, model) {
  configureCanvasStroke(ctx, actualStrokeWidth(model, end.w), model);
  ctx.beginPath();
  ctx.moveTo(start.x, start.y);
  ctx.lineTo(end.x, end.y);
  ctx.stroke();
}

export function drawStrokePoints(ctx, points, model, startIndex = 1) {
  if (!points || points.length === 0) return 0;
  if (points.length === 1) {
    drawStrokeDot(ctx, points[0], model);
    return 1;
  }

  const first = Math.max(1, startIndex);
  for (let i = first; i < points.length; i += 1) {
    drawStrokeSegment(ctx, points[i - 1], points[i], model);
  }
  ctx.globalCompositeOperation = 'source-over';
  return points.length - first;
}

function toRgb(color) {
  if (typeof color !== 'string') return [255, 38, 38];
  const hex = color.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    const raw = hex[1].length === 3
      ? hex[1].split('').map((char) => char + char).join('')
      : hex[1];
    return [
      parseInt(raw.slice(0, 2), 16),
      parseInt(raw.slice(2, 4), 16),
      parseInt(raw.slice(4, 6), 16),
    ];
  }

  const rgb = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  return [255, 38, 38];
}

function rgba(color, alpha) {
  const [r, g, b] = toRgb(color);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function ensureStyles(doc) {
  if (doc.getElementById(STYLE_ID)) return;

  const style = doc.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .bezier-cursor-tail__pointer {
      position: fixed;
      left: 0;
      top: 0;
      border-radius: 999px;
      pointer-events: none;
      z-index: 3000;
      opacity: 0;
      transform: translate3d(-9999px, -9999px, 0);
      transition: opacity .12s ease, box-shadow .12s ease;
      mix-blend-mode: screen;
    }
    .bezier-cursor-tail__pointer.is-visible { opacity: 1; }
    .bezier-cursor-tail__pointer.is-pulsing { filter: brightness(1.35); }
    .bezier-cursor-tail__svg {
      position: fixed;
      inset: 0;
      width: 100vw;
      height: 100vh;
      pointer-events: none;
      z-index: 2999;
      overflow: visible;
    }
    .bezier-cursor-tail__trail {
      fill: none;
      overflow: visible;
    }
    .bezier-cursor-tail__segment {
      fill: none;
      stroke-linecap: round;
      stroke-linejoin: round;
      vector-effect: non-scaling-stroke;
    }
    .bezier-cursor-tail__trail.is-fading {
      animation: bezierCursorTailFade var(--bezier-cursor-tail-fade-ms, 2800ms) ease-out forwards;
    }
    @keyframes bezierCursorTailFade {
      0% { opacity: 1; }
      70% { opacity: .72; }
      100% { opacity: 0; }
    }
    body.bezier-cursor-tail-active { cursor: crosshair; }
  `;
  doc.head.appendChild(style);
}

export class BezierCursorTail {
  constructor(options = {}) {
    const doc = options.document || document;
    this.document = doc;
    this.window = options.window || doc.defaultView || window;
    this.options = { ...DEFAULT_TAIL_OPTIONS, ...options };
    this.enabled = false;
    this.drawing = false;
    this.trailGroup = null;
    this.trail = null;
    this.pulseTimer = 0;
    this.bound = false;
    this.listeners = [];

    ensureStyles(this.document);
    this.svg = this.createSvg();
    this.pointer = this.createPointer();
    (options.container || this.document.body).append(this.svg, this.pointer);

    if (this.options.autoBind) this.bind();
    if (this.options.enabled) this.enable();
  }

  createSvg() {
    const svg = this.document.createElementNS(SVG_NS, 'svg');
    svg.classList.add('bezier-cursor-tail__svg');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    return svg;
  }

  createPointer() {
    const pointer = this.document.createElement('div');
    const size = positiveNumber(this.options.pointerSize, DEFAULT_TAIL_OPTIONS.pointerSize);
    const color = this.options.color;
    pointer.className = 'bezier-cursor-tail__pointer';
    pointer.setAttribute('aria-hidden', 'true');
    pointer.style.width = `${size}px`;
    pointer.style.height = `${size}px`;
    pointer.style.margin = `${-size / 2}px 0 0 ${-size / 2}px`;
    pointer.style.background = [
      'radial-gradient(circle,',
      'rgba(255,255,255,.95) 0 10%,',
      `${rgba(color, 0.95)} 12% 27%,`,
      `${rgba(color, 0.25)} 30% 58%,`,
      'transparent 62%)',
    ].join(' ');
    pointer.style.boxShadow = `0 0 14px 5px ${rgba(color, 0.55)}, 0 0 34px 10px ${rgba(color, 0.22)}`;
    return pointer;
  }

  bind() {
    if (this.bound) return;
    this.bound = true;
    this.on(this.window, 'pointermove', this.handlePointerMove);
    this.on(this.window, 'pointerleave', this.handlePointerLeave);
    this.on(this.window, 'pointerdown', this.handlePointerDown);
    this.on(this.window, 'pointerup', this.handlePointerUp);
    this.on(this.window, 'pointercancel', this.handlePointerUp);
  }

  unbind() {
    this.listeners.forEach(({ target, type, handler }) => target.removeEventListener(type, handler));
    this.listeners = [];
    this.bound = false;
  }

  on(target, type, method) {
    const handler = method.bind(this);
    target.addEventListener(type, handler);
    this.listeners.push({ target, type, handler });
  }

  enable() {
    this.enabled = true;
    this.document.body.classList.add('bezier-cursor-tail-active');
  }

  disable() {
    this.enabled = false;
    this.document.body.classList.remove('bezier-cursor-tail-active');
    this.pointer.classList.remove('is-visible', 'is-pulsing');
    this.pointer.style.transform = 'translate3d(-9999px, -9999px, 0)';
    this.finishTrail();
  }

  toggle(force) {
    const next = force === undefined ? !this.enabled : Boolean(force);
    if (next) this.enable();
    else this.disable();
    return this.enabled;
  }

  destroy() {
    this.disable();
    this.unbind();
    this.svg.remove();
    this.pointer.remove();
    clearTimeout(this.pulseTimer);
  }

  createTrailGroup() {
    const group = this.document.createElementNS(SVG_NS, 'g');
    group.classList.add('bezier-cursor-tail__trail');
    group.style.setProperty('--bezier-cursor-tail-fade-ms', `${this.options.fadeMs}ms`);
    group.style.filter = `drop-shadow(0 0 8px ${rgba(this.options.color, 0.85)}) drop-shadow(0 0 20px ${rgba(this.options.color, 0.42)})`;
    this.svg.appendChild(group);
    return group;
  }

  createStroke() {
    return createStrokeModel({
      maxWidth: this.options.maxWidth,
      minWidth: this.options.minWidth,
      minSampleMs: this.options.minSampleMs,
      minSampleDistance: this.options.minSampleDistance,
      color: this.options.color,
    });
  }

  startTrail(event) {
    this.drawing = true;
    this.trailGroup = this.createTrailGroup();
    this.trail = this.createStroke();
    insertStrokePoint(this.trail, pointFromEvent(event));
    this.renderTrail();
  }

  appendTrailPoint(event) {
    if (!this.drawing || !this.trailGroup || !this.trail) return;

    if (insertStrokePoint(this.trail, pointFromEvent(event))) {
      if (this.trail.points.length > this.options.maxPoints) {
        this.trail.points.splice(0, this.trail.points.length - this.options.maxPoints);
      }
      this.renderTrail();
    }
  }

  finishTrail(event) {
    if (!this.trailGroup) {
      this.drawing = false;
      this.trail = null;
      return;
    }

    if (this.trail && event && typeof event.clientX === 'number') {
      finishStrokeModel(this.trail, pointFromEvent(event));
      this.renderTrail();
    }

    const group = this.trailGroup;
    this.drawing = false;
    this.trailGroup = null;
    this.trail = null;
    group.classList.add('is-fading');

    const remove = () => group.remove();
    group.addEventListener('animationend', remove, { once: true });
    this.window.setTimeout(remove, this.options.fadeMs + 400);
  }

  renderTrail() {
    if (!this.trailGroup || !this.trail) return;

    this.trailGroup.replaceChildren();
    const points = this.trail.points;
    if (points.length < 2) return;

    const segmentCount = points.length - 1;
    for (let i = 1; i < points.length; i += 1) {
      const start = points[i - 1];
      const end = points[i];
      const ratio = segmentCount <= 1 ? 1 : i / segmentCount;
      const path = this.document.createElementNS(SVG_NS, 'path');
      path.classList.add('bezier-cursor-tail__segment');
      path.setAttribute('d', `M ${start.x} ${start.y} L ${end.x} ${end.y}`);
      path.style.stroke = this.options.color;
      path.style.strokeWidth = actualStrokeWidth(this.trail, end.w).toFixed(2);
      path.style.opacity = (
        this.options.minOpacity + (1 - this.options.minOpacity) * ratio
      ).toFixed(3);
      this.trailGroup.appendChild(path);
    }
  }

  handlePointerMove(event) {
    if (!this.enabled) return;
    if (this.options.showPointer) {
      this.pointer.style.transform = `translate3d(${event.clientX}px, ${event.clientY}px, 0)`;
      this.pointer.classList.add('is-visible');
    }
    this.appendTrailPoint(event);
  }

  handlePointerLeave() {
    this.pointer.classList.remove('is-visible');
    this.finishTrail();
  }

  handlePointerDown(event) {
    if (!this.enabled || event.button !== 0) return;
    this.pointer.classList.add('is-pulsing');
    clearTimeout(this.pulseTimer);
    this.pulseTimer = this.window.setTimeout(() => {
      this.pointer.classList.remove('is-pulsing');
    }, 180);
    this.startTrail(event);
  }

  handlePointerUp(event) {
    this.finishTrail(event);
  }
}

export class BezierCanvasBrush {
  constructor(canvas, options = {}) {
    if (!canvas) throw new TypeError('BezierCanvasBrush requires a canvas element.');
    this.canvas = canvas;
    this.window = canvas.ownerDocument.defaultView || window;
    this.options = { ...DEFAULT_CANVAS_OPTIONS, ...options };
    this.ctx = canvas.getContext('2d');
    this.history = [];
    this.redoStack = [];
    this.nextOperationId = 1;
    this.stroke = null;
    this.renderedIndex = 0;
    this.drawing = false;
    this.bound = false;
    this.listeners = [];

    this.resize({ preserve: false });
    if (this.options.autoBind) this.bind();
  }

  bind() {
    if (this.bound) return;
    this.bound = true;
    this.on(this.canvas, 'pointerdown', this.start);
    this.on(this.canvas, 'pointermove', this.move);
    this.on(this.canvas, 'pointerup', this.end);
    this.on(this.canvas, 'pointercancel', this.end);
    this.on(this.canvas, 'pointerleave', this.end);
  }

  unbind() {
    this.listeners.forEach(({ target, type, handler }) => target.removeEventListener(type, handler));
    this.listeners = [];
    this.bound = false;
  }

  on(target, type, method) {
    const handler = method.bind(this);
    target.addEventListener(type, handler);
    this.listeners.push({ target, type, handler });
  }

  setOptions(options = {}) {
    this.options = { ...this.options, ...options };
  }

  resize({ preserve = this.options.preserveOnResize } = {}) {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = this.window.devicePixelRatio || 1;
    this.canvas.width = Math.max(1, Math.floor(rect.width * dpr));
    this.canvas.height = Math.max(1, Math.floor(rect.height * dpr));
    this.ctx = this.canvas.getContext('2d');
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.ctx.lineCap = 'round';
    this.ctx.lineJoin = 'round';
    if (preserve) this.redraw();
  }

  clearCanvas() {
    this.ctx.save();
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.ctx.restore();
  }

  clear() {
    this.history = [];
    this.redoStack = [];
    this.clearCanvas();
  }

  undo() {
    if (this.drawing || !this.history.length) return false;
    this.redoStack.push(this.history.pop());
    this.redraw();
    return true;
  }

  redo() {
    if (this.drawing || !this.redoStack.length) return false;
    this.history.push(this.redoStack.pop());
    this.redraw();
    return true;
  }

  redraw() {
    this.clearCanvas();
    this.getRenderableOperations().forEach((operation) => this.renderOperation(operation));
    this.ctx.globalCompositeOperation = 'source-over';
  }

  getRenderableOperations() {
    return getRenderableOperations(this.history);
  }

  createStroke() {
    const size = positiveNumber(this.options.size, DEFAULT_CANVAS_OPTIONS.size);
    const isEraser = this.options.tool === 'eraser';
    return createStrokeModel({
      maxWidth: isEraser ? Math.max(size * 2, 12) : size,
      minWidth: isEraser ? Math.max(size, 6) : Math.max(0.8, size * 0.18),
      minSampleMs: this.options.minSampleMs,
      minSampleDistance: this.options.minSampleDistance,
      tool: this.options.tool,
      color: this.options.color,
    });
  }

  start(event) {
    if (event.button !== undefined && event.button !== 0) return;
    event.preventDefault();

    if (this.options.tool === 'stroke-eraser') {
      this.drawing = true;
      this.eraseStrokeAt(pointFromEvent(event, this.canvas));

      try {
        this.canvas.setPointerCapture(event.pointerId);
      } catch (err) {
        // Pointer capture can fail for synthetic events.
      }
      return;
    }

    this.drawing = true;
    this.stroke = this.createStroke();
    this.renderedIndex = 0;
    insertStrokePoint(this.stroke, pointFromEvent(event, this.canvas));

    try {
      this.canvas.setPointerCapture(event.pointerId);
    } catch (err) {
      // Pointer capture can fail for synthetic events.
    }
  }

  move(event) {
    if (this.options.tool === 'stroke-eraser') {
      if (!this.drawing) return;
      event.preventDefault();
      this.eraseStrokeAt(pointFromEvent(event, this.canvas));
      return;
    }

    if (!this.drawing || !this.stroke) return;
    event.preventDefault();
    if (insertStrokePoint(this.stroke, pointFromEvent(event, this.canvas))) {
      this.drawStrokeTail();
    }
  }

  end(event) {
    if (this.options.tool === 'stroke-eraser') {
      if (!this.drawing) return;
      this.drawing = false;

      if (event && event.pointerId !== undefined) {
        try {
          this.canvas.releasePointerCapture(event.pointerId);
        } catch (err) {
          // Pointer capture may already be released by the browser.
        }
      }
      return;
    }

    if (!this.drawing || !this.stroke) return;
    if (this.stroke.points.length === 1) {
      drawStrokeDot(this.ctx, this.stroke.points[0], this.stroke);
    } else if (event && typeof event.clientX === 'number') {
      finishStrokeModel(this.stroke, pointFromEvent(event, this.canvas));
      this.drawStrokeTail();
    }

    this.rememberStroke(this.stroke);
    this.drawing = false;
    this.stroke = null;
    this.renderedIndex = 0;
    this.ctx.globalCompositeOperation = 'source-over';

    if (event && event.pointerId !== undefined) {
      try {
        this.canvas.releasePointerCapture(event.pointerId);
      } catch (err) {
        // Pointer capture may already be released by the browser.
      }
    }
  }

  drawStrokeTail() {
    if (!this.stroke) return;
    const points = this.stroke.points;
    if (points.length < 2) return;

    const startIndex = Math.max(1, this.renderedIndex + 1);
    drawStrokePoints(this.ctx, points, this.stroke, startIndex);
    this.renderedIndex = points.length - 1;
  }

  rememberStroke(stroke) {
    if (!stroke || !stroke.points.length) return;
    const rect = this.canvas.getBoundingClientRect();
    this.history.push({
      id: this.nextOperationId,
      tool: stroke.tool || DEFAULT_STROKE_OPTIONS.tool,
      color: stroke.color || DEFAULT_STROKE_OPTIONS.color,
      maxWidth: stroke.maxWidth,
      minWidth: stroke.minWidth,
      canvasWidth: Math.max(1, rect.width),
      canvasHeight: Math.max(1, rect.height),
      points: stroke.points.map((point) => ({ x: point.x, y: point.y, w: point.w })),
    });
    this.nextOperationId += 1;
    this.redoStack = [];
  }

  eraseStrokeAt(point, options = {}) {
    const rect = this.canvas.getBoundingClientRect();
    const operations = this.getRenderableOperations();
    const radius = positiveNumber(
      options.radius,
      Math.max(
        DEFAULT_CANVAS_OPTIONS.strokeEraserRadius,
        positiveNumber(this.options.strokeEraserRadius, DEFAULT_CANVAS_OPTIONS.strokeEraserRadius),
        positiveNumber(this.options.size, DEFAULT_CANVAS_OPTIONS.size) * 1.2,
      ),
    );
    const index = findStrokeOperationIndex(operations, point, {
      canvasWidth: Math.max(1, rect.width),
      canvasHeight: Math.max(1, rect.height),
      radius,
    });

    if (index < 0) return false;

    if (operations[index].id === undefined) {
      operations[index].id = this.nextOperationId;
      this.nextOperationId += 1;
    }

    this.history.push({
      type: 'erase-stroke',
      targetId: operations[index].id,
    });
    this.redoStack = [];
    this.redraw();
    return true;
  }

  renderOperation(operation) {
    if (!operation || !operation.points || !operation.points.length) return;
    const rect = this.canvas.getBoundingClientRect();
    const scaleX = operation.canvasWidth ? rect.width / operation.canvasWidth : 1;
    const scaleY = operation.canvasHeight ? rect.height / operation.canvasHeight : 1;
    const scale = Math.max(0.1, (scaleX + scaleY) / 2);
    const model = {
      maxWidth: operation.maxWidth * scale,
      minWidth: operation.minWidth * scale,
      tool: operation.tool,
      color: operation.color,
      initialWidth: DEFAULT_STROKE_OPTIONS.initialWidth,
    };
    const points = operation.points.map((point) => ({
      x: point.x * scaleX,
      y: point.y * scaleY,
      w: point.w,
    }));

    drawStrokePoints(this.ctx, points, model);
  }
}
