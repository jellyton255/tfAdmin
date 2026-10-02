import { BlockList, isIP } from 'node:net';

/**
 * Normalizes an IPv4-mapped IPv6 address (::ffff:1.2.3.4) to plain IPv4.
 */
export const normalizeIp = (ip: string) => {
    if (typeof ip !== 'string') return '';
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
    return mapped ? mapped[1] : ip;
};


/**
 * Parses one allowlist entry (plain IP or CIDR) into a BlockList, or returns null if invalid.
 */
const addEntry = (list: BlockList, entry: string): boolean => {
    const [addr, prefixStr] = entry.split('/');
    const family = isIP(addr);
    if (!family) return false;
    const type = family === 4 ? 'ipv4' : 'ipv6';
    if (prefixStr === undefined) {
        list.addAddress(addr, type);
        return true;
    }
    const prefix = Number(prefixStr);
    const maxPrefix = family === 4 ? 32 : 128;
    if (!Number.isInteger(prefix) || prefix < 0 || prefix > maxPrefix) return false;
    list.addSubnet(addr, prefix, type);
    return true;
};


/**
 * Returns the entries that are not valid IPs or CIDRs.
 */
export const invalidIpEntries = (entries: string[]) => {
    const list = new BlockList();
    return entries.filter((e) => !addEntry(list, e));
};


/**
 * Checks whether an IP matches any entry of the allowlist.
 * Invalid entries are ignored; an empty list allows everything.
 */
export const isIpAllowed = (remoteIp: string, allowed: string[]): boolean => {
    if (!allowed.length) return true;
    const ip = normalizeIp(remoteIp);
    const family = isIP(ip);
    if (!family) return false;
    const list = new BlockList();
    for (const entry of allowed) addEntry(list, entry);
    return list.check(ip, family === 4 ? 'ipv4' : 'ipv6');
};
