import { cleanup, render } from '@testing-library/react';
import { SuperChatInbox, type SuperChatConversation } from '@mieweb/ui/components/SuperChat';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { findListHeader } from './useInboxSlot';

// SuperChat reads layout APIs jsdom doesn't implement.
beforeAll(() => {
  class NoopObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  globalThis.ResizeObserver ??= NoopObserver as unknown as typeof ResizeObserver;
  globalThis.IntersectionObserver ??= NoopObserver as unknown as typeof IntersectionObserver;
  Element.prototype.scrollTo ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
  window.matchMedia ??= (query: string) =>
    ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      onchange: null,
      dispatchEvent: () => false,
    }) as MediaQueryList;
});

afterEach(cleanup);

const conversation: SuperChatConversation = {
  id: 'c1',
  title: 'Today',
  participants: [{ id: 'u1', kind: 'human', name: 'Test User' }],
  thread: [{ id: 'm1', participantId: 'u1', text: 'Hello', time: new Date(2026, 9, 1, 9) }],
  lastActivity: new Date(2026, 9, 1, 9),
};

function renderInbox() {
  const { container } = render(
    <SuperChatInbox
      conversations={[conversation]}
      currentParticipantId="u1"
      onMessageSent={() => {}}
    />,
  );
  return container;
}

// This pins the internal SuperChat markup the Huddle page portals into. If it
// fails after a @mieweb/ui change, the filters would have silently vanished:
// update the selector, or switch to the new slot prop (see
// docs/superchat-inbox-gaps.md).
describe('SuperChatInbox portal targets', () => {
  it('finds the conversation list header', () => {
    const header = findListHeader(renderInbox());
    expect(header).not.toBeNull();
    expect(header?.closest('[data-slot="superchat-conversations"]')).not.toBeNull();
  });
});
