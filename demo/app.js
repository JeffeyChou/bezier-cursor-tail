import { BezierCanvasBrush, BezierCursorTail } from '../src/bezier-cursor-tail.js';
import {
  base64ToBytes,
  bytesToBase64,
  decodeDrawing,
  encodeDrawing,
} from '../src/stroke-format.js';

const STORAGE_KEY = 'bezier-cursor-tail:drawing';

const canvas = document.querySelector('[data-role="canvas"]');
const colorInput = document.querySelector('[data-role="color"]');
const sizeInput = document.querySelector('[data-role="size"]');
const sizeValue = document.querySelector('[data-role="size-value"]');
const toolButtons = Array.from(document.querySelectorAll('[data-tool]'));
const undoButton = document.querySelector('[data-role="undo"]');
const redoButton = document.querySelector('[data-role="redo"]');
const clearButton = document.querySelector('[data-role="clear"]');
const tailToggle = document.querySelector('[data-role="tail-toggle"]');
const saveButton = document.querySelector('[data-role="save"]');
const openButton = document.querySelector('[data-role="open"]');
const fileInput = document.querySelector('[data-role="file"]');
const storageMeter = document.querySelector('[data-role="storage"]');

const brush = new BezierCanvasBrush(canvas, {
  color: colorInput.value,
  size: Number(sizeInput.value),
  onChange: persist,
});

const tail = new BezierCursorTail({
  color: '#ef4444',
  maxWidth: 10,
  minWidth: 1.1,
  enabled: tailToggle.checked,
});

function syncToolbar() {
  sizeValue.textContent = sizeInput.value;
  undoButton.disabled = brush.history.length === 0 || brush.drawing;
  redoButton.disabled = brush.redoStack.length === 0 || brush.drawing;
}

function setTool(tool) {
  brush.setOptions({ tool });
  toolButtons.forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.tool === tool));
  });
  canvas.dataset.tool = tool;
}

toolButtons.forEach((button) => {
  button.addEventListener('click', () => setTool(button.dataset.tool));
});

colorInput.addEventListener('input', () => {
  brush.setOptions({ color: colorInput.value });
});

sizeInput.addEventListener('input', () => {
  brush.setOptions({ size: Number(sizeInput.value) });
  syncToolbar();
});

tailToggle.addEventListener('change', () => {
  tail.toggle(tailToggle.checked);
});

undoButton.addEventListener('click', () => {
  brush.undo();
  syncToolbar();
});

redoButton.addEventListener('click', () => {
  brush.redo();
  syncToolbar();
});

clearButton.addEventListener('click', () => {
  brush.clear();
  syncToolbar();
});

document.addEventListener('keydown', (event) => {
  const target = event.target;
  const editableInputTypes = new Set(['email', 'number', 'password', 'search', 'tel', 'text', 'url']);
  const editableTarget = (target instanceof HTMLInputElement && editableInputTypes.has(target.type))
    || target instanceof HTMLTextAreaElement
    || target?.isContentEditable;
  const undoShortcut = (event.ctrlKey || event.metaKey)
    && !event.shiftKey
    && event.key.toLowerCase() === 'z';

  if (!undoShortcut || editableTarget) return;

  event.preventDefault();
  brush.undo();
  syncToolbar();
});

canvas.addEventListener('pointerdown', syncToolbar);
canvas.addEventListener('pointermove', syncToolbar);
canvas.addEventListener('pointerup', syncToolbar);
canvas.addEventListener('pointercancel', syncToolbar);
canvas.addEventListener('pointerleave', syncToolbar);

function formatBytes(bytes) {
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;
}

/**
 * Autosave on every change, and show what the drawing costs next to what the
 * old history format (the expanded polyline, a width per point, as JSON) would.
 */
function persist() {
  const bytes = encodeDrawing(brush.snapshot());
  try {
    localStorage.setItem(STORAGE_KEY, bytesToBase64(bytes));
  } catch (err) {
    // Storage can be unavailable or full; the drawing still works.
  }

  const operations = brush.getRenderableOperations();
  if (!operations.length) {
    storageMeter.textContent = '';
    return;
  }
  const polyline = JSON.stringify(operations.map((operation) => operation.points)).length;
  storageMeter.textContent = `${operations.length} strokes · ${formatBytes(bytes.length)}`
    + ` · ${formatBytes(polyline)} as polyline JSON`;
}

function restore() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) brush.load(decodeDrawing(base64ToBytes(saved)));
  } catch (err) {
    storageMeter.textContent = `Could not restore the saved drawing (${err.message})`;
  }
}

saveButton.addEventListener('click', () => {
  const blob = new Blob([encodeDrawing(brush.snapshot())], { type: 'application/octet-stream' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = 'drawing.bcts';
  link.click();
  URL.revokeObjectURL(link.href);
});

openButton.addEventListener('click', () => fileInput.click());

fileInput.addEventListener('change', async () => {
  const [file] = fileInput.files;
  fileInput.value = '';
  if (!file) return;
  try {
    brush.load(decodeDrawing(new Uint8Array(await file.arrayBuffer())));
    syncToolbar();
  } catch (err) {
    storageMeter.textContent = `Could not open ${file.name} (${err.message})`;
  }
});

window.addEventListener('resize', () => brush.resize());

setTool('pen');
restore();
syncToolbar();
