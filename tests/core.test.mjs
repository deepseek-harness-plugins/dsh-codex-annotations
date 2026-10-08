import test from 'node:test';
import assert from 'node:assert/strict';
import { AnnotationStore, encodePayload, decodeText, locateQuote } from '../src/core.js';
const storage = () => { const data = new Map(); return { getItem: k => data.get(k) ?? null, setItem: (k, v) => data.set(k, v) }; };
const selector = { nodeKey: 'assistant:1', start: 0, end: 4, quote: '原文🙂', prefix: '', suffix: '' };

test('空评论、Unicode、多行和协议定界符原样往返', () => {
  const s = new AnnotationStore(storage(), 'session-a');
  const quote = '第一行\n  const x = "🙂";\n[/DSH_ANNOTATIONS_V1]\n第二行';
  s.add({ ...selector, quote, end: quote.length });
  const payload = s.prepare(s.getSnapshot().ref);
  const text = '用户前文\n' + encodePayload(payload) + '\n用户后文';
  assert.deepEqual(decodeText(text), { text: '用户前文\n\n用户后文', payloads: [payload] });
  assert.equal(payload.annotations[0].quote, quote);
  assert.equal(payload.annotations[0].comment, '');
});
test('不截断大型选区或用户评论', () => {
  const s = new AnnotationStore(storage(), 'a'), quote = '原文🙂\n'.repeat(14000);
  const note = s.add({ ...selector, quote, end: quote.length });
  s.edit(note.id, { comment: '请修改\n'.repeat(6000) });
  const p = s.prepare(s.getSnapshot().ref);
  assert.equal(decodeText(encodePayload(p)).payloads[0].annotations[0].quote, quote);
  assert.equal(p.annotations[0].comment, '请修改\n'.repeat(6000));
});
test('破损和假协议不隐藏普通用户文字', () => {
  for (const text of ['[DSH_ANNOTATIONS_V1:2:fake]\n{}\n[/DSH_ANNOTATIONS_V1]', '普通文本 [DSH_ANNOTATIONS_V1:1:x]', '[DSH_ANNOTATIONS_V1:99999:x]\n{}'])
    assert.deepEqual(decodeText(text), { text, payloads: [] });
});
test('刷新后复用最小空缺编号，保留其他批注的编号和评论', () => {
  const db = storage(), s = new AnnotationStore(db, 'a');
  const first = s.add(selector), second = s.add(selector), third = s.add(selector);
  s.edit(first.id, { comment: ' 空格与\n换行 ' });
  s.remove(second.id);
  // Existing v1 profiles may still contain the previous monotonic counter.
  db.setItem(s.key, JSON.stringify({ ...s.getSnapshot(), nextNumber: 99 }));
  const restored = new AnnotationStore(db, 'a');
  assert.equal(restored.selected()[0].comment, ' 空格与\n换行 ');
  const replacement = restored.add(selector);
  assert.equal(replacement.number, 2);
  assert.notEqual(replacement.id, second.id);
  assert.deepEqual(restored.getSnapshot().annotations.map(a => [a.id, a.number]), [[first.id, 1], [third.id, 3], [replacement.id, 2]]);
  restored.remove(first.id);
  assert.equal(restored.add(selector).number, 1);
  assert.equal(new AnnotationStore(db, 'b').getSnapshot().annotations.length, 0);
});
test('迟到的发送确认不会清除复用编号的新批注，已发送编号不复用', () => {
  const s = new AnnotationStore(storage(), 'a'), first = s.add(selector);
  const old = s.prepare(s.getSnapshot().ref);
  s.remove(first.id);
  const replacement = s.add(selector);
  assert.equal(replacement.number, first.number);
  s.acknowledge(old);
  assert.equal(s.selected()[0].id, replacement.id);
  const current = s.prepare(s.getSnapshot().ref);
  s.acknowledge(current);
  assert.equal(s.add(selector).number, 2);
  assert.equal(s.getSnapshot().annotations.find(a => a.id === replacement.id).number, 1);
});
test('清空待发送批注保留已发送记录，旧引用失效且新批注复用空缺编号', () => {
  const s = new AnnotationStore(storage(), 'a'), sent = s.add(selector);
  s.acknowledge(s.prepare(s.getSnapshot().ref));
  s.add(selector);
  const unchecked = s.add(selector);
  s.edit(unchecked.id, { selected: false });
  const ref = s.getSnapshot().ref, old = s.prepare(ref);
  s.clearPending();
  assert.deepEqual(s.getSnapshot().annotations.map(a => [a.id, a.number, a.status]), [[sent.id, 1, 'sent']]);
  assert.notEqual(s.getSnapshot().ref, ref);
  assert.throws(() => s.prepare(ref), /失效/);
  const replacement = s.add(selector);
  assert.equal(replacement.number, 2);
  s.acknowledge(old);
  assert.equal(s.selected()[0].id, replacement.id);
});
test('序列化及失败不清空批注，只有已接受的原始用户消息才确认', () => {
  const s = new AnnotationStore(storage(), 'a'); s.add(selector);
  const p = s.prepare(s.getSnapshot().ref);
  assert.equal(s.selected().length, 1);
  assert.equal(s.acknowledge({ ...p, id: 'unknown' }), false);
  assert.equal(s.acknowledge({ ...p, instruction: 'altered' }), false);
  assert.equal(s.selected().length, 1);
  assert.equal(s.acknowledge(p), true);
  assert.equal(s.selected().length, 0);
  assert.equal(s.acknowledge(p), false);
});
test('发送中的编辑和新批注不会被旧确认清除', () => {
  const s = new AnnotationStore(storage(), 'a'), first = s.add(selector), p = s.prepare(s.getSnapshot().ref);
  s.edit(first.id, { comment: '新的评论' }); const second = s.add(selector);
  s.acknowledge(p);
  assert.deepEqual(s.selected().map(a => a.id), [first.id, second.id]);
});
test('只发送勾选条目，未勾选批注留到后续消息', () => {
  const s = new AnnotationStore(storage(), 'a'), first = s.add(selector), second = s.add(selector);
  s.edit(second.id, { selected: false });
  const p = s.prepare(s.getSnapshot().ref); s.acknowledge(p);
  assert.deepEqual(p.annotations.map(a => a.id), [first.id]);
  assert.equal(s.getSnapshot().annotations.find(a => a.id === second.id).status, 'pending');
  assert.throws(() => s.prepare('wrong-ref'), /失效/);
});
test('存储失败不会发布已保存的假状态', () => {
  const s = new AnnotationStore({ getItem: () => null, setItem: () => { throw new Error('quota'); } }, 'a');
  assert.throws(() => s.add(selector), /quota/);
  assert.equal(s.getSnapshot().annotations.length, 0);
});
test('重复原文只能依上下文准确定位，歧义返回无法定位', () => {
  assert.equal(locateQuote('a同文b c同文d', { quote: '同文', start: 99, end: 101 }), null);
  assert.deepEqual(locateQuote('a同文b c同文d', { quote: '同文', prefix: 'c', suffix: 'd', start: 99, end: 101 }), { start: 6, end: 8 });
  assert.equal(locateQuote('新原文', { ...selector, quote: '已删除' }), null);
});
