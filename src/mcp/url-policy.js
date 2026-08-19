function normalizedHostname(hostname) {
  if (typeof hostname !== 'string') return ''
  let value = hostname.trim().toLowerCase()
  if (value.startsWith('[') && value.endsWith(']')) value = value.slice(1, -1)
  return value.endsWith('.') ? value.slice(0, -1) : value
}

function isIpv4Loopback(hostname) {
  const parts = hostname.split('.')
  return parts.length === 4
    && parts.every(part => /^(?:0|[1-9]\d{0,2})$/.test(part) && Number(part) <= 255)
    && Number(parts[0]) === 127
}

function ipv6Words(hostname) {
  if (!hostname.includes(':') || hostname.includes('%')) return undefined
  const halves = hostname.split('::')
  if (halves.length > 2) return undefined
  const left = halves[0] === '' ? [] : halves[0].split(':')
  const right = halves.length === 1 || halves[1] === '' ? [] : halves[1].split(':')
  if ([...left, ...right].some(word => !/^[0-9a-f]{1,4}$/.test(word))) return undefined
  const missing = 8 - left.length - right.length
  if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) return undefined
  return [...left, ...Array.from({ length: missing }, () => '0'), ...right].map(word => Number.parseInt(word, 16))
}

function isIpv6Loopback(hostname) {
  const words = ipv6Words(hostname)
  if (words === undefined) return false
  if (words.slice(0, 7).every(word => word === 0) && words[7] === 1) return true

  // IPv4-compatible and IPv4-mapped loopback addresses remain bound to 127/8.
  const compatible = words.slice(0, 6).every(word => word === 0)
  const mapped = words.slice(0, 5).every(word => word === 0) && words[5] === 0xffff
  return (compatible || mapped) && (words[6] >>> 8) === 127
}

/** True only for hostnames whose meaning is explicitly limited to this machine. */
export function isExplicitLoopbackHostname(hostname) {
  const normalized = normalizedHostname(hostname)
  return normalized === 'localhost'
    || normalized.endsWith('.localhost')
    || isIpv4Loopback(normalized)
    || isIpv6Loopback(normalized)
}

/** Plain HTTP is permitted only for an explicit loopback hostname. */
export function mcpHttpUrlUsesSecureTransport(url) {
  return url?.protocol === 'https:'
    || (url?.protocol === 'http:' && isExplicitLoopbackHostname(url.hostname))
}
