import test from 'node:test';
import assert from 'node:assert/strict';
import { AnnotationStore, encodePayload } from '../src/core.js';
import { citationNumber, resolveCitation } from '../src/citations.js';

const storage = () => { const data = new Map(); return { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) }; };
const selector = { nodeKey: 'source', quote: '完整原文', prefix: '', suffix: '', start: 0, end: 4 };
const userNode = (payload, key = payload.id) => ({ key, kind: 'user', data: { content: [{ type: 'text', text: encodePayload(payload) }] } });
const reply = key => ({ key, kind: 'assistant-step', data: {} });
const timeline = nodes => nodes.map((node, anchorSeq) => ({ ...node, anchorSeq })).reverse();

test('引用只接受完整的内部地址和正整数编号', () => {
  assert.equal(citationNumber('https://dsh-annotations.invalid/12'), 12);
  for (const href of ['https://dsh-annotations.invalid/0', 'https://dsh-annotations.invalid/01',
    'https://dsh-annotations.invalid/1?x=2', 'https://dsh-annotations.invalid.evil/1',
    'http://dsh-annotations.invalid/1', 'https://dsh-annotations.invalid/9007199254740992', '批注 1'])
    assert.equal(citationNumber(href), null, href);
});

test('多轮回复按会话中实际编号回跳，不把本轮序号当作全局编号', () => {
  const store = new AnnotationStore(storage(), 'a');
  const first = store.add(selector); store.edit(first.id, { comment: '评论一' });
  const batch1 = store.prepare(store.getSnapshot().ref); store.acknowledge(batch1);
  store.add({ ...selector, nodeKey: 'source2', quote: '另一处' });
  const batch2 = store.prepare(store.getSnapshot().ref);
  const nodes = timeline([reply('source'), userNode(batch1), reply('answer1'), userNode(batch2), reply('answer2')]);
  assert.equal(resolveCitation(nodes, 'answer1', 1).comment, '评论一');
  assert.equal(resolveCitation(nodes, 'answer1', 2), null, '不能链接到未来才发送的批注');
  assert.equal(resolveCitation(nodes, 'answer2', 1).nodeKey, 'source');
  assert.equal(resolveCitation(nodes, 'answer2', 2).nodeKey, 'source2');
  assert.equal(resolveCitation(nodes, 'answer2', 99), null);
  assert.equal(resolveCitation(timeline([reply('other-session')]), 'other-session', 1), null);
  assert.equal(resolveCitation(nodes, 'missing-answer', 1), null);
  assert.equal(resolveCitation(nodes, 'answer2', 1).status, 'sent');
});

test('历史记录恢复不依赖本机缓存，编号重复且身份不同时拒绝误跳', () => {
  const store = new AnnotationStore(storage(), 'a'); store.add(selector);
  const batch = store.prepare(store.getSnapshot().ref);
  const nodes = timeline([reply('source'), userNode(batch), reply('answer')]);
  assert.equal(resolveCitation(JSON.parse(JSON.stringify(nodes)), 'answer', 1).quote, '完整原文');
  const collision = { ...batch, id: 'collision', annotations: batch.annotations.map(note => ({ ...note, id: 'different' })) };
  assert.equal(resolveCitation(timeline([userNode(batch), userNode(collision), reply('answer')]), 'answer', 1), null);
  assert.equal(resolveCitation(timeline([reply('spoof'), reply('answer')]), 'answer', 1), null);
  const fresh = new AnnotationStore(storage(), 'a');
  assert.equal(fresh.add(selector, [1, 2]).number, 3, '清空缓存后新增批注仍应避开历史编号');
});
