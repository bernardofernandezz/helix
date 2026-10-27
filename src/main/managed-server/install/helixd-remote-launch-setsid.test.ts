import { execFileSync } from 'node:child_process'
import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { HELIXD_PID_FILENAME, HELIXD_READINESS_FILENAME } from './helixd-remote-host-support'
import { helixdLaunchCommand, type HelixdLaunchSpec } from './helixd-remote-launch'
import { getRemoteHostPlatform } from '../../ssh/ssh-remote-platform'
import { HELIXD_WSL_HOST_ENV } from '../../ipc/wsl-guest-windows-drive-path'

const host = getRemoteHostPlatform('linux-x64')

function spec(remoteInstallDir: string, nodePath = '/usr/bin/node'): HelixdLaunchSpec {
  return {
    remoteInstallDir,
    nodePath,
    fullVersion: '0.2.0+bb01',
    userDataDir: '/home/u/.helix',
    bindHost: '127.0.0.1',
    port: 7777,
    activationRoot: '/home/u/.helix-remote/.helixd-activation-transaction'
  }
}

describe('the WSL launch (setsid)', () => {
  const dirs: string[] = []
  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  // WSL without systemd can kill nohup children when wsl.exe exits; detach into a new session.
  it('never backgrounds under nohup, and starts the runtime in a session of its own', () => {
    const command = helixdLaunchCommand(
      host,
      spec('/home/u/.helix-remote/helixd-0.2.0+bb01'),
      'setsid'
    )
    expect(command).not.toContain('nohup')
    expect(command).toContain('setsid -f "$@"')
    // BusyBox lacks -f; background non-interactive children can still create their own session.
    expect(command).toContain('else setsid "$@" & fi')
    expect(command).toContain(`${HELIXD_WSL_HOST_ENV}=1 sh -c`)
  })

  it('has the child record its own PID, since the setsid -f parent exits at once', () => {
    const command = helixdLaunchCommand(host, spec('/d/helixd-1'), 'setsid')
    expect(command.startsWith(`helixd_pid='/d/helixd-1/${HELIXD_PID_FILENAME}';`)).toBe(true)
    const removeStale = command.indexOf('rm -f "$helixd_pid"')
    const recordOwn = command.indexOf(`echo $$ > "$1" && umask "$2" && shift 2 && exec "$@"`)
    expect(removeStale).toBeGreaterThan(-1)
    expect(recordOwn).toBeGreaterThan(removeStale)
    expect(command.trimEnd().endsWith('cat "$helixd_pid"')).toBe(true)
  })

  it('passes host facts the guest cannot read, quoted, and refuses a malformed name', () => {
    const command = helixdLaunchCommand(host, spec('/d/helixd-1'), 'setsid', [
      ['HELIX_WSL_DISTRO_GUID', "abc'd"]
    ])
    expect(command).toContain(`${HELIXD_WSL_HOST_ENV}=1 HELIX_WSL_DISTRO_GUID='abc'\\''d' sh -c`)
    expect(() =>
      helixdLaunchCommand(host, spec('/d/helixd-1'), 'setsid', [['BAD NAME', 'x']])
    ).toThrow('helixd_launch_env_name_invalid')
  })

  it('keeps the SSH launch byte-for-byte when no detach is named', () => {
    const ssh = helixdLaunchCommand(host, spec('/d/helixd-1'))
    expect(ssh).toBe(helixdLaunchCommand(host, spec('/d/helixd-1'), 'nohup'))
    expect(ssh).toContain('exec nohup "$helixd_runtime"')
    expect(ssh).not.toContain('setsid')
    expect(ssh).not.toContain(HELIXD_WSL_HOST_ENV)
  })

  it.skipIf(process.platform !== 'linux')(
    'really detaches: the recorded PID is the runtime, in a new session, and writes readiness',
    () => {
      const dir = mkdtempSync(join(tmpdir(), 'helixd-setsid-'))
      dirs.push(dir)
      const runtime = join(dir, 'fake-node')
      writeFileSync(runtime, `#!/bin/sh\necho '{"type":"helix_server_ready"}'\nsleep 30\n`)
      chmodSync(runtime, 0o755)
      const out = execFileSync('sh', [
        '-c',
        helixdLaunchCommand(host, spec(dir, runtime), 'setsid')
      ])
      const pid = Number(out.toString().trim())
      try {
        expect(Number.isSafeInteger(pid) && pid > 0).toBe(true)
        expect(readFileSync(join(dir, HELIXD_PID_FILENAME), 'utf8').trim()).toBe(String(pid))
        const ps = (field: string, target: number): string =>
          execFileSync('ps', ['-o', `${field}=`, '-p', String(target)])
            .toString()
            .trim()
        expect(ps('args', pid)).toContain(join(dir, 'helixd.js'))
        expect(ps('sid', pid)).toBe(String(pid))
        expect(ps('sid', pid)).not.toBe(ps('sid', process.pid))
        for (
          let i = 0;
          i < 50 && !readFileSync(join(dir, HELIXD_READINESS_FILENAME), 'utf8');
          i++
        ) {
          execFileSync('sleep', ['0.05'])
        }
        expect(readFileSync(join(dir, HELIXD_READINESS_FILENAME), 'utf8')).toContain(
          'helix_server_ready'
        )
      } finally {
        try {
          process.kill(pid)
        } catch {
          // Cleanup tolerates children already reaped.
        }
      }
    }
  )

  // Daemon children create user files and must retain login umask.
  it.skipIf(process.platform !== 'linux')(
    'runs the daemon at the login umask while its PID and readiness files stay owner-only',
    () => {
      const dir = mkdtempSync(join(tmpdir(), 'helixd-setsid-umask-'))
      dirs.push(dir)
      const runtime = join(dir, 'fake-node')
      writeFileSync(runtime, `#!/bin/sh\n: > daemon-file\necho '{"type":"helix_server_ready"}'\n`)
      chmodSync(runtime, 0o755)
      const command = helixdLaunchCommand(host, spec(dir, runtime), 'setsid')
      execFileSync('sh', ['-c', `umask 022; ${command}`])
      for (let i = 0; i < 50 && !readFileSync(join(dir, HELIXD_READINESS_FILENAME), 'utf8'); i++) {
        execFileSync('sleep', ['0.05'])
      }
      const mode = (name: string): number => statSync(join(dir, name)).mode & 0o777
      expect(mode('daemon-file')).toBe(0o644)
      expect(mode(HELIXD_PID_FILENAME)).toBe(0o600)
      expect(mode(HELIXD_READINESS_FILENAME)).toBe(0o600)
    }
  )
})
