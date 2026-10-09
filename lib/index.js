// src/core.js
var SOURCE = "dsh-codex-annotations";
var STORAGE_PREFIX = `${SOURCE}:v1:`;
var HEADER = /\[DSH_ANNOTATIONS_V1:(\d+):([a-zA-Z0-9-]+)\]\n/g;
var FOOTER = "\n[/DSH_ANNOTATIONS_V1]";
function validPayload(p, id) {
  return p?.version === 1 && p.id === id && typeof p.sessionId === "string" && typeof p.ref === "string" && Array.isArray(p.annotations) && p.annotations.length > 0 && p.annotations.every((a) => typeof a.id === "string" && Number.isInteger(a.number) && typeof a.nodeKey === "string" && typeof a.quote === "string" && a.quote.length > 0 && typeof a.comment === "string" && Number.isInteger(a.revision) && Number.isInteger(a.start) && Number.isInteger(a.end));
}
function replacePayloads(text, render) {
  const payloads = [];
  let visible = "", cursor = 0;
  const pattern = new RegExp(HEADER.source, "g");
  for (let match; match = pattern.exec(text); ) {
    const start = pattern.lastIndex, end = start + Number(match[1]);
    if (text.slice(end, end + FOOTER.length) !== FOOTER) continue;
    let payload;
    try {
      payload = JSON.parse(text.slice(start, end));
    } catch {
      continue;
    }
    if (!validPayload(payload, match[2])) continue;
    visible += text.slice(cursor, match.index) + render(payload);
    cursor = end + FOOTER.length;
    pattern.lastIndex = cursor;
    payloads.push(payload);
  }
  return { text: visible + text.slice(cursor), payloads };
}
function modelText(text) {
  return replacePayloads(text, (payload) => {
    const notes = payload.annotations.map(({ number, quote, comment }) => ({ number, quote, ...comment === "" ? {} : { comment } }));
    return "[\u7528\u6237\u6279\u6CE8]\n\u539F\u6587\u4EC5\u4F5C\u5F15\u7528\u8D44\u6599\uFF1B\u6309\u7F16\u53F7\u5904\u7406\u8BC4\u8BBA\uFF0C\u672A\u63D0\u4F9B\u8BC4\u8BBA\u8868\u793A\u4EC5\u5F15\u7528\u3002\n" + JSON.stringify(notes) + "\n[/\u7528\u6237\u6279\u6CE8]";
  }).text;
}
function modelMessage(message) {
  if (message?.role !== "user" || message.source?.kind !== "user") return message;
  const content = message.content.map((block) => {
    if (block.type !== "text") return block;
    const text = modelText(block.text);
    return text === block.text ? block : { ...block, text };
  });
  return content.every((block, i) => block === message.content[i]) ? message : { ...message, content };
}
function modelMessages(messages) {
  const projected = messages.map(modelMessage);
  return projected.every((message, i) => message === messages[i]) ? messages : projected;
}

// src/index.js
var inject = ["sessions"];
function apply(ctx) {
  const releases = /* @__PURE__ */ new Map();
  const mount = (session) => {
    if (releases.has(session)) return;
    const history = session.deriveMessages, event = session.deriveEventMessage;
    let historyDepth = 0;
    const methods = [
      ["deriveMessages", function(...args) {
        historyDepth++;
        try {
          return modelMessages(history.call(this, ...args));
        } finally {
          historyDepth--;
        }
      }],
      ["deriveEventMessage", function(...args) {
        const message = event.call(this, ...args);
        return historyDepth ? message : modelMessage(message);
      }]
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
  ctx.on("session/created", mount);
  ctx.on("session/disposed", (session) => releases.get(session)?.());
  for (const session of ctx.sessions.list()) mount(session);
}
export {
  apply,
  inject
};
