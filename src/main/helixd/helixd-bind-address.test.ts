import { describe, expect, it } from 'vitest'
import {
  bindHostIsNetworkExposed,
  describeHelixdBindExposure,
  HELIXD_LOOPBACK_BIND_HOST,
  HelixdBindAddressError,
  resolveHelixdBindHost
} from './helixd-bind-address'

describe('resolveHelixdBindHost', () => {
  it('defaults to loopback when the operator asked for nothing', () => {
    expect(resolveHelixdBindHost()).toBe(HELIXD_LOOPBACK_BIND_HOST)
    expect(HELIXD_LOOPBACK_BIND_HOST).toBe('127.0.0.1')
  })

  it('accepts literal IPv4 and IPv6 addresses, including explicit wide binds', () => {
    expect(resolveHelixdBindHost('0.0.0.0')).toBe('0.0.0.0')
    expect(resolveHelixdBindHost('10.1.2.3')).toBe('10.1.2.3')
    expect(resolveHelixdBindHost('::1')).toBe('::1')
    expect(resolveHelixdBindHost('localhost')).toBe('127.0.0.1')
    expect(resolveHelixdBindHost(' 127.0.0.1 ')).toBe('127.0.0.1')
  })

  it('refuses hostnames, because DNS would decide which interface got bound', () => {
    expect(() => resolveHelixdBindHost('internal.example')).toThrow(HelixdBindAddressError)
    expect(() => resolveHelixdBindHost('')).toThrow(HelixdBindAddressError)
    expect(() => resolveHelixdBindHost('0.0.0.0:80')).toThrow(HelixdBindAddressError)
  })
})

describe('bindHostIsNetworkExposed', () => {
  it('separates local-only addresses from network-reachable ones', () => {
    expect(bindHostIsNetworkExposed('127.0.0.1')).toBe(false)
    expect(bindHostIsNetworkExposed('127.5.5.5')).toBe(false)
    expect(bindHostIsNetworkExposed('::1')).toBe(false)
    expect(bindHostIsNetworkExposed('0.0.0.0')).toBe(true)
    expect(bindHostIsNetworkExposed('::')).toBe(true)
    expect(bindHostIsNetworkExposed('10.1.2.3')).toBe(true)
  })

  it('says out loud when a deployment is reachable from the network', () => {
    expect(describeHelixdBindExposure('0.0.0.0')).toContain('reachable from the network')
    expect(describeHelixdBindExposure('127.0.0.1')).toContain('local only')
  })
})
