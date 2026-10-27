import { describe, expect, it } from 'vitest'
import {
  classifyWslHelixdLiveness,
  nextWslLivenessProbe,
  type WslLivenessEvidence
} from './wsl-helixd-liveness-verdict'

const INSTANCE = 'boot-a:100'
const HELIXD = '321:5000'

function evidence(overrides: Partial<WslLivenessEvidence> = {}): WslLivenessEvidence {
  return {
    trigger: { source: 'bridge', code: 1 },
    running: { status: 'confirmed', running: true },
    expected: { distroInstance: INSTANCE, helixd: HELIXD },
    ...overrides
  }
}

describe('classifyWslHelixdLiveness', () => {
  it('reads a failed running-list probe as unverifiable, never exited, whatever the exit code', () => {
    for (const code of [0, 1, null]) {
      const verdict = classifyWslHelixdLiveness(
        evidence({ trigger: { source: 'bridge', code }, running: { status: 'unavailable' } })
      )
      expect(verdict).toEqual({ kind: 'unverifiable', reason: 'running-list-unavailable' })
    }
  })

  it('marks every terminal exited when the distro is confirmed stopped', () => {
    const verdict = classifyWslHelixdLiveness(
      evidence({ running: { status: 'confirmed', running: false } })
    )
    expect(verdict).toEqual({ kind: 'distro-stopped', corroborated: true })
  })

  it('needs no exit code to prove a stop, but only a failed exit corroborates it', () => {
    const stopped = { status: 'confirmed', running: false } as const
    expect(
      classifyWslHelixdLiveness(evidence({ trigger: { source: 'verify' }, running: stopped }))
    ).toEqual({ kind: 'distro-stopped', corroborated: false })
    expect(
      classifyWslHelixdLiveness(
        evidence({ trigger: { source: 'holder', code: 0 }, running: stopped })
      )
    ).toEqual({ kind: 'distro-stopped', corroborated: false })
  })

  it('treats a running distro whose guest did not answer as unverifiable', () => {
    expect(classifyWslHelixdLiveness(evidence({ identity: null }))).toEqual({
      kind: 'unverifiable',
      reason: 'guest-unanswered'
    })
  })

  it('proves a restart from a new boot id or pid 1 start time, without any wall clock', () => {
    const verdict = classifyWslHelixdLiveness(
      evidence({ identity: { distroInstance: 'boot-a:900', helixd: null } })
    )
    expect(verdict).toEqual({ kind: 'distro-restarted' })
  })

  it('reads a gone or reused helixd pid in the same incarnation as helixd exited', () => {
    for (const helixd of [null, '321:7777']) {
      const verdict = classifyWslHelixdLiveness(
        evidence({
          trigger: { source: 'bridge', code: 0 },
          identity: { distroInstance: INSTANCE, helixd }
        })
      )
      expect(verdict).toEqual({ kind: 'helixd-exited' })
    }
  })

  it('keeps helixd live when the same process still runs, even after a bridge exit', () => {
    expect(
      classifyWslHelixdLiveness(
        evidence({
          trigger: { source: 'bridge', code: 0 },
          identity: { distroInstance: INSTANCE, helixd: HELIXD }
        })
      )
    ).toEqual({ kind: 'live' })
  })

  it('falls back to the port when no helixd pid was known', () => {
    const base = evidence({
      expected: { distroInstance: INSTANCE, helixd: null },
      identity: { distroInstance: INSTANCE, helixd: null }
    })
    expect(classifyWslHelixdLiveness({ ...base, helixdPort: 'ready' })).toEqual({ kind: 'live' })
    expect(classifyWslHelixdLiveness({ ...base, helixdPort: 'refused' })).toEqual({
      kind: 'helixd-exited'
    })
    expect(classifyWslHelixdLiveness({ ...base, helixdPort: 'unverifiable' })).toEqual({
      kind: 'unverifiable',
      reason: 'helixd-unanswered'
    })
  })
})

describe('nextWslLivenessProbe', () => {
  it('never probes inside a distro that is not confirmed running (an exec would boot it)', () => {
    expect(nextWslLivenessProbe(evidence({ running: { status: 'unavailable' } }))).toBeNull()
    expect(
      nextWslLivenessProbe(evidence({ running: { status: 'confirmed', running: false } }))
    ).toBeNull()
  })

  it('asks for identity first, and for the port only when no pid identity can decide', () => {
    expect(nextWslLivenessProbe(evidence())).toBe('identity')
    expect(
      nextWslLivenessProbe(evidence({ identity: { distroInstance: INSTANCE, helixd: HELIXD } }))
    ).toBeNull()
    const noPid = evidence({
      expected: { distroInstance: INSTANCE, helixd: null },
      identity: { distroInstance: INSTANCE, helixd: null }
    })
    expect(nextWslLivenessProbe(noPid)).toBe('helixd-port')
    expect(nextWslLivenessProbe({ ...noPid, helixdPort: 'refused' })).toBeNull()
    expect(
      nextWslLivenessProbe({ ...noPid, identity: { distroInstance: 'other', helixd: null } })
    ).toBeNull()
  })
})
