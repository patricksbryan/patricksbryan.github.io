// Chip's Quest engine: pure, deterministic tile logic. One call to step() = one 100ms tick.
// Shared by the game page and the level solver (node), so it touches no DOM.
(function (root) {
  const DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
  const LEFT = { up: 'left', left: 'down', down: 'right', right: 'up' };
  const RIGHT = { up: 'right', right: 'down', down: 'left', left: 'up' };
  const BACK = { up: 'down', down: 'up', left: 'right', right: 'left' };
  const FORCE = { '<': 'left', '>': 'right', '^': 'up', 'v': 'down' };
  const DOORS = { R: 'r', B: 'b', Y: 'y', G: 'g' };
  const BOOTS = { f: 1, h: 1, k: 1, x: 1 };
  const MONSTERS = { '1': ['bug', 'up'], '2': ['ball', 'right'], '3': ['ball', 'down'], 't': ['teeth', 'down'] };

  function load(level) {
    const rows = level.map;
    const h = rows.length, w = Math.max(...rows.map(r => r.length));
    const t = [], blocks = new Map(), mons = [];
    let chips = 0, p = null;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let c = rows[y][x] || '#';
        if (c === 'P') { p = { x, y, dir: 'down', fx: x, fy: y, mt: 0, dur: 1, next: 0, slide: null }; c = '.'; }
        else if (c === '$') { blocks.set(y * w + x, { fx: x, fy: y, mt: 0 }); c = '.'; }
        else if (MONSTERS[c]) { const [kind, dir] = MONSTERS[c]; mons.push({ kind, dir, x, y, fx: x, fy: y, mt: 0, dur: 2 }); c = '.'; }
        else if (c === 'c') chips++;
        else if (c === ' ') c = '.';
        t.push(c);
      }
    }
    return {
      w, h, t, blocks, mons, p,
      chipsLeft: chips, chipsTotal: chips,
      keys: { r: 0, b: 0, y: 0, g: 0 },
      boots: { f: false, h: false, k: false, x: false },
      tick: 0, limit: level.time || 0, timeLeft: level.time || 0,
      status: 'play', msg: '', events: [], consumed: false,
    };
  }

  function clone(s) {
    const blocks = new Map();
    s.blocks.forEach((v, k) => blocks.set(k, { ...v }));
    return {
      ...s, t: s.t.slice(), blocks, mons: s.mons.map(m => ({ ...m })), p: { ...s.p },
      keys: { ...s.keys }, boots: { ...s.boots }, events: [],
    };
  }

  const inb = (s, x, y) => x >= 0 && y >= 0 && x < s.w && y < s.h;
  const monAt = (s, x, y) => s.mons.find(m => m.x === x && m.y === y);

  function die(s, msg) {
    if (s.status !== 'play') return;
    s.status = 'dead'; s.msg = msg; s.events.push('die');
  }

  function pushBlock(s, x, y, dx, dy) {
    const bx = x + dx, by = y + dy;
    if (!inb(s, bx, by)) return false;
    const bi = by * s.w + bx, c = s.t[bi];
    if (s.blocks.has(bi) || monAt(s, bx, by)) return false;
    if (c !== '.' && c !== '~') return false;
    s.blocks.delete(y * s.w + x);
    if (c === '~') { s.t[bi] = '%'; s.events.push('splash'); }
    else s.blocks.set(bi, { fx: x, fy: y, mt: s.tick });
    s.events.push('push');
    return true;
  }

  function tryMovePlayer(s, dir, dur) {
    const p = s.p, [dx, dy] = DIRS[dir], nx = p.x + dx, ny = p.y + dy;
    p.dir = dir;
    if (!inb(s, nx, ny)) return false;
    const i = ny * s.w + nx, c = s.t[i];
    if (c === '#') return false;
    if (DOORS[c] && !s.keys[DOORS[c]]) return false;
    if (c === 'S' && s.chipsLeft > 0) return false;
    if (s.blocks.has(i) && !pushBlock(s, nx, ny, dx, dy)) return false;
    if (DOORS[c]) { if (c !== 'G') s.keys[DOORS[c]]--; s.t[i] = '.'; s.events.push('door'); }
    if (c === 'S') { s.t[i] = '.'; s.events.push('door'); }
    p.fx = p.x; p.fy = p.y; p.mt = s.tick; p.dur = dur; p.x = nx; p.y = ny;
    enter(s);
    return true;
  }

  function enter(s) {
    const p = s.p, i = p.y * s.w + p.x, c = s.t[i];
    if (c === 'c') { s.chipsLeft--; s.t[i] = '.'; s.events.push('chip'); }
    else if (c in s.keys) { s.keys[c]++; s.t[i] = '.'; s.events.push('item'); }
    else if (BOOTS[c]) { s.boots[c] = true; s.t[i] = '.'; s.events.push('item'); }
    else if (c === '%') s.t[i] = '.';
    else if (c === '~' && !s.boots.f) die(s, 'You sank like a rock! Flippers would keep you afloat.');
    else if (c === '&' && !s.boots.h) die(s, 'Ouch, hot! Fire boots let you walk on flames.');
    else if (c === 'E') { s.status = 'won'; s.events.push('win'); }
    p.slide = (c === '_' && !s.boots.k) ? p.dir : null;
    if (monAt(s, p.x, p.y)) die(s, monsterMsg(monAt(s, p.x, p.y)));
  }

  function monsterMsg(m) {
    return { bug: 'A bug bit you!', ball: 'Flattened by a bouncing ball!', teeth: 'Chomped by the teeth!' }[m.kind];
  }

  function monCan(s, m, dir) {
    const [dx, dy] = DIRS[dir], nx = m.x + dx, ny = m.y + dy;
    if (!inb(s, nx, ny)) return false;
    const i = ny * s.w + nx;
    return s.t[i] === '.' && !s.blocks.has(i) && !monAt(s, nx, ny);
  }

  function moveMonsters(s) {
    for (const m of s.mons) {
      let choices;
      if (m.kind === 'ball') choices = [m.dir, BACK[m.dir]];
      else if (m.kind === 'bug') choices = [LEFT[m.dir], m.dir, RIGHT[m.dir], BACK[m.dir]];
      else {
        if (s.tick % 4) continue;
        const dx = s.p.x - m.x, dy = s.p.y - m.y;
        const hz = dx < 0 ? 'left' : 'right', vt = dy < 0 ? 'up' : 'down';
        choices = Math.abs(dx) > Math.abs(dy) ? [hz, dy ? vt : null] : [dy ? vt : hz, dx ? hz : null];
        choices = choices.filter(Boolean);
      }
      for (const d of choices) {
        m.dir = d;
        if (monCan(s, m, d)) {
          const [dx, dy] = DIRS[d];
          m.fx = m.x; m.fy = m.y; m.mt = s.tick; m.dur = m.kind === 'teeth' ? 4 : 2;
          m.x += dx; m.y += dy;
          break;
        }
      }
      if (m.x === s.p.x && m.y === s.p.y) die(s, monsterMsg(m));
    }
  }

  // input: 'up' | 'down' | 'left' | 'right' | null. Sets s.consumed when the input was used.
  function step(s, input) {
    s.events = []; s.consumed = false;
    if (s.status !== 'play') return s;
    s.tick++;
    const p = s.p;
    const here = s.t[p.y * s.w + p.x];
    if (here === '_' && !s.boots.k && p.slide) {
      if (!tryMovePlayer(s, p.slide, 1)) {
        p.slide = BACK[p.slide];
        if (!tryMovePlayer(s, p.slide, 1)) p.slide = BACK[p.slide];
        else s.events.push('bump');
      }
    } else {
      let moved = false;
      if (input && s.tick >= p.next) {
        s.consumed = true;
        p.next = s.tick + 2;
        moved = tryMovePlayer(s, input, 2);
        if (!moved) s.events.push('bump');
      }
      const f = FORCE[s.t[p.y * s.w + p.x]];
      if (!moved && f && !s.boots.x && s.status === 'play') tryMovePlayer(s, f, 1);
    }
    if (s.status === 'play' && s.tick % 2 === 0) moveMonsters(s);
    if (s.status === 'play' && s.limit && s.tick % 10 === 0) {
      s.timeLeft--;
      if (s.timeLeft <= 0) die(s, 'Out of time!');
    }
    return s;
  }

  // Whether the player is at a point where a new input will be accepted (used by the solver).
  function ready(s) {
    const p = s.p;
    const sliding = s.t[p.y * s.w + p.x] === '_' && !s.boots.k && p.slide;
    return !sliding && s.tick + 1 >= p.next;
  }

  const api = { load, clone, step, ready, DIRS, FORCE };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ChipEngine = api;
})(this);
