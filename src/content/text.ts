const TEXT_NODE = 3;
const ELEMENT_NODE = 1;

// Subtrees whose text is never read: code, and anything that holds what the user typed.
const SKIPPED_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'TEXTAREA', 'SELECT']);

export function collapse(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

export function cut(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max).trimEnd();
}

// Whether the element is editable through contenteditable, its own or inherited. The nearest
// ancestor that sets the attribute decides, as in the browser.
export function isInEditable(el: Element): boolean {
  for (let node: Element | null = el; node; node = node.parentElement) {
    const value = node.getAttribute('contenteditable');
    if (value !== null) return value.toLowerCase() !== 'false';
  }
  return false;
}

function hostsEditable(el: Element): boolean {
  const value = el.getAttribute('contenteditable');
  return value !== null && value.toLowerCase() !== 'false';
}

// The text under an element, skipping form fields and editable regions, so a label or a
// heading can be read without ever reading a value.
export function staticText(root: Element): string {
  const parts: string[] = [];
  const walk = (node: Node) => {
    for (const child of node.childNodes) {
      if (child.nodeType === TEXT_NODE) {
        parts.push(child.nodeValue ?? '');
      } else if (child.nodeType === ELEMENT_NODE) {
        const el = child as Element;
        if (!SKIPPED_TAGS.has(el.tagName) && !hostsEditable(el)) walk(el);
      }
    }
  };
  walk(root);
  return parts.join(' ');
}
