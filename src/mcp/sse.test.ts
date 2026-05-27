// SSE frame parser tests. The transport relies on these being exactly right —
// every Streamable-HTTP MCP response in the wild is either plain JSON or one
// of these frame shapes.
import { describe, it, expect } from 'vitest';
import { parseSseFrames } from './sse';

describe('parseSseFrames', () => {
  it('parses a single complete frame and returns no rest', () => {
    const { frames, rest } = parseSseFrames('data: hello\n\n');
    expect(frames).toEqual([{ data: 'hello' }]);
    expect(rest).toBe('');
  });

  it('joins multi-line data with newlines', () => {
    const { frames } = parseSseFrames('data: line1\ndata: line2\n\n');
    expect(frames).toEqual([{ data: 'line1\nline2' }]);
  });

  it('respects the explicit event name', () => {
    const { frames } = parseSseFrames('event: ping\ndata: {}\n\n');
    expect(frames).toEqual([{ event: 'ping', data: '{}' }]);
  });

  it('returns the tail when a frame is partial', () => {
    const { frames, rest } = parseSseFrames('data: half');
    expect(frames).toEqual([]);
    expect(rest).toBe('data: half');
  });

  it('keeps everything after the last \\n\\n as rest', () => {
    const { frames, rest } = parseSseFrames('data: a\n\ndata: incomp');
    expect(frames).toEqual([{ data: 'a' }]);
    expect(rest).toBe('data: incomp');
  });

  it('handles CRLF terminators', () => {
    const { frames, rest } = parseSseFrames('data: x\r\n\r\n');
    expect(frames).toEqual([{ data: 'x' }]);
    expect(rest).toBe('');
  });

  it('ignores comment lines (leading colon)', () => {
    const { frames } = parseSseFrames(': keepalive\ndata: real\n\n');
    expect(frames).toEqual([{ data: 'real' }]);
  });

  it('drops frames that have no data lines', () => {
    const { frames } = parseSseFrames('event: tick\n\ndata: real\n\n');
    expect(frames).toEqual([{ data: 'real' }]);
  });

  it('strips a single space after the field colon (per spec)', () => {
    const { frames } = parseSseFrames('data: x\n\n');
    expect(frames[0].data).toBe('x');
    // No space → no strip.
    const { frames: f2 } = parseSseFrames('data:y\n\n');
    expect(f2[0].data).toBe('y');
  });
});
