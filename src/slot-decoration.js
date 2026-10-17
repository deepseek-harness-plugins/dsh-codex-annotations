// Independently installed Codex plugins share this marker so either layer
// can be removed while retaining the other plugin and the native component.
const LAYER = Symbol.for('@deepseekharness-plugin/component-layer');

export function decorateSlot(ctx, name, entry, render) {
  const layer = { inner: entry.component, active: true };
  function Decorated(props) { return render(layer.inner, props, layer.active); }
  Object.defineProperty(Decorated, LAYER, { value: layer });
  // Retain the native entry identity, inject cache, store and child ownership.
  // A copied registration loses renderSlot; copying children redeclares them.
  entry.component = Decorated;
  // A lower-priority notification seat makes mounted outlets reread the
  // component on enable AND disable. Dispose an existing seat during unload:
  // creating a new registration there would use an already inactive context.
  const notify = ctx.slots.register({ name, ...entry.options,
    priority: Math.max(...ctx.slots.entries(name).map(item => item.options.priority ?? 0)) + 1 }, () => null);
  return ctx.effect(() => () => {
    if (!layer.active) return;
    // React can finish a retained view while the plugin is unloading.
    layer.active = false;
    if (entry.component === Decorated) entry.component = layer.inner;
    else {
      let parent = entry.component[LAYER];
      while (parent && parent.inner !== Decorated) parent = parent.inner[LAYER];
      if (parent) parent.inner = layer.inner;
    }
    notify();
  });
}
