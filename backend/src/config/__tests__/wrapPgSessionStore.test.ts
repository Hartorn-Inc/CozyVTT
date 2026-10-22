/**
 * wrapPgSessionStore maps a production-store callback error to
 * LoginSessionStoreUnavailable (HTTP 503, not 500 or 401) and refuses to
 * write a sid destroyUserLoginSessions has blocked.
 */

import { createHmac } from 'crypto';
import session from 'express-session';
import request from 'supertest';
import { createApp } from '../../app';
import { sessionOptions } from '../sessionOptions';
import { wrapPgSessionStore, sessionPool, loginSessionWriteBarrier } from '../session';
import { blockLoginSessions, unblockLoginSessions } from '../../services/revokedLoginSessions';

afterEach(() => {
  delete loginSessionWriteBarrier.wait;
});

afterAll(() => sessionPool.end());

const SECRET = 'wrap-pg-session-store-test-secret-32chars';

class FakeStore extends session.Store {
  getCalls = 0;
  setCalls = 0;
  touchCalls = 0;
  getError: Error | undefined;
  touchError: Error | undefined;

  get(_sid: string, callback: (err: Error | null, sess?: session.SessionData | null) => void): void {
    this.getCalls += 1;
    if (this.getError) callback(this.getError);
    else callback(null, null);
  }

  set(_sid: string, _sess: session.SessionData, callback?: (err?: Error) => void): void {
    this.setCalls += 1;
    if (callback) callback();
  }

  destroy(_sid: string, callback?: (err?: Error) => void): void {
    if (callback) callback();
  }

  touch(_sid: string, _sess: session.SessionData, callback?: () => void): void {
    this.touchCalls += 1;
    if (callback) {
      if (this.touchError) {
        const done = callback as unknown as (err?: Error) => void;
        done(this.touchError);
      } else {
        callback();
      }
    }
  }
}

function signedCookie(sid: string): string {
  const sig = createHmac('sha256', SECRET).update(sid).digest('base64').replace(/=+$/g, '');
  return `cozyvtt.sid=${encodeURIComponent(`s:${sid}.${sig}`)}`;
}

function cookieOf(sess: Partial<session.SessionData> = {}): session.SessionData {
  return {
    cookie: {
      originalMaxAge: 3_600_000,
      expires: new Date(Date.now() + 3_600_000),
      httpOnly: true,
      path: '/',
    },
    ...sess,
  };
}

describe('wrapPgSessionStore callback errors', () => {
  it('maps get errors to name LoginSessionStoreUnavailable', () => {
    const inner = new FakeStore();
    inner.getError = new Error('ECONNREFUSED');
    const store = wrapPgSessionStore(inner);
    const received: Error[] = [];
    store.get('sid-get', (err) => {
      if (err) received.push(err);
    });
    expect(received).toHaveLength(1);
    expect(received[0].name).toBe('LoginSessionStoreUnavailable');
    expect(received[0].message).toBe('The login session could not be confirmed. Try again in a moment.');
  });

  it('maps touch errors to name LoginSessionStoreUnavailable', () => {
    const inner = new FakeStore();
    inner.touchError = new Error('ECONNREFUSED');
    const store = wrapPgSessionStore(inner);
    const received: Error[] = [];
    store.touch!('sid-touch', cookieOf(), (err?: Error) => {
      if (err) received.push(err);
    });
    expect(received).toHaveLength(1);
    expect(received[0].name).toBe('LoginSessionStoreUnavailable');
  });
});

describe('wrapPgSessionStore blocked sids', () => {
  it('no-ops set without writing when the sid is blocked', () => {
    const sid = `blocked-set-${Date.now()}`;
    blockLoginSessions([sid]);
    const inner = new FakeStore();
    const store = wrapPgSessionStore(inner);
    let done = false;
    store.set(sid, cookieOf({ userId: 'u1' }), (err) => {
      expect(err).toBeUndefined();
      done = true;
    });
    expect(done).toBe(true);
    expect(inner.setCalls).toBe(0);
  });

  it('still calls inner set after the write barrier, even if the sid is blocked meanwhile', async () => {
    const sid = `barrier-set-${Date.now()}`;
    let release!: () => void;
    loginSessionWriteBarrier.wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    const inner = new FakeStore();
    const store = wrapPgSessionStore(inner);
    const done = new Promise<void>((resolve, reject) => {
      store.set(sid, cookieOf({ userId: 'u1' }), (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
    expect(inner.setCalls).toBe(0);
    blockLoginSessions([sid]);
    release();
    await done;
    expect(inner.setCalls).toBe(1);
  });

  it('lets set write again after unblockLoginSessions', () => {
    const sid = `unblocked-set-${Date.now()}`;
    blockLoginSessions([sid]);
    const inner = new FakeStore();
    const store = wrapPgSessionStore(inner);
    store.set(sid, cookieOf({ userId: 'u1' }), () => {});
    expect(inner.setCalls).toBe(0);
    unblockLoginSessions([sid]);
    let done = false;
    store.set(sid, cookieOf({ userId: 'u1' }), (err) => {
      expect(err).toBeUndefined();
      done = true;
    });
    expect(done).toBe(true);
    expect(inner.setCalls).toBe(1);
  });
});

describe('a discrete HTTP action when the store cannot load the session', () => {
  it('answers 503 Service Unavailable, not 401 or 500, and without Retry-After', async () => {
    const inner = new FakeStore();
    inner.getError = new Error('ECONNREFUSED');
    const app = createApp({
      session: {
        ...sessionOptions,
        secret: SECRET,
        store: wrapPgSessionStore(inner),
      },
      generalApiLimiter: false,
      setupGate: false,
    });

    const res = await request(app).get('/api/auth/me').set('Cookie', signedCookie('sid-http-get'));

    expect(inner.getCalls).toBeGreaterThan(0);
    expect(res.status).toBe(503);
    expect(res.body).toEqual({
      error: 'Service Unavailable',
      message: 'The login session could not be confirmed. Try again in a moment.',
    });
    expect(res.headers['retry-after']).toBeUndefined();
  });

  it('still answers 401 when there is no cookie to load', async () => {
    const inner = new FakeStore();
    inner.getError = new Error('ECONNREFUSED');
    const app = createApp({
      session: {
        ...sessionOptions,
        secret: SECRET,
        store: wrapPgSessionStore(inner),
      },
      generalApiLimiter: false,
      setupGate: false,
    });

    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
    expect(inner.getCalls).toBe(0);
  });
});
