import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

class FakeClassList {
  constructor() {
    this.values = new Set();
  }
  add(name) {
    this.values.add(name);
  }
  remove(name) {
    this.values.delete(name);
  }
  contains(name) {
    return this.values.has(name);
  }
  toggle(name, force) {
    if (force === undefined ? !this.values.has(name) : force) {
      this.values.add(name);
      return true;
    }
    this.values.delete(name);
    return false;
  }
}

class FakeStyle {
  constructor() {
    this.props = Object.create(null);
  }
  setProperty(name, value) {
    this.props[name] = value;
  }
}

class FakeElement {
  constructor(id = '', tagName = 'div') {
    this.id = id;
    this.tagName = tagName;
    this.children = [];
    this.dataset = Object.create(null);
    this.style = new FakeStyle();
    this.classList = new FakeClassList();
    this.clientWidth = id === 'viewport' ? 390 : 0;
    this.clientHeight = id === 'viewport' ? 844 : 0;
    this._textContent = '';
    this.innerHTML = '';
  }
  appendChild(child) {
    if (child && child.isFragment) {
      for (let i = 0; i < child.children.length; i++) this.children.push(child.children[i]);
    } else {
      this.children.push(child);
    }
    return child;
  }
  addEventListener() {}
  removeAttribute(name) {
    if (name === 'data-x') delete this.dataset.x;
    else if (name === 'data-y') delete this.dataset.y;
    else if (name === 'data-t') delete this.dataset.t;
    else if (name === 'data-view') delete this.dataset.view;
    else delete this[name];
  }
  setPointerCapture() {}
  getBoundingClientRect() {
    return {
      left: 0,
      top: 0,
      right: this.clientWidth,
      bottom: this.clientHeight,
      width: this.clientWidth,
      height: this.clientHeight,
    };
  }
  set textContent(value) {
    this._textContent = String(value);
    if (value === '') this.children.length = 0;
  }
  get textContent() {
    return this._textContent;
  }
}

function createHarnessContext(options = {}) {
  const elements = new Map();
  const getElement = id => {
    let element = elements.get(id);
    if (!element) {
      element = new FakeElement(id);
      if (id === 'viewport') {
        element.clientWidth = options.viewportWidth || 390;
        element.clientHeight = options.viewportHeight || 844;
      }
      elements.set(id, element);
    }
    return element;
  };

  const document = {
    body: new FakeElement('body', 'body'),
    getElementById: getElement,
    createElement: tagName => new FakeElement('', tagName),
    createDocumentFragment() {
      const fragment = new FakeElement('', '#fragment');
      fragment.isFragment = true;
      return fragment;
    },
  };

  const context = {
    console,
    document,
    navigator: { userAgent: 'lor-sim-harness', userAgentData: { mobile: false } },
    setTimeout,
    clearTimeout,
    requestAnimationFrame: callback => setTimeout(callback, 0),
  };
  context.window = context;
  context.window.matchMedia = () => ({ matches: false });
  context.window.addEventListener = () => {};
  context.window.getSelection = () => ({ removeAllRanges() {} });
  if (options.locationHref) {
    const url = new URL(options.locationHref);
    context.URL = URL;
    context.URLSearchParams = URLSearchParams;
    context.location = { href: url.href, search: url.search, hash: url.hash };
    context.history = { replaceState(_data, _title, path) {
      const next = new URL(path, context.location.href);
      context.location.href = next.href;
      context.location.search = next.search;
      context.location.hash = next.hash;
    } };
  }
  return context;
}

export function loadSimulationApi(options = {}) {
  const html = fs.readFileSync(path.join(rootDir, 'index.html'), 'utf8');
  const match = html.match(/<script>([\s\S]*)<\/script>/);
  if (!match) throw new Error('Could not find inline script in index.html');
  const context = vm.createContext(createHarnessContext(options));
  const source = options.context ? match[1].replace(/\n\}\)\(\);\s*$/, `
  window.__lorDebug = { get game() { return game; }, get map() { return map; }, cols: COLS, rows: ROWS,
    makeWorldCaches, makePathScratch, canFoundVillageAt, foundVillageAt,
    spawnVillageCart, findPath, computeTurnPlan, animateTurn, tickVillages, economyTick, updateVisibility, portSeaRoute,
    stewardFoundVillage, stewardUpgradeVillages, runSteward, destroyVillage };
})();`) : match[1];
  vm.runInContext(source, context, { filename: 'index.html' });
  if (!context.window.__lorTest) throw new Error('window.__lorTest was not exposed');
  if (options.context) return context; // focused simulation checks may inspect internals in the same VM
  return context.window.__lorTest;
}
