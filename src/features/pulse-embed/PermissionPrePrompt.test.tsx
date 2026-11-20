import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  PRE_PROMPT_SEEN_KEY,
  prePromptSeen,
  resetPrePromptForTests,
  usePermissionPrePrompt,
} from './PermissionPrePrompt';
import { RECORD_TEXT } from './recordStrings';

const T = RECORD_TEXT.prePrompt;

/** A record button behind the pre-prompt, as PulseRecordButton puts it. */
function Harness({ record }: { record: () => void }) {
  const { beforeRecord, prompt } = usePermissionPrePrompt();
  return (
    <>
      <button type="button" onClick={() => beforeRecord(record)}>
        record
      </button>
      {prompt}
    </>
  );
}

const tap = () => fireEvent.click(screen.getByRole('button', { name: 'record' }));
const explanation = () => screen.queryByText(T.body);

describe('PermissionPrePrompt', () => {
  beforeEach(() => {
    localStorage.clear();
    resetPrePromptForTests();
  });
  afterEach(cleanup);

  it('explains before the first recording, and Continue then records', async () => {
    const record = vi.fn();
    render(<Harness record={record} />);
    tap();
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByText(T.title)).toBeTruthy();
    expect(explanation()).toBeTruthy();
    expect(record).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: T.continue }));
    });
    expect(record).toHaveBeenCalledTimes(1);
    expect(explanation()).toBeNull();
  });

  it('is shown once: after Continue, every later tap records at once', async () => {
    const record = vi.fn();
    render(<Harness record={record} />);
    tap();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: T.continue }));
    });
    tap();
    tap();
    expect(explanation()).toBeNull();
    expect(record).toHaveBeenCalledTimes(3);
    expect(localStorage.getItem(PRE_PROMPT_SEEN_KEY)).toBe('1');
  });

  it('remembers it on this phone, across pages', () => {
    localStorage.setItem(PRE_PROMPT_SEEN_KEY, '1');
    const record = vi.fn();
    render(<Harness record={record} />);
    tap();
    expect(explanation()).toBeNull();
    expect(record).toHaveBeenCalledTimes(1);
  });

  it('Not now does nothing: no recording, and it explains again next time', async () => {
    const record = vi.fn();
    render(<Harness record={record} />);
    tap();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: T.notNow }));
    });
    expect(record).not.toHaveBeenCalled();
    expect(explanation()).toBeNull();
    expect(prePromptSeen()).toBe(false);
    expect(localStorage.getItem(PRE_PROMPT_SEEN_KEY)).toBeNull();

    tap();
    expect(explanation()).toBeTruthy();
  });

  it('still shows once per page when storage is refused (a private window)', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });
    try {
      const record = vi.fn();
      render(<Harness record={record} />);
      tap();
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: T.continue }));
      });
      tap();
      expect(explanation()).toBeNull();
      expect(record).toHaveBeenCalledTimes(2);
    } finally {
      setItem.mockRestore();
    }
  });
});
