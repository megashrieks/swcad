import { describe, expect, it } from 'vitest';
import { compileScript, callHook } from './sandbox';
import { svgBuilder, parseSvg, sanitize, serialize, findById, elementPoint } from './svg';
import { DependencyTracker, depKeys } from './tracker';

const host = () => ({ api: { svg: svgBuilder }, onLog: () => {} });

describe('sandbox', () => {
  it('registers a module through defineComponent', () => {
    const compiled = compileScript('defineComponent({ render: function () { return 42; } });', host());
    expect(compiled.error).toBeNull();
    expect(compiled.module.render?.({})).toBe(42);
  });

  it('reports scripts that never register', () => {
    const compiled = compileScript('var x = 1;', host());
    expect(compiled.error).toMatch(/defineComponent/);
  });

  it('captures syntax errors instead of throwing', () => {
    const compiled = compileScript('function ( {', host());
    expect(compiled.error).toBeTruthy();
  });

  it('blocks access to host globals', () => {
    for (const forbidden of ['window', 'document', 'fetch', 'globalThis', 'localStorage', 'process']) {
      const compiled = compileScript(
        `defineComponent({ render: function () { return ${forbidden}; } });`,
        host(),
      );
      expect(compiled.error).toBeNull();
      const result = callHook(compiled.module.render, {}, 50);
      expect(result.error).toMatch(/is not available/);
    }
  });

  it('blocks indirect escapes through constructors', () => {
    const compiled = compileScript(
      'defineComponent({ render: function () { return this.constructor.constructor("return 1")(); } });',
      host(),
    );
    const result = callHook(compiled.module.render, undefined, 50);
    expect(result.error).toBeTruthy();
  });

  it('refuses assignment to unknown identifiers', () => {
    const compiled = compileScript('leaked = 1; defineComponent({});', host());
    expect(compiled.error).toMatch(/cannot assign/);
  });

  it('allows safe globals and local declarations', () => {
    const compiled = compileScript(
      'var factor = 2; function twice(n) { return n * factor; } defineComponent({ render: function () { return Math.max(twice(3), JSON.parse("1")); } });',
      host(),
    );
    expect(compiled.error).toBeNull();
    expect(callHook(compiled.module.render, {}, 50).value).toBe(6);
  });

  it('exposes Date for formatting timestamps supplied by the host', () => {
    const compiled = compileScript(
      'defineComponent({ style: function (ctx) { return new Date(ctx.env.now).getUTCDay(); } });',
      host(),
    );
    expect(compiled.error).toBeNull();
    // 2024-01-07T00:00:00Z is a Sunday.
    expect(callHook(compiled.module.style, { env: { now: Date.UTC(2024, 0, 7) } }, 50).value).toBe(0);
  });

  it('captures runtime errors from hooks', () => {
    const compiled = compileScript(
      'defineComponent({ render: function () { throw new Error("boom"); } });',
      host(),
    );
    expect(callHook(compiled.module.render, {}, 50).error).toBe('boom');
  });
});

describe('svg', () => {
  it('parses attributes, nesting and self-closing tags', () => {
    const nodes = parseSvg('<g id="root"><rect id="a" x="1" y="2" width="3" height="4" /><text id="t">hi</text></g>');
    expect(nodes).toHaveLength(1);
    expect(nodes[0].children).toHaveLength(2);
    expect(nodes[0].children[0].attrs.width).toBe('3');
    expect(nodes[0].children[1].text).toBe('hi');
  });

  it('strips unknown tags and event handlers', () => {
    const clean = sanitize(parseSvg('<g><script>alert(1)</script><rect onclick="x()" fill="red" /></g>'));
    const out = serialize(clean);
    expect(out).not.toContain('script');
    expect(out).not.toContain('onclick');
    expect(out).toContain('fill="red"');
  });

  it('keeps data-swcad attributes', () => {
    const clean = sanitize(parseSvg('<path d="M0 0" data-swcad-route="[]" />'));
    expect(clean[0].attrs['data-swcad-route']).toBe('[]');
  });

  it('finds elements by id and derives their anchor point', () => {
    const nodes = parseSvg('<g><circle id="p" cx="10" cy="20" r="3" /><rect id="b" x="0" y="0" width="40" height="20" /></g>');
    expect(elementPoint(findById(nodes, 'p')!)).toEqual({ x: 10, y: 20 });
    expect(elementPoint(findById(nodes, 'b')!)).toEqual({ x: 20, y: 10 });
  });
});

describe('DependencyTracker', () => {
  it('maps changed keys back to the consumers that read them', () => {
    const tracker = new DependencyTracker();
    tracker.track('arrow1', () => {
      tracker.read(depKeys.node('box1'));
      tracker.read(depKeys.bucket('0,0'));
    });
    tracker.track('arrow2', () => tracker.read(depKeys.node('box2')));

    expect([...tracker.consumersOf([depKeys.node('box1')])]).toEqual(['arrow1']);
    expect([...tracker.consumersOf([depKeys.bucket('0,0')])]).toEqual(['arrow1']);
    expect([...tracker.consumersOf([depKeys.node('box2')])]).toEqual(['arrow2']);
    expect([...tracker.consumersOf([depKeys.node('other')])]).toEqual([]);
  });

  it('drops dependencies that are no longer read', () => {
    const tracker = new DependencyTracker();
    tracker.track('a', () => tracker.read(depKeys.node('n1')));
    tracker.track('a', () => tracker.read(depKeys.node('n2')));

    expect([...tracker.consumersOf([depKeys.node('n1')])]).toEqual([]);
    expect([...tracker.consumersOf([depKeys.node('n2')])]).toEqual(['a']);
  });

  it('always recomputes consumers that read the whole graph', () => {
    const tracker = new DependencyTracker();
    tracker.track('global', () => tracker.read(depKeys.all()));
    expect([...tracker.consumersOf([depKeys.node('anything')])]).toEqual(['global']);
  });
});
