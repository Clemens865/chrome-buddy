import { describe, it, expect } from 'vitest';
import { keyInfo, parseKeys } from './visionKeys';

describe('keyInfo', () => {
  it('resolves named keys', () => {
    expect(keyInfo('Enter')).toEqual({ key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    expect(keyInfo('escape').key).toBe('Escape');
    expect(keyInfo('ArrowDown')).toEqual({ key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 });
  });
  it('resolves letters a-z to KeyX codes', () => {
    expect(keyInfo('c')).toEqual({ key: 'c', code: 'KeyC', windowsVirtualKeyCode: 67 });
    expect(keyInfo('Z').code).toBe('KeyZ');
  });
  it('resolves digits 0-9 to DigitN codes', () => {
    expect(keyInfo('5')).toEqual({ key: '5', code: 'Digit5', windowsVirtualKeyCode: 53 });
  });
});

describe('parseKeys', () => {
  it('extracts modifiers + main key', () => {
    expect(parseKeys('control+c')).toEqual({ modifiers: 2, main: keyInfo('c') });
    expect(parseKeys('Control+Shift+A')).toEqual({ modifiers: 2 | 8, main: keyInfo('a') });
    expect(parseKeys('cmd+v')).toEqual({ modifiers: 4, main: keyInfo('v') });
    expect(parseKeys('alt+tab')).toEqual({ modifiers: 1, main: keyInfo('tab') });
  });
  it('handles a single key with no modifier', () => {
    expect(parseKeys('Enter')).toEqual({ modifiers: 0, main: keyInfo('Enter') });
  });
});
