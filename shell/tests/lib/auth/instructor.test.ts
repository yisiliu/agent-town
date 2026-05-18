import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock @simplewebauthn/browser before importing the shell helper —
// startRegistration / startAuthentication call into navigator.credentials,
// which is undefined in JSDOM. Mocking lets us assert that the helper
// passes the server-issued options through verbatim and hands the
// response back to the Convex client unchanged.
const mockStartRegistration = vi.hoisted(() => vi.fn());
const mockStartAuthentication = vi.hoisted(() => vi.fn());

vi.mock('@simplewebauthn/browser', () => ({
  startRegistration: mockStartRegistration,
  startAuthentication: mockStartAuthentication,
}));

import {
  registerInstructor,
  authenticateInstructor,
  type InstructorAuthClient,
} from '../../../src/lib/auth/instructor';

beforeEach(() => {
  mockStartRegistration.mockReset();
  mockStartAuthentication.mockReset();
});

function fakeClient() {
  const calls: { name: string; args: unknown }[] = [];
  let next: unknown = undefined;
  const client: InstructorAuthClient = {
    beginRegistration: async (args) => {
      calls.push({ name: 'beginRegistration', args });
      return next;
    },
    completeRegistration: async (args) => {
      calls.push({ name: 'completeRegistration', args });
      return next;
    },
    beginAuthentication: async (args) => {
      calls.push({ name: 'beginAuthentication', args });
      return next;
    },
    completeAuthentication: async (args) => {
      calls.push({ name: 'completeAuthentication', args });
      return next;
    },
  };
  return {
    client,
    calls,
    setNext: (v: unknown) => {
      next = v;
    },
  };
}

describe('registerInstructor', () => {
  it('round-trips begin → startRegistration → complete', async () => {
    const { client, calls } = fakeClient();
    const beginOptions = { challenge: 'A', rp: {}, user: {}, pubKeyCredParams: [] };
    const attestation = { id: 'cred-id', rawId: 'cred-id', type: 'public-key', response: {} };
    const completeResult = { ok: true };

    // Sequence the client returns by call name.
    let phase = 0;
    client.beginRegistration = async (args) => {
      calls.push({ name: 'beginRegistration', args });
      phase++;
      return beginOptions;
    };
    client.completeRegistration = async (args) => {
      calls.push({ name: 'completeRegistration', args });
      phase++;
      return completeResult;
    };
    mockStartRegistration.mockResolvedValue(attestation);

    const result = await registerInstructor(client, {
      username: 'prof',
      displayName: 'Prof',
    });

    expect(result).toBe(completeResult);
    expect(calls).toEqual([
      { name: 'beginRegistration', args: { username: 'prof', displayName: 'Prof' } },
      {
        name: 'completeRegistration',
        args: { username: 'prof', response: attestation },
      },
    ]);
    expect(mockStartRegistration).toHaveBeenCalledWith({
      optionsJSON: beginOptions,
    });
  });
});

describe('authenticateInstructor', () => {
  it('round-trips begin → startAuthentication → complete', async () => {
    const { client, calls } = fakeClient();
    const beginOptions = { challenge: 'B', allowCredentials: [] };
    const assertion = { id: 'cred-id', rawId: 'cred-id', type: 'public-key', response: {} };
    const completeResult = { ok: true, token: 't', expiresAt: 1 };

    client.beginAuthentication = async (args) => {
      calls.push({ name: 'beginAuthentication', args });
      return beginOptions;
    };
    client.completeAuthentication = async (args) => {
      calls.push({ name: 'completeAuthentication', args });
      return completeResult;
    };
    mockStartAuthentication.mockResolvedValue(assertion);

    const result = await authenticateInstructor(client, { username: 'prof' });

    expect(result).toBe(completeResult);
    expect(calls).toEqual([
      { name: 'beginAuthentication', args: { username: 'prof' } },
      {
        name: 'completeAuthentication',
        args: { username: 'prof', response: assertion },
      },
    ]);
    expect(mockStartAuthentication).toHaveBeenCalledWith({
      optionsJSON: beginOptions,
    });
  });

  it('propagates a thrown error from startAuthentication (user cancellation)', async () => {
    const { client } = fakeClient();
    client.beginAuthentication = async () => ({ challenge: 'B', allowCredentials: [] });
    mockStartAuthentication.mockRejectedValue(new Error('NotAllowedError'));

    await expect(
      authenticateInstructor(client, { username: 'prof' }),
    ).rejects.toThrow(/NotAllowedError/);
  });
});
