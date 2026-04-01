import { describe, expect, it } from 'vitest';
import { parseHTML } from 'linkedom';
import { extractVisibleMessages } from './index';

describe('extractor', () => {
  it('extracts from DOM fixture', () => {
    const { document } = parseHTML('<main><article data-message-author-role="user">Hello</article></main>');
    const messages = extractVisibleMessages(document);
    expect(messages[0].role).toBe('user');
  });
});
