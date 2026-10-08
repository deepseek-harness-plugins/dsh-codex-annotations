/** Use the host's scrollport and sticky composer, without moving native DOM. */
export function readingViewport(root) {
  let scroll = root.closest('[data-conversation-scroll]');
  if (!scroll) for (let el = root.parentElement; el; el = el.parentElement) {
    if (/(auto|scroll)/.test(getComputedStyle(el).overflowY) && el.scrollHeight > el.clientHeight) { scroll = el; break; }
  }
  scroll ??= document.scrollingElement;
  const pane = scroll === document.scrollingElement
    ? { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight }
    : scroll.getBoundingClientRect();
  const area = { scroll, left: Math.max(12, pane.left + 12), right: Math.min(window.innerWidth - 12, pane.right - 12),
    top: Math.max(12, pane.top + 12), bottom: Math.min(window.innerHeight - 12, pane.bottom - 12) };
  const composer = root.closest('[data-conversation-content]')?.querySelector('[data-composer-seat]');
  if (composer) {
    const rect = composer.getBoundingClientRect();
    if (rect.height && rect.right > area.left && rect.left < area.right && rect.bottom > area.top && rect.top < area.bottom)
      area.bottom = Math.max(area.top, rect.top - 12);
  }
  return area;
}

/** Center the selected text, rather than the (possibly very long) whole reply. */
export function revealQuote(root, range, { spaceAbove = 36, center = true, behavior = 'instant' } = {}) {
  if (!range) return;
  const area = readingViewport(root), rect = range.getBoundingClientRect();
  const first = [...range.getClientRects()].find(r => r.width && r.height);
  if (!first) return;
  const available = Math.max(first.height, area.bottom - area.top - spaceAbove);
  const height = Math.min(rect.height, available);
  if (!center && first.top >= area.top + spaceAbove && first.top + height <= area.bottom) return;
  const top = area.top + spaceAbove + Math.max(0, (available - height) / 2);
  area.scroll.scrollBy({ top: first.top - top, behavior });
}
