/**
 * Minimal client for the Lorcanahunter developer API (Node only: it holds the client secret).
 * Docs: https://lorcanahunter.com/developers/reference
 *
 * OAuth2 client credentials: a fresh access token (valid 24 h) on every run, so no refresh token
 * has to be stored. Scopes: tournaments:read (list, standings) and decks:read (decklists).
 */
import { LORCANAHUNTER_URL } from '../config.js';
import { retryAfterSeconds } from './duels-api.js';

const SCOPES = 'tournaments:read decks:read';

/** An API error, retryable when worth another try (rate limit, server trouble, network). */
function apiError(message, extra = {}) {
  return Object.assign(new Error(message), extra);
}

async function send(url, init) {
  try {
    return await fetch(url, init);
  } catch (error) {
    throw apiError(`Network error on ${url}: ${error.message}`, { retryable: true });
  }
}

/** Throws on anything but a 2xx; `{error, error_description}` gives the reason. */
async function check(res, url) {
  if (res.ok) return res;
  const body = await res.json().catch(() => ({}));
  const reason = body.error ? ` ${body.error}: ${body.error_description ?? ''}` : '';
  const message = `HTTP ${res.status} on ${url}${reason}`;
  if (res.status === 429) {
    const retryAfter = retryAfterSeconds(res.headers.get('retry-after'));
    throw apiError(message, { retryAfter, retryable: true, code: body.error });
  }
  throw apiError(message, { retryable: res.status >= 500, code: body.error, status: res.status });
}

/**
 * @param {object} credentials
 * @param {string} credentials.clientId
 * @param {string} credentials.clientSecret
 */
export function lorcanahunterClient({ clientId, clientSecret }) {
  let token = null;

  async function fetchToken() {
    const url = new URL('/api/oauth/token', LORCANAHUNTER_URL);
    const res = await send(url, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: new URLSearchParams({ grant_type: 'client_credentials', scope: SCOPES }),
    });
    await check(res, url);
    return (await res.json()).access_token;
  }

  /**
   * GET an API path. A token revoked or expired mid-run (401 invalid_token) is replaced once.
   * @returns {Promise<any>} the JSON body
   */
  async function get(path, params = {}) {
    const url = new URL(path, LORCANAHUNTER_URL);
    for (const [name, value] of Object.entries(params)) {
      if (value != null) url.searchParams.set(name, value);
    }
    for (let renewed = false; ; renewed = true) {
      token ??= await fetchToken();
      const res = await send(url, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      });
      if (res.status === 401 && !renewed) {
        token = null;
        continue;
      }
      await check(res, url);
      return res.json();
    }
  }

  return { get };
}
