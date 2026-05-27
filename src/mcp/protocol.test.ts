// Pure-helper tests for the MCP protocol module. JSON-RPC envelope shape +
// the type guards we use to route incoming server messages.
import { describe, it, expect, beforeEach } from 'vitest';
import {
  isError,
  isNotification,
  isResponse,
  isServerRequest,
  makeNotification,
  makeRequest,
  _resetIdCounter,
} from './protocol';

beforeEach(() => _resetIdCounter());

describe('makeRequest / makeNotification', () => {
  it('produces monotonically-increasing ids', () => {
    const a = makeRequest('m');
    const b = makeRequest('m');
    expect(b.id as number).toBe((a.id as number) + 1);
  });

  it('omits params when not given', () => {
    const r = makeRequest('initialize');
    expect('params' in r).toBe(false);
  });

  it('keeps params when given', () => {
    const r = makeRequest('tools/call', { name: 'x', arguments: {} });
    expect(r.params).toEqual({ name: 'x', arguments: {} });
  });

  it('notifications have no id field at all', () => {
    const n = makeNotification('notifications/initialized');
    expect('id' in n).toBe(false);
    expect(n.method).toBe('notifications/initialized');
  });
});

describe('type guards', () => {
  it('isResponse matches success and failure envelopes', () => {
    expect(isResponse({ jsonrpc: '2.0', id: 1, result: {} })).toBe(true);
    expect(isResponse({ jsonrpc: '2.0', id: 1, error: { code: -1, message: 'x' } })).toBe(true);
  });

  it('isServerRequest matches an id + method without result/error', () => {
    expect(isServerRequest({ jsonrpc: '2.0', id: 7, method: 'sampling/createMessage' })).toBe(true);
    expect(isServerRequest({ jsonrpc: '2.0', id: 7, result: {} })).toBe(false);
  });

  it('isNotification matches no-id + method', () => {
    expect(isNotification({ jsonrpc: '2.0', method: 'notifications/progress' })).toBe(true);
    expect(isNotification({ jsonrpc: '2.0', id: 1, method: 'tools/list' })).toBe(false);
  });

  it('isError flags failure-shaped responses', () => {
    expect(isError({ jsonrpc: '2.0', id: 1, error: { code: -1, message: 'x' } })).toBe(true);
    expect(isError({ jsonrpc: '2.0', id: 1, result: {} })).toBe(false);
  });
});
