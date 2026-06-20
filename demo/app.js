import { BezierCanvasBrush, BezierCursorTail } from '../src/bezier-cursor-tail.js';

const canvas = document.querySelector('[data-role="canvas"]');
const colorInput = document.querySelector('[data-role="color"]');
const sizeInput = document.querySelector('[data-role="size"]');
const sizeValue = document.querySelector('[data-role="size-value"]');
const toolButtons = Array.from(document.querySelectorAll('[data-tool]'));
const undoButton = document.querySelector('[data-role="undo"]');
const redoButton = document.querySelector('[data-role="redo"]');
const clearButton = document.querySelector('[data-role="clear"]');
const tailToggle = document.querySelector('[data-role="tail-toggle"]');

const brush = new BezierCanvasBrush(canvas, {
  color: colorInput.value,
  size: Number(sizeInput.value),
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

window.addEventListener('resize', () => brush.resize());

setTool('pen');
syncToolbar();
