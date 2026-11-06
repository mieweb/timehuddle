/**
 * Where the backend may send a request for a server someone typed in, one an
 * org registered or one a member linked (#734): the check a source's client
 * runs before it sends, so registering a server is enough to use it, with no
 * list of hosts to keep and no restart (`redmineUrlRefusal` for Redmine).
 *
 * Development is left alone: stand-in servers run on localhost over plain
 * http. In production the address must be https and its host must resolve only
 * to public addresses. Someone typed it, so without this the backend would
 * fetch internal machines, or the cloud's metadata service, for them. A
 * deployment whose servers are internal sets `SOURCES_ALLOW_PRIVATE_HOSTS=true`,
 * once.
 *
 * The check is on what the host resolves to just before the request: a host
 * that resolves differently by the time the connection opens (DNS rebinding)
 * isn't caught here.
 */
import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';

/** Addresses only a private network, the machine itself or the cloud's metadata service answers on. */
const PRIVATE = new BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
]) {
  PRIVATE.addSubnet(network, prefix, 'ipv4');
}
for (const [network, prefix] of [
  ['::', 127],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
]) {
  PRIVATE.addSubnet(network, prefix, 'ipv6');
}

/** Whether `address`, an IP, is one only a private network reaches. Anything else that isn't an IP is too. */
export function isPrivateAddress(address) {
  // An IPv4 address written as IPv6 (`::ffff:10.0.0.1`) reaches the IPv4 one.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  if (mapped) return PRIVATE.check(mapped[1], 'ipv4');
  const family = isIP(address);
  return family === 0 || PRIVATE.check(address, family === 4 ? 'ipv4' : 'ipv6');
}

/** Whether this deployment lets registered servers be on its private network. */
export function privateHostsAllowed() {
  return process.env.SOURCES_ALLOW_PRIVATE_HOSTS === 'true';
}

/**
 * Why the backend may not send to the registered server at `baseUrl`, or null
 * when it may. `production` and `resolve` are for tests.
 */
export async function outboundRefusal(
  baseUrl,
  { production = process.env.NODE_ENV === 'production', resolve = lookup } = {},
) {
  if (!production) return null;
  let url;
  try {
    url = new URL(baseUrl);
  } catch {
    return 'That is not a usable server address';
  }
  if (url.protocol !== 'https:') return 'A server must be reached over https';
  if (privateHostsAllowed()) return null;
  const host = url.hostname.replace(/^\[|\]$/g, '');
  let addresses;
  try {
    addresses = isIP(host) ? [{ address: host }] : await resolve(host, { all: true });
  } catch {
    return `${host} could not be found`;
  }
  if (!addresses.length || addresses.some(({ address }) => isPrivateAddress(address))) {
    return "That server is on a private network, which this deployment doesn't allow";
  }
  return null;
}
