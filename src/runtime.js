import { AnnotationStore, SOURCE, STORAGE_PREFIX, encodePayload, decodeText } from './core.js';

/** Bind public DSH services only. No Lexical internals or send interception. */
export function createRuntime(ctx) {
  const faces = new Map();
  const releases = [];
  const faceFor = sessionId => {
    if (faces.has(sessionId)) return faces.get(sessionId);
    const binding = ctx.sessions.binding(sessionId);
    if (!binding) throw new Error('当前会话尚未准备好。');
    let store, storageError;
    try { store = new AnnotationStore(localStorage, String(sessionId)); }
    catch (error) {
      storageError = error;
      // Keep the host renderable and leave the original stored bytes untouched.
      store = new AnnotationStore({ getItem: () => null, setItem: () => { throw storageError; } }, String(sessionId));
    }
    const input = ctx.conversation.input.for(binding.ctx);
    const listeners = new Set();
    let notice = '';
    const report = error => { if (error instanceof Error) console.error('[dsh-codex-annotations]', error.stack); notice = error instanceof Error ? error.message : String(error); for (const fn of listeners) fn(); };
    const run = fn => { try { return fn(); } catch (error) { report(error); return false; } };
    const editable = () => !['submitting', 'adjudicating'].includes(input.state.getSnapshot().phase);
    const token = () => `@批注-${store.getSnapshot().ref}`;
    const detectOffset = (clip, state) => clip - state.occurrences.filter(o => o.offset < clip).reduce((n, o) => n + o.length - 1, 0);
    const ensure = (force = false) => {
      if (!editable()) throw new Error('输入框正在发送，批注已暂存，稍后可附加。');
      const state = input.state.getSnapshot(), ref = store.getSnapshot().ref;
      if (state.occurrences.some(o => o.source === SOURCE && o.ref === ref)) return true;
      if (!store.selected().length) return false;
      const at = state.draft.indexOf(token());
      if (at < 0 && !force) return false;
      const start = at < 0 ? 0 : detectOffset(at, state);
      const accepted = binding.ctx.bail(binding.ctx, 'slash/input-insert-reference', {
        reference: { source: SOURCE, ref, label: '批注', clipboardText: token() },
        span: { start, end: at < 0 ? start : start + token().length, draftRev: state.draftRev }
      }) === true;
      if (!accepted) throw new Error('原生输入框未接受批注引用，请重试添加批注。');
      return true;
    };
    const detach = () => {
      if (!editable()) throw new Error('请等待当前发送完成后再修改批注。');
      // Delete in reverse order so other native references keep their coordinates.
      for (const own of [...input.state.getSnapshot().occurrences].filter(o => o.source === SOURCE).reverse()) {
        const state = input.state.getSnapshot(), start = detectOffset(own.offset, state);
        binding.ctx.bail(binding.ctx, 'slash/input-insert-text', { text: '', span: { start, end: start + 1, draftRev: state.draftRev } });
      }
    };
    const face = { sessionId: String(sessionId), store, input, editable, run, report,
      notice: { subscribe: fn => { listeners.add(fn); return () => listeners.delete(fn); }, getSnapshot: () => notice },
      dismiss: () => report(''),
      add: selector => run(() => { const note = store.add(selector); ensure(true); return note; }),
      edit: (id, fields) => run(() => {
        if (!editable()) throw new Error('请等待发送完成后再编辑批注。');
        store.edit(id, fields);
        if (fields.selected) ensure(true);
        if (!store.selected().length) detach();
      }),
      remove: id => run(() => { if (!editable()) throw new Error('请等待发送完成后再删除批注。'); store.remove(id); if (!store.selected().length) detach(); }),
      clear: () => run(() => {
        if (!editable()) throw new Error('请等待发送完成后再删除批注。');
        store.clearPending();
        detach();
      }),
      locate: note => {
        window.dispatchEvent(new CustomEvent('dca:locate', { detail: { sessionId: String(sessionId), note } }));
      }
    };
    faces.set(sessionId, face);
    // A persisted native draft stores clipboard text. Restore only our own exact token.
    let repairing = false;
    const repair = () => {
      if (repairing) return;
      repairing = true;
      try { if (input.state.getSnapshot().draft.includes(token())) run(() => ensure()); }
      finally { repairing = false; }
    };
    const chat = ctx.uiConversation.binding(binding).target('chat');
    const inbox = binding.session.projections.faceOf('inbox');
    const reconcile = () => run(() => {
      const accepted = [];
      for (const node of chat.getSnapshot()?.nodes.values() ?? []) {
        if (node.kind !== 'user' && node.kind !== 'steering') continue;
        accepted.push(node.data);
      }
      accepted.push(...(inbox.getSnapshot()?.['next-turn'] ?? []));
      for (const message of accepted) {
        for (const block of message.content ?? []) if (block.type === 'text') {
          for (const payload of decodeText(block.text).payloads) store.acknowledge(payload);
        }
      }
    });
    // DSH publishes from its editor update listener. Insert after that stack has
    // unwound; inserting synchronously there can run without an active editor.
    let disposed = false;
    const offInput = input.state.subscribe(() => queueMicrotask(() => { if (!disposed) repair(); }));
    const offChat = chat.subscribe(() => queueMicrotask(() => { if (!disposed) reconcile(); }));
    const offInbox = inbox.subscribe(() => queueMicrotask(() => { if (!disposed) reconcile(); }));
    releases.push(offInput, offChat, offInbox);
    releases.push(() => { disposed = true; });
    binding.ctx.effect(() => () => { disposed = true; offInput(); offChat(); offInbox(); faces.delete(sessionId); });
    if (storageError) report(storageError);
    queueMicrotask(() => {
      reconcile();
      // Preserve pending notes from the old detached UI without exposing a
      // separate reattach control. Current removal clears pending notes.
      if (store.selected().length) run(() => ensure(true));
      repair();
    });
    return face;
  };
  const source = {
    name: SOURCE, trigger: '@', label: '原文批注', candidates: async () => [],
    onPick: () => { throw new Error('请从助手回复选择原文添加批注。'); },
    codec: { serialize: async (ref, signal) => {
      if (signal.aborted) throw new Error('发送已取消，批注保留。');
      const face = [...faces.values()].find(f => f.store.getSnapshot().ref === ref);
      if (!face) throw new Error('找不到批注引用所属会话，请重新选择原文添加批注。');
      return encodePayload(face.store.prepare(ref));
    } },
    openReference: (session, reference) => {
      const face = faces.get(session.sessionId);
      if (!face || reference.ref !== face.store.getSnapshot().ref) return false;
      window.dispatchEvent(new CustomEvent('dca:open-list', { detail: face.sessionId }));
      return true;
    }
  };
  const storageChanged = event => {
    if (!event.key?.startsWith(STORAGE_PREFIX)) return;
    for (const face of faces.values()) if (face.store.key === event.key) face.run(() => face.store.reload());
  };
  window.addEventListener('storage', storageChanged);
  return { faceFor, source, dispose: () => {
    for (const release of releases.reverse()) release();
    window.removeEventListener('storage', storageChanged);
    faces.clear();
  } };
}
