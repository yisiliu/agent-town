import {
  startRegistration,
  startAuthentication,
} from '@simplewebauthn/browser';

// Client-side WebAuthn ceremony wrapper. Sits between the React tree
// and the Convex mutations defined in convex/ours/mutations/instructor*.
// Kept transport-agnostic via the InstructorAuthClient interface so the
// real Convex React client can adapt to it without forcing a
// convex-react import into this file (tests use a fake client).
export interface InstructorAuthClient {
  beginRegistration(args: {
    username: string;
    displayName: string;
  }): Promise<unknown>;
  completeRegistration(args: {
    username: string;
    response: unknown;
  }): Promise<unknown>;
  beginAuthentication(args: { username: string }): Promise<unknown>;
  completeAuthentication(args: {
    username: string;
    response: unknown;
  }): Promise<unknown>;
}

export async function registerInstructor(
  client: InstructorAuthClient,
  args: { username: string; displayName: string },
): Promise<unknown> {
  const options = await client.beginRegistration(args);
  const response = await startRegistration({
    // @simplewebauthn/browser v13 expects the options under `optionsJSON`.
    optionsJSON: options as Parameters<typeof startRegistration>[0]['optionsJSON'],
  });
  return client.completeRegistration({ username: args.username, response });
}

export async function authenticateInstructor(
  client: InstructorAuthClient,
  args: { username: string },
): Promise<unknown> {
  const options = await client.beginAuthentication(args);
  const response = await startAuthentication({
    optionsJSON: options as Parameters<typeof startAuthentication>[0]['optionsJSON'],
  });
  return client.completeAuthentication({ username: args.username, response });
}
