import test from 'node:test';
import assert from 'node:assert/strict';
import { decorateSlot } from '../src/slot-decoration.js';

function fixture() {
  const native = props => props.renderSlot('native.child', props.owner);
  const entry = { component: native, options: { key: 'assistant-step' },
    children: { 'native.child': { kind: 'single', scope: 'session' } },
    inject: () => ({ original: true }), store: {}, locale: 'native' };
  let entries = [entry], version = 0, active = true;
  const slots = {
    entries: () => entries,
    register(options, component) {
      assert.ok(active, '卸载阶段不能再创建插槽注册');
      assert.equal(options.children, undefined, '原生子插槽只有一个声明者');
      const extra = { options, component };
      entries = [...entries, extra]; version++;
      return () => { entries = entries.filter(item => item !== extra); version++; };
    }
  };
  return { ctx: { slots, effect: setup => setup() }, entry, native, version: () => version, stop: () => { active = false; },
    render: () => entry.component({ owner: '完整正文', renderSlot: (key, owner) => `${key}:${owner}` }) };
}

for (const order of [[0, 1], [1, 0]]) test(`叠加装饰后按 ${order.join('、')} 卸载，保留宿主渲染能力与另一个插件`, () => {
  const f = fixture(), original = { ...f.entry };
  const releases = ['批注', '渲染'].map(name => decorateSlot(f.ctx, 'native', f.entry, (Inner, props, active) => active ? `${name}(${Inner(props)})` : Inner(props)));
  assert.equal(f.render(), '渲染(批注(native.child:完整正文))');
  assert.equal(f.ctx.slots.entries('native')[0], f.entry, '渲染与子插槽始终由原生注册承接');
  assert.ok(f.ctx.slots.entries('native').slice(1).every(item => item.options.priority > 0));
  for (const key of ['children', 'inject', 'store', 'locale']) assert.equal(f.entry[key], original[key]);
  releases[order[0]]();
  assert.equal(f.render(), order[0] === 0 ? '渲染(native.child:完整正文)' : '批注(native.child:完整正文)');
  releases[order[1]](); releases[order[0]]();
  assert.equal(f.entry.component, f.native);
  assert.equal(f.render(), 'native.child:完整正文');
  assert.deepEqual(f.ctx.slots.entries('native'), [f.entry], '停用后清理全部通知条目');
  assert.equal(f.version(), 4, '安装与卸载均通知已挂载插槽，重复卸载不改状态');
});

test('停用后仍被 React 保留的组件直接交还宿主，不读取已停止的插件', () => {
  const f = fixture();
  let stopped = false;
  const release = decorateSlot(f.ctx, 'native', f.entry, (Inner, props, active) => {
    if (active) assert.equal(stopped, false);
    return Inner(props);
  });
  const retained = f.entry.component;
  stopped = true; f.stop(); release();
  assert.equal(retained({ owner: '保留视图', renderSlot: (_, owner) => owner }), '保留视图');
});
