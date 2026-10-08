/**
 * Just enough DOM to drive BezierCanvasBrush in Node, plus a deterministic
 * mouse: a seeded wander at roughly 60 Hz, the shape real pointer input has.
 */
export function fakeCanvas({ width = 800, height = 500 } = {}) {
  const noop = () => {};
  const ctx = new Proxy({}, {
    get: (target, key) => (key in target ? target[key] : noop),
    set: (target, key, value) => {
      target[key] = value;
      return true;
    },
  });
  return {
    width: 0,
    height: 0,
    ownerDocument: { defaultView: { devicePixelRatio: 1 } },
    getBoundingClientRect: () => ({ left: 0, top: 0, width, height }),
    getContext: () => ctx,
    addEventListener: noop,
    removeEventListener: noop,
    setPointerCapture: noop,
    releasePointerCapture: noop,
  };
}

function rng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

/** Pointer events for one stroke: down, a curvy run of moves, up. */
export function strokeEvents(seed, { moves = 80 } = {}) {
  const random = rng(seed);
  let x = 100 + random() * 500;
  let y = 80 + random() * 300;
  let heading = random() * Math.PI * 2;
  let time = 1000 + random() * 5000;
  const event = () => ({
    button: 0,
    pointerId: 1,
    clientX: x,
    clientY: y,
    timeStamp: time,
    preventDefault() {},
  });

  const events = [{ type: 'start', event: event() }];
  for (let i = 0; i < moves; i += 1) {
    heading += (random() - 0.5) * 0.6;
    const speed = 1 + random() * 9;
    x += Math.cos(heading) * speed;
    y += Math.sin(heading) * speed;
    time += 14 + random() * 5;
    events.push({ type: 'move', event: event() });
  }
  events.push({ type: 'end', event: event() });
  return events;
}

export function draw(brush, events) {
  for (const { type, event } of events) brush[type](event);
}
