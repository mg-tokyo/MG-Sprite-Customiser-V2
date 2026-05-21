import { describe, expect, it } from 'vitest';
import { getRuntimeCorsProxy } from './proxy-config';

describe('proxy override hardening', () => {
  it('ignores runtime override outside debug mode', () => {
    const proxy = getRuntimeCorsProxy();
    expect(proxy).toBe('');
  });
});
