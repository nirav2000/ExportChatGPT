import type { ContentBlockT } from '@project-archivist/schema';

export interface ExtractedMessage {
  role: 'user' | 'assistant' | 'system' | 'unknown';
  blocks: ContentBlockT[];
  warnings: string[];
}

export function extractVisibleMessages(doc: Document): ExtractedMessage[] {
  const nodes = Array.from(doc.querySelectorAll('article [data-message-author-role], main article'));
  const out: ExtractedMessage[] = [];
  for (const node of nodes) {
    const roleAttr = (node.getAttribute('data-message-author-role') || '').toLowerCase();
    const role = (['user', 'assistant', 'system'].includes(roleAttr) ? roleAttr : 'unknown') as ExtractedMessage['role'];
    const text = node.textContent?.trim() ?? '';
    out.push({
      role,
      blocks: text ? [{ type: 'paragraph', text }] : [{ type: 'unknown_html', html: node.innerHTML }],
      warnings: text ? [] : ['No text content found; fallback to raw HTML'],
    });
  }
  return out;
}
