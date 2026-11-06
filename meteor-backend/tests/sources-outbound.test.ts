/**
 * Where the backend may send a request for a server an org registered (#734):
 * any public https server, with no deployment list and no restart, but never
 * one on a private network unless the deployment allows that once.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { redmineUrlRefusal } from '../server/redmine-client';
import { isPrivateAddress, outboundRefusal } from '../server/sources/outbound';
import { withEnv } from './env';

/** A resolver answering `addresses` for every host. */
const resolvesTo =
  (...addresses: string[]) =>
  async () =>
    addresses.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }));

const production = (resolve = resolvesTo('203.0.113.7')) => ({ production: true, resolve });

describe('isPrivateAddress', () => {
  it.each([
    '10.0.0.5',
    '127.0.0.1',
    '169.254.169.254',
    '172.16.4.2',
    '192.168.1.1',
    '100.64.0.1',
    '0.0.0.0',
    '::1',
    '::',
    'fd00::1',
    'fe80::1',
    '::ffff:10.0.0.1',
    '::ffff:169.254.169.254',
    'not-an-ip',
  ])('counts %s as private', (address) => {
    expect(isPrivateAddress(address)).toBe(true);
  });

  it.each(['203.0.113.7', '8.8.8.8', '2606:4700::1111', '::ffff:8.8.8.8'])(
    'counts %s as public',
    (address) => {
      expect(isPrivateAddress(address)).toBe(false);
    },
  );
});

describe('outboundRefusal', () => {
  let restore = () => {};
  afterEach(() => restore());

  it('allows anything outside production, so stand-in servers run on localhost', async () => {
    expect(await outboundRefusal('http://localhost:3995', { production: false })).toBeNull();
  });

  it('allows any public https server, with no list to add it to', async () => {
    expect(await outboundRefusal('https://redmine.acme.com/redmine', production())).toBeNull();
  });

  it('requires https', async () => {
    expect(await outboundRefusal('http://redmine.acme.com', production())).toMatch(/https/);
  });

  it('refuses a host that resolves to a private or metadata address, even alongside a public one', async () => {
    for (const address of ['10.1.2.3', '169.254.169.254', '::1']) {
      expect(
        await outboundRefusal('https://redmine.acme.com', production(resolvesTo('203.0.113.7', address))),
      ).toMatch(/private network/);
    }
  });

  it('refuses a private address written into the URL itself', async () => {
    const resolve = vi.fn();
    expect(await outboundRefusal('https://169.254.169.254', { production: true, resolve })).toMatch(
      /private network/,
    );
    expect(await outboundRefusal('https://[::1]:8443', { production: true, resolve })).toMatch(
      /private network/,
    );
    expect(resolve).not.toHaveBeenCalled();
  });

  it('refuses a host that cannot be found', async () => {
    const resolve = async () => {
      throw Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' });
    };
    expect(await outboundRefusal('https://nowhere.acme.com', { production: true, resolve })).toMatch(
      /could not be found/,
    );
  });

  it('allows private servers once the deployment says so', async () => {
    restore = withEnv({ SOURCES_ALLOW_PRIVATE_HOSTS: 'true' });
    expect(
      await outboundRefusal('https://redmine.internal', production(resolvesTo('10.1.2.3'))),
    ).toBeNull();
  });
});

describe('a Redmine server in production', () => {
  let restore = () => {};
  afterEach(() => restore());

  it("keeps the deployment's own Redmine working when it is internal", async () => {
    restore = withEnv({
      NODE_ENV: 'production',
      REDMINE_BASE_URL: 'https://10.0.0.8',
      SOURCES_ALLOW_PRIVATE_HOSTS: undefined,
    });
    expect(await redmineUrlRefusal('https://10.0.0.8')).toBeNull();
    expect(await redmineUrlRefusal('https://10.0.0.9')).toMatch(/private network/);
  });
});
