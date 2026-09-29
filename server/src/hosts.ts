import net from 'node:net';

/**
 * Only the names a server on a home network is normally reached by. A web page can point its own
 * domain at your NAS (DNS rebinding) and read the board as you, but not one of these.
 */
const LOCAL_SUFFIXES = ['.local', '.lan', '.home.arpa', '.internal', '.localdomain'];

/** The name in a Host header: lower case, no port, no brackets. Null if it isn't a valid host. */
export function hostName(header: string): string | null {
  const h = header.trim().toLowerCase();
  if (h.startsWith('[')) {
    const end = h.indexOf(']');
    if (end < 0 || !/^(:\d{0,5})?$/.test(h.slice(end + 1))) return null;
    const address = h.slice(1, end);
    return net.isIPv6(address) ? address : null;
  }
  const [name, port = '', ...extra] = h.split(':');
  // Several colons and no brackets: not valid in a Host header, but harmless if it's an address.
  if (extra.length) return net.isIPv6(h) ? h : null;
  if (!/^\d{0,5}$/.test(port)) return null;
  const bare = name.replace(/\.$/, ''); // "diskstation." is the same name
  return /^[a-z0-9_-]+(\.[a-z0-9_-]+)*$/.test(bare) ? bare : null;
}

/**
 * HEARTHBOARD_ALLOWED_HOSTS: comma-separated names. `*.example.com` means that domain and its
 * subdomains, and `*` turns the check off.
 */
export function parseAllowedHosts(value: string | undefined): string[] {
  const list: string[] = [];
  for (const raw of (value ?? '').split(',')) {
    // Be forgiving about a pasted address: drop "https://", a port and a path.
    const entry = raw
      .trim()
      .toLowerCase()
      .replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
      .replace(/\/.*$/, '');
    if (entry === '*') list.push('*');
    else if (entry.startsWith('*.')) {
      const domain = hostName(entry.slice(2));
      if (domain) list.push(`*.${domain}`);
    } else {
      const name = entry && hostName(entry);
      if (name) list.push(name);
    }
  }
  return list;
}

/** The host of the public address saved in Settings, if there is one. */
export function publicHost(publicUrl: string | null): string | null {
  if (!publicUrl) return null;
  try {
    return hostName(new URL(publicUrl).host);
  } catch {
    return null;
  }
}

/**
 * Whether Hearthboard should answer a request with this Host header. `getPublicHost` is only asked
 * when nothing cheaper matched, since it reads the saved settings.
 */
export function hostAllowed(header: string, allowed: string[], getPublicHost: () => string | null) {
  const name = hostName(header);
  if (!name) return false;
  if (net.isIP(name) || name === 'localhost' || !name.includes('.')) return true;
  if (LOCAL_SUFFIXES.some((s) => name.endsWith(s))) return true;
  for (const entry of allowed) {
    if (
      entry.startsWith('*.')
        ? name === entry.slice(2) || name.endsWith(entry.slice(1))
        : name === entry
    )
      return true;
  }
  return name === getPublicHost();
}

/** The plain-text page for a refused request. */
export function hostRefusal(header: string): string {
  const shown = header.replace(/[^\x20-\x7e]/g, '').slice(0, 100);
  return (
    `Hearthboard doesn't recognise the address "${shown}", so it won't show anything here.\n\n` +
    `If it is your address, add it to HEARTHBOARD_ALLOWED_HOSTS in the container's settings, ` +
    `or enter it as the public address in Settings, under General.\n\n` +
    `You can still open the board by its IP address, for example http://192.168.1.20:8080/.\n`
  );
}
