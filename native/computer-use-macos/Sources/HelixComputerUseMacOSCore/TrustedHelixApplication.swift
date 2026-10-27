/// Bundle ids of the apps whose computer-use sidecar may drive this helper.
public enum TrustedHelixApplication {
    public static func isTrusted(bundleId: String) -> Bool {
        // Why: `pnpm dev` launches as `com.helixbio.helix.dev` and per-worktree wrapper apps use
        // `com.helixbio.helix.dev.<name>`; the sidecar peer check must authorize both.
        bundleId == "com.helixbio.helix" ||
            bundleId == "com.helixbio.helix.dev" ||
            bundleId.hasPrefix("com.helixbio.helix.dev.") ||
            bundleId == "com.github.Electron"
    }
}
