let listener: (environmentId: string) => void | Promise<void> = () => {}

export function setManagedHelixdPairingRepairedListener(
  next: (environmentId: string) => void | Promise<void>
): void {
  listener = next
}

export function notifyManagedHelixdPairingRepaired(environmentId: string): void | Promise<void> {
  return listener(environmentId)
}
