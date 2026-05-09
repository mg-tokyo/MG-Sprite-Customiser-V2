import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleProxyRequest } from '../cors-proxy.js';

describe('cors worker hardening', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('blocks disallowed methods', async () => {
    const req = new Request(
      'https://worker.example/?url=https%3A%2F%2Fmg-api.ariedam.fr%2Fdata',
      {
        method: 'POST',
        headers: { origin: 'https://mg-tokyo.github.io' },
      },
    );
    const res = await handleProxyRequest(req, {});
    expect(res.status).toBe(405);
  });

  it('blocks requests from untrusted origins', async () => {
    const req = new Request(
      'https://worker.example/?url=https%3A%2F%2Fmg-api.ariedam.fr%2Fdata',
      {
        method: 'GET',
        headers: { origin: 'https://attacker.example' },
      },
    );
    const res = await handleProxyRequest(req, {});
    expect(res.status).toBe(403);
  });

  it('allows approved origin + target', async () => {
    const fetchMock = vi.fn(async () => {
      return new Response('{"ok":true}', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const req = new Request(
      'https://worker.example/?url=https%3A%2F%2Fmg-api.ariedam.fr%2Fassets%2Fsprite-data',
      {
        method: 'GET',
        headers: {
          origin: 'https://mg-tokyo.github.io',
          'cf-connecting-ip': '203.0.113.5',
        },
      },
    );

    const res = await handleProxyRequest(req, {});
    expect(res.status).toBe(200);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://mg-tokyo.github.io');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('blocks disallowed target paths even on allowed hosts', async () => {
    const req = new Request(
      'https://worker.example/?url=https%3A%2F%2Fmg-api.ariedam.fr%2Fadmin%2Fsecret',
      {
        method: 'GET',
        headers: { origin: 'https://mg-tokyo.github.io' },
      },
    );
    const res = await handleProxyRequest(req, {});
    expect(res.status).toBe(403);
  });
});
