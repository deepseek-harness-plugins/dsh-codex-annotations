import { locateQuote } from './core.js';
const OMIT = 'button,textarea,input,select,[aria-hidden="true"],[data-dca-ui]';
const BLOCK = 'p,li,pre,h1,h2,h3,h4,h5,h6,td,th,blockquote';

/** Index visible text with explicit paragraph/table separators; never alter source DOM. */
export function textIndex(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode(node) {
    return node.parentElement?.closest(OMIT) || !node.data.length ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
  } });
  const nodes = []; let text = '', previousBlock;
  for (let node; (node = walker.nextNode());) {
    const block = node.parentElement.closest(BLOCK);
    if (nodes.length && block && previousBlock && block !== previousBlock) {
      const sameRow = block.closest('tr') && block.closest('tr') === previousBlock.closest('tr');
      text += sameRow ? '\t' : '\n';
    }
    nodes.push({ node, start: text.length, end: text.length + node.length });
    text += node.data;
    previousBlock = block;
  }
  return { text, nodes };
}

export function capture(root, range, nodeKey) {
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer) || range.collapsed) return null;
  const index = textIndex(root);
  const intersect = index.nodes.filter(n => range.intersectsNode(n.node));
  if (!intersect.length) return null;
  const first = intersect[0], last = intersect.at(-1);
  const start = first.start + (range.startContainer === first.node ? range.startOffset : 0);
  const end = last.start + (range.endContainer === last.node ? range.endOffset : last.node.length);
  const quote = index.text.slice(start, end);
  if (!quote.trim()) return null;
  return { nodeKey, start, end, quote, prefix: index.text.slice(Math.max(0, start - 40), start), suffix: index.text.slice(end, end + 40) };
}

export function restoreRange(root, note) {
  const index = textIndex(root), found = locateQuote(index.text, note);
  if (!found) return null;
  const first = index.nodes.find(n => n.end > found.start);
  const last = [...index.nodes].reverse().find(n => n.start < found.end);
  if (!first || !last) return null;
  const range = document.createRange();
  range.setStart(first.node, Math.max(0, found.start - first.start));
  range.setEnd(last.node, Math.min(last.node.length, found.end - last.start));
  return range;
}

export function selectionEndRect(range) {
  return [...range.getClientRects()].filter(r => r.width && r.height).at(-1) ?? range.getBoundingClientRect();
}
