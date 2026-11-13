import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { blurOnTapAway } from './blurOnTapAway';

function Form() {
  return (
    <div data-testid="body" onPointerDown={blurOnTapAway}>
      <input aria-label="Title" />
      <p data-testid="blank">Some text</p>
    </div>
  );
}

afterEach(cleanup);

describe('blurOnTapAway', () => {
  it('blurs the focused field when the tap lands elsewhere', () => {
    render(<Form />);
    const field = screen.getByLabelText('Title');
    field.focus();
    fireEvent.pointerDown(screen.getByTestId('blank'));
    expect(document.activeElement).not.toBe(field);
  });

  it('leaves the field focused when the tap is on it', () => {
    render(<Form />);
    const field = screen.getByLabelText('Title');
    field.focus();
    fireEvent.pointerDown(field);
    expect(document.activeElement).toBe(field);
  });
});
