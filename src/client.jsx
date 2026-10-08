import React, { useState, useEffect, useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { createRuntime } from './runtime.js';
import { decodeText } from './core.js';
import { capture, restoreRange } from './ranges.js';
import css from './styles.css';

export const inject = ['slots', 'sessions', 'conversation', 'uiConversation', 'inputTriggers'];
const snapshot = store => useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
const icon = (type) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{type === 'check' ? <path d="m5 12 4 4L19 6"/> : type === 'edit' ? <path d="m15 4 5 5M4 20l5-1L20 8a3.5 3.5 0 0 0-5-5L4 14l-1 7Z"/> : type === 'delete' ? <><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/></> : type === 'comment' ? <><path d="M20 15a3 3 0 0 1-3 3H9l-4 3v-3a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3Z"/><path d="M7 8h8M7 12h5"/></> : type === 'attach' ? <path d="m8 12 6-6a4 4 0 0 1 6 6L9 23a6 6 0 0 1-8-8L13 3"/> : <path d="m6 6 12 12M18 6 6 18"/>}</svg>;

function Float({ anchor, gap = 6, inset = 0, children, className = '', onDismiss }) {
  const root = useRef(null); const [position, setPosition] = useState({ left: 12, top: 12 });
  useLayoutEffect(() => {
    const update = () => {
      const rect = anchor(), el = root.current;
      if (!rect || !el) { onDismiss?.(); return; }
      const vw = window.innerWidth, vh = window.innerHeight;
      const left = Math.max(12, Math.min(rect.left + inset, vw - el.offsetWidth - 12));
      let top = rect.top - el.offsetHeight - gap;
      if (top < 12) top = rect.bottom + gap;
      setPosition({ left, top: Math.max(12, Math.min(top, vh - el.offsetHeight - 12)) });
    };
    update(); const observer = new ResizeObserver(update); observer.observe(root.current);
    window.addEventListener('resize', update); document.addEventListener('scroll', update, true);
    const outside = e => { if (!root.current?.contains(e.target) && !e.target.closest('[data-dca-marker],[data-dca-anchor]')) onDismiss?.(); };
    const escape = e => { if (e.key === 'Escape') { e.stopPropagation(); onDismiss?.(); } };
    document.addEventListener('pointerdown', outside); document.addEventListener('keydown', escape);
    return () => { observer.disconnect(); window.removeEventListener('resize', update); document.removeEventListener('scroll', update, true); document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [anchor, gap, inset, onDismiss]);
  return createPortal(<div ref={root} data-dca-ui="" className={`dca-float ${className}`} style={position}>{children}</div>, document.body);
}

function Details({ note, anchor, close, locate }) {
  return <Float anchor={anchor} className="dca-details" onDismiss={close}>
    <header><span>{note.number ? `批注 ${note.number}` : '选区详情'}</span><button className="dca-icon" aria-label="关闭详情" onClick={close}>{icon('close')}</button></header>
    <pre>{note.quote}</pre><p className="dca-meta">助手原文 · {note.number ? (note.status === 'sent' ? '已发送' : '待发送') : '尚未添加'} · {note.quote.length} 字符</p>
    {note.comment && <footer>{note.comment}</footer>}
    {locate && <button className="dca-pill" onClick={locate}>回到原文</button>}
  </Float>;
}

function Editor({ note, face, anchor, close, initiallyExpanded = true }) {
  const input = useRef(null);
  const [expanded, setExpanded] = useState(initiallyExpanded), [draft, setDraft] = useState(note.comment);
  useEffect(() => { input.current?.focus({ preventScroll: true }); }, []);
  useLayoutEffect(() => { if (input.current) { input.current.style.height = 'auto'; input.current.style.height = `${Math.max(22, input.current.scrollHeight)}px`; } }, [draft, expanded]);
  const save = () => { if (draft === note.comment || face.edit(note.id, { comment: draft }) !== false) close(); };
  return <Float anchor={anchor} gap={7} inset={90} className={`dca-editor ${expanded ? 'dca-editor-expanded' : 'dca-editor-compact'}`} onDismiss={close}>
    <textarea ref={input} aria-label={`批注 ${note.number} 的可选评论`} placeholder="添加可选评论…" rows={1} value={draft}
        onPointerDown={() => setExpanded(true)} onChange={e => { setExpanded(true); setDraft(e.target.value); }}
        onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && e.keyCode !== 229) { e.preventDefault(); e.stopPropagation(); save(); } }} />
    {expanded && <div className="dca-editor-actions">
        <button className="dca-icon dca-delete" aria-label={`删除批注 ${note.number}`} onClick={() => { if (face.remove(note.id) !== false) close(); }}>{icon('delete')}</button>
        <span className="dca-editor-spacer"/>
        <button className="dca-cancel" onClick={close}>取消</button>
        <button className="dca-save" onClick={save}>保存</button>
      </div>}
  </Float>;
}

function AnnotationList({ notes, face, anchor, close, edit, editable = true }) {
  return <Float anchor={anchor} gap={4} className="dca-annotations" onDismiss={close}>
    {notes.map(note => <div className={`dca-annotation ${note.selected === false && note.status !== 'sent' ? 'dca-muted' : ''}`} key={note.id}>
      {editable ? <label className="dca-item-number"><input type="checkbox" aria-label={`发送批注 ${note.number}`} checked={note.selected} onChange={e => face.edit(note.id, { selected: e.target.checked })}/><span>{note.number}.</span></label> : <span className="dca-item-number">{note.number}.</span>}
      <div className="dca-item-body"><span className="dca-item-label">所选文本：</span>
        <button className="dca-quote" onClick={() => { face.locate(note); close(); }}>{note.quote}</button>
        <span className="dca-item-label dca-comment-label">用户评论：</span><p className="dca-comment">{note.comment || '未添加评论'}</p>
      </div>
      {editable && <div className="dca-item-actions"><button className="dca-icon" aria-label={`编辑批注 ${note.number}`} onClick={e => edit(note, e)}>{icon('edit')}</button><button className="dca-icon" aria-label={`删除批注 ${note.number}`} onClick={() => face.remove(note.id)}>{icon('delete')}</button></div>}
    </div>)}
  </Float>;
}

function Assistant({ inner: Inner, dca: face, ...props }) {
  const root = useRef(null), source = useRef(null);
  const view = snapshot(face.store);
  const [selection, setSelection] = useState(null), [open, setOpen] = useState(null), [layout, setLayout] = useState([]);
  const nodeKey = String(props.node.key);
  const notes = view.annotations.filter(a => a.nodeKey === nodeKey);
  const selected = () => {
    if (!source.current) return;
    const current = window.getSelection(); if (!current?.rangeCount || current.isCollapsed) return;
    const range = current.getRangeAt(0).cloneRange();
    const selector = capture(source.current, range, nodeKey);
    if (selector) { setSelection({ selector, range }); setOpen(null); }
  };
  useLayoutEffect(() => {
    let frame;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (!root.current || !source.current) return;
        const bounds = root.current.getBoundingClientRect(); const used = [];
        setLayout(notes.flatMap(note => {
          const range = restoreRange(source.current, note); if (!range) return [];
          // Nested inline/code elements can repeat the same rectangle. Painting
          // it twice changes the selection color even though the text is identical.
          const unique = new Map([...range.getClientRects()].filter(r => r.width > 0 && r.height > 0).map(r => [JSON.stringify([r.left, r.top, r.width, r.height]), r]));
          const rects = [...unique.values()].map(r => ({ left: r.left - bounds.left, top: r.top - bounds.top, width: r.width, height: r.height }));
          if (!rects.length) return [];
          const firstTop = Math.min(...rects.map(r => r.top));
          const firstRight = Math.max(...rects.filter(r => Math.abs(r.top - firstTop) < 2).map(r => r.left + r.width));
          let left = Math.max(0, Math.min(firstRight - 27, bounds.width - 27)), top = firstTop - 29;
          const initialLeft = left;
          while (used.some(p => Math.abs(p.top - top) < 27 && Math.abs(p.left - left) < 29)) {
            left -= 31;
            if (left < 0) { left = initialLeft; top -= 31; }
          }
          used.push({ left, top });
          return [{ note, rects, left, top }];
        }));
      });
    };
    measure(); const ro = new ResizeObserver(measure); ro.observe(root.current);
    const mo = new MutationObserver(measure); mo.observe(source.current, { childList: true, subtree: true, characterData: true });
    window.addEventListener('resize', measure); document.addEventListener('scroll', measure, true);
    return () => { cancelAnimationFrame(frame); ro.disconnect(); mo.disconnect(); window.removeEventListener('resize', measure); document.removeEventListener('scroll', measure, true); };
  }, [view, props.node]);
  useEffect(() => {
    let timer;
    const locate = event => {
      if (event.detail.sessionId !== face.sessionId || event.detail.note.nodeKey !== nodeKey) return;
      const note = event.detail.note, range = restoreRange(source.current, note);
      if (!range) { face.report('原文已变化，无法准确定位；批注原文仍保留。'); return; }
      root.current.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
      setSelection(null); setOpen({ kind: event.type === 'dca:edit' && note.status !== 'sent' ? 'edit' : 'details', note }); root.current.classList.add('dca-flash');
      clearTimeout(timer); timer = setTimeout(() => root.current?.classList.remove('dca-flash'), 1200);
    };
    window.addEventListener('dca:locate', locate); window.addEventListener('dca:edit', locate);
    return () => { clearTimeout(timer); window.removeEventListener('dca:locate', locate); window.removeEventListener('dca:edit', locate); };
  }, [face, nodeKey]);
  const active = open && (view.annotations.find(a => a.id === open.note.id) ?? open.note);
  const anchor = () => active ? (restoreRange(source.current, active)?.getBoundingClientRect() ?? root.current.getBoundingClientRect()) : selection?.range?.getBoundingClientRect();
  const close = () => { setOpen(null); setSelection(null); };
  return <div ref={root} className="dca-source" data-dca-node-key={nodeKey} data-dca-session={face.sessionId}>
    <div ref={source} data-dca-content="" onPointerUp={() => setTimeout(selected, 0)} onKeyUp={selected}><Inner {...props}/></div>
    <div className="dca-layer" data-dca-ui="">
      {layout.map(({ note, rects, left, top }) => <React.Fragment key={note.id}>
        {rects.map((rect, i) => <span key={i} data-dca-highlight={note.id} className={`dca-highlight ${note.status === 'sent' ? 'dca-sent' : ''}`} style={rect}/>)}
        <button className="dca-marker" data-dca-marker={note.id} style={{ left, top }} aria-label={`批注 ${note.number}，${note.status === 'sent' ? '已发送' : '待发送'}`}
          onClick={() => { setSelection(null); setOpen({ kind: note.status === 'sent' ? 'details' : 'edit', note }); }}>{note.number}</button>
      </React.Fragment>)}
    </div>
    {selection && !open && <Float anchor={anchor} className="dca-menu" onDismiss={close}>
      <button onClick={() => { const note = face.add(selection.selector); if (note) { setOpen({ kind: 'edit', note, compact: true }); window.getSelection()?.removeAllRanges(); } }}>添加到对话</button>
      <button onClick={() => setOpen({ kind: 'details', note: selection.selector })}>更多详情</button>
    </Float>}
    {open?.kind === 'edit' && active && <Editor key={active.id} note={active} face={face} anchor={anchor} close={close} initiallyExpanded={!open.compact}/>}
    {open?.kind === 'details' && active && <Details note={active} anchor={anchor} close={close}/>}
  </div>;
}

function Dock({ dca: face }) {
  const view = snapshot(face.store), state = snapshot(face.input.state), notice = snapshot(face.notice);
  const [expanded, setExpanded] = useState(false), [editing, setEditing] = useState(null);
  const trigger = useRef(null);
  const pending = view.annotations.filter(a => a.status === 'pending');
  const attached = state.occurrences.some(o => o.source === 'dsh-codex-annotations' && o.ref === view.ref);
  useEffect(() => { const open = e => { if (e.detail === face.sessionId) setExpanded(true); }; window.addEventListener('dca:open-list', open); return () => window.removeEventListener('dca:open-list', open); }, [face]);
  if (!pending.length && !notice) return null;
  const edit = (note, event) => {
    setExpanded(false);
    const mounted = [...document.querySelectorAll('[data-dca-node-key]')].some(el => el.dataset.dcaSession === face.sessionId && el.dataset.dcaNodeKey === note.nodeKey);
    if (mounted) window.dispatchEvent(new CustomEvent('dca:edit', { detail: { sessionId: face.sessionId, note } }));
    else setEditing({ id: note.id, element: trigger.current });
  };
  const edited = view.annotations.find(a => a.id === editing?.id);
  const count = pending.filter(a => a.selected).length;
  return <div className="dca-dock" data-dca-ui="" data-dca-dock="">
    {notice && <div role="alert" className="dca-notice"><span>{notice}</span><button aria-label="关闭提示" onClick={face.dismiss}>×</button></div>}
    {!!pending.length && <div className={attached ? 'dca-batch-chip' : 'dca-batch-chip dca-detached'} data-dca-anchor="">
      <button ref={trigger} className="dca-batch-open" aria-label={count + ' 条注释'} aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{icon('comment')}<span><strong>{count}</strong> 条<span className="dca-chip-label">注释</span></span></button>
      <button className="dca-chip-remove" aria-label={attached ? '取消附加批注' : '附加批注'} onClick={() => face.run(() => attached ? face.detach() : face.ensure(true))}>{icon(attached ? 'close' : 'attach')}</button>
    </div>}
    {expanded && !!pending.length && <AnnotationList notes={pending} face={face} anchor={() => trigger.current?.closest('.dca-batch-chip').getBoundingClientRect()} close={() => setExpanded(false)} edit={edit}/>}
    {edited && <Editor key={edited.id} note={edited} face={face} anchor={() => editing.element.getBoundingClientRect()} close={() => setEditing(null)}/>}
  </div>;
}

function Attachments({ inner: Inner, dca: face, ...props }) {
  return <><Inner {...props}/>{face && <Dock dca={face}/>}</>;
}

function User({ inner: Inner, dca: face, ...props }) {
  const [detail, setDetail] = useState(null);
  const payloads = [];
  const content = (props.node.data.content ?? []).map(block => {
    if (block.type !== 'text') return block;
    const decoded = decodeText(block.text); payloads.push(...decoded.payloads);
    return decoded.payloads.length ? { ...block, text: decoded.text } : block;
  });
  if (!payloads.length) return <Inner {...props}/>;
  const notes = payloads.flatMap(p => p.annotations).map(note => ({ ...note, status: 'sent' }));
  return <div><Inner {...props} node={{ ...props.node, data: { ...props.node.data, content } }}/>
    <div className="dca-sent-pills" data-dca-ui=""><div className="dca-batch-chip" data-dca-anchor=""><button className="dca-batch-open" aria-label={`${notes.length} 条已发送注释`} onClick={e => setDetail(detail ? null : { element: e.currentTarget })}>{icon('comment')}<span><strong>{notes.length}</strong> 条<span className="dca-chip-label">注释</span></span></button></div></div>
    {detail && <AnnotationList notes={notes} face={face} editable={false} anchor={() => detail.element.closest('.dca-batch-chip').getBoundingClientRect()} close={() => setDetail(null)}/>}
  </div>;
}

export function apply(ctx) {
  const runtime = createRuntime(ctx);
  const style = document.createElement('style'); style.dataset.plugin = 'dsh-codex-annotations'; style.textContent = css;
  document.head.append(style);
  ctx.effect(() => () => { runtime.dispose(); style.remove(); });
  ctx.effect(() => ctx.inputTriggers.registerSource(runtime.source));
  const decorated = new WeakSet(), registrations = new Map();
  const names = ['conversation.chat.node', 'conversation.input.attachments'];
  const decorate = () => {
    const entries = names.flatMap(name => ctx.slots.entries(name));
    for (const [entry, release] of registrations) if (!entries.includes(entry)) { registrations.delete(entry); release(); }
    for (const name of names) for (const entry of ctx.slots.entries(name)) {
      const Wrapper = name === 'conversation.input.attachments' ? Attachments : entry.options.key === 'assistant-step' ? Assistant : ['user', 'steering'].includes(entry.options.key) ? User : null;
      if (!Wrapper || decorated.has(entry.component) || registrations.has(entry)) continue;
      const original = entry.component;
      function AnnotatedNode(props) {
        // DSH presents reasoning and response separately with the same node key.
        // Only the response owns quote navigation; the folded reasoning seat
        // otherwise reports a false missing-quote warning alongside the editor.
        if (Wrapper === Assistant && props.groupPart === 'reasoning') return React.createElement(original, props);
        return <Wrapper {...props} dca={props.sessionId === undefined ? null : runtime.faceFor(props.sessionId)} inner={original}/>;
      }
      decorated.add(AnnotatedNode);
      // The renderer caches injection by entry identity. Mutating an already
      // mounted native entry leaves stale props and can abdicate its renderer.
      // A separate priority entry keeps native registration/cache untouched.
      registrations.set(entry, () => {});
      const release = ctx.slots.register({ name, ...entry.options,
        priority: (entry.options.priority ?? 0) - 1, inject: entry.inject, locale: entry.locale,
        store: entry.store }, AnnotatedNode);
      registrations.set(entry, release);
    }
  };
  for (const name of names) ctx.slots.inject(name, decorate);
  const off = ctx.on('slots/changed', name => { if (names.includes(name)) decorate(); });
  ctx.effect(() => () => { off(); for (const release of [...registrations.values()].reverse()) release(); registrations.clear(); });
}
