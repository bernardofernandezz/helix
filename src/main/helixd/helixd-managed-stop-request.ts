import { createHash } from 'node:crypto'
import { lstatSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { readNodeFileSyncWithinLimit } from '../../shared/node-bounded-file-reader'
import {
  HELIXD_MANAGED_STOP_REQUEST_MAX_BYTES,
  HELIXD_MANAGED_STOP_REQUEST_PREFIX,
  HelixdManagedStopRequestSchema,
  type HelixdManagedStopContext,
  type HelixdManagedStopInstance,
  type HelixdManagedStopRequest
} from '../../shared/helixd-stop-request'
import { readHelixdInstanceLockRecord, type HelixdLockRecord } from './helixd-instance-lock'

/** Nonce-scoped paths prevent requests from addressing a previous instance. */
export function helixdManagedStopRequestPath(instance: HelixdManagedStopInstance): string {
  const digest = createHash('sha256').update(instance.nonce).digest('hex')
  return join(dirname(instance.lockPath), `${HELIXD_MANAGED_STOP_REQUEST_PREFIX}.${digest}`)
}

export function readHelixdManagedStopRequest(path: string): HelixdManagedStopRequest {
  if (!lstatSync(path).isFile()) {
    throw new Error('helixd_managed_stop_request_not_regular_file')
  }
  const { buffer } = readNodeFileSyncWithinLimit(path, HELIXD_MANAGED_STOP_REQUEST_MAX_BYTES)
  return HelixdManagedStopRequestSchema.parse(JSON.parse(buffer.toString('utf8')))
}

function sameHelixdManagedStopInstance(
  left: HelixdManagedStopInstance,
  right: Pick<HelixdManagedStopInstance, 'pid' | 'startedAtMs' | 'nonce'>
): boolean {
  return (
    left.pid === right.pid && left.startedAtMs === right.startedAtMs && left.nonce === right.nonce
  )
}

export function helixdInstanceLockNames(instance: HelixdManagedStopInstance): boolean {
  return readHelixdInstanceLockNaming(instance) !== null
}

export function readHelixdInstanceLockNaming(
  instance: HelixdManagedStopInstance
): HelixdLockRecord | null {
  if (!lstatSync(instance.lockPath).isFile()) {
    return null
  }
  const record = readHelixdInstanceLockRecord(instance.lockPath)
  return record !== null && sameHelixdManagedStopInstance(instance, record) ? record : null
}

export function validateHelixdManagedStopRequest(
  context: HelixdManagedStopContext,
  requestPath: string
): HelixdManagedStopRequest {
  const request = readHelixdManagedStopRequest(requestPath)
  if (
    request.version !== context.version ||
    request.runtimeId !== context.runtimeId ||
    // Windows clients and servers may use different separators for the same lock.
    resolve(request.instance.lockPath) !== resolve(context.instance.lockPath) ||
    !sameHelixdManagedStopInstance(request.instance, context.instance)
  ) {
    throw new Error('helixd_managed_stop_request_identity_mismatch')
  }
  if (!helixdInstanceLockNames(context.instance)) {
    throw new Error('helixd_managed_stop_instance_lock_changed')
  }
  return request
}
