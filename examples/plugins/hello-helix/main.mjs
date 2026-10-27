// Sample plugin runs in a lazily forked plain-Node worker; its default export receives commands, events and capability-gated host API.
export default function activate(helix) {
  helix.commands.register('hello-ping', async (args) => {
    const stored = await helix.host.call('storage.get', { key: 'pings' })
    const count = (typeof stored?.value === 'number' ? stored.value : 0) + 1
    await helix.host.call('storage.set', { key: 'pings', value: count })
    return { pong: true, count, args: args ?? null }
  })

  helix.events.on('worktree.created', async (payload) => {
    helix.log(`worktree created: ${payload.worktreeId} at ${payload.path}`)
    await helix.host.call('notifications.show', {
      title: 'Worktree created',
      body: payload.path
    })
  })

  helix.events.on('agent.status.changed', (payload) => {
    helix.log(`agent status: ${payload.state} in ${payload.worktreeId ?? 'unknown worktree'}`)
  })
}
