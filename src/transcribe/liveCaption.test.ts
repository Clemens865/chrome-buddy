import { describe, it, expect } from 'vitest';
import { reduceSpeechResults, type SpeechResultLike } from './liveCaption';

function result(transcript: string, isFinal: boolean): SpeechResultLike {
  return { isFinal, 0: { transcript }, length: 1 };
}

describe('reduceSpeechResults', () => {
  it('appends final results to the running final text', () => {
    const { final, interim } = reduceSpeechResults('Hello ', 0, [result('world.', true)]);
    expect(final).toBe('Hello world.');
    expect(interim).toBe('');
  });

  it('collects interim results separately (not appended to final)', () => {
    const { final, interim } = reduceSpeechResults('Done. ', 0, [result('still talking', false)]);
    expect(final).toBe('Done. ');
    expect(interim).toBe('still talking');
  });

  it('handles a mixed batch from resultIndex onward', () => {
    const batch = [result('skip me', true), result('keep final ', true), result('and interim', false)];
    const { final, interim } = reduceSpeechResults('', 1, batch);
    expect(final).toBe('keep final ');
    expect(interim).toBe('and interim');
  });

  it('tolerates a missing alternative', () => {
    const broken = { isFinal: false, length: 0 } as unknown as SpeechResultLike;
    const { final, interim } = reduceSpeechResults('x', 0, [broken]);
    expect(final).toBe('x');
    expect(interim).toBe('');
  });
});
