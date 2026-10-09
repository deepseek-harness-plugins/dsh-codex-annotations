import { modelMessage, modelMessages } from './core.js';

export const inject = ['sessions'];

/** Project public model readers, leaving durable events/UI and history caches intact. */
export function apply(ctx) {
  const releases = new Map();
  const mount = session => {
    if (releases.has(session)) return;
    const history = session.deriveMessages, event = session.deriveEventMessage;
    let historyDepth = 0;
    const methods = [
      ['deriveMessages', function (...args) {
        historyDepth++;
        try { return modelMessages(history.call(this, ...args)); }
        finally { historyDepth--; }
      }],
      ['deriveEventMessage', function (...args) {
        const message = event.call(this, ...args);
        // deriveMessages caches event results; keep that cache raw for safe teardown.
        return historyDepth ? message : modelMessage(message);
      }],
    ].map(([key, projected]) => ({ key, projected, descriptor: Object.getOwnPropertyDescriptor(session, key) }));
    const release = ctx.effect(() => {
      for (const { key, projected } of methods) session[key] = projected;
      return () => {
        for (const { key, projected, descriptor } of methods) {
          if (session[key] !== projected) continue;
          if (descriptor) Object.defineProperty(session, key, descriptor);
          else delete session[key];
        }
        releases.delete(session);
      };
    });
    releases.set(session, release);
  };
  ctx.on('session/created', mount);
  ctx.on('session/disposed', session => releases.get(session)?.());
  for (const session of ctx.sessions.list()) mount(session);
}
