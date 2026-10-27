// Listener widening persists and cannot reverse within the process; follow user-selected reach, not typed addresses.
// Custom loopback addresses may front SSH/proxies needing off-host access; this-computer must stay loopback.
export type RuntimePairingReach = 'this-computer' | 'network'
