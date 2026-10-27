import Testing
@testable import HelixComputerUseMacOSCore

@Suite("TrustedHelixApplication")
struct TrustedHelixApplicationTests {
    @Test("trusts the packaged app, every dev build and stock Electron")
    func trusted() {
        #expect(TrustedHelixApplication.isTrusted(bundleId: "com.helixbio.helix"))
        // What `pnpm dev` launches as: DEV_BUNDLE_ID in dev-electron-bundle-identity.mjs.
        #expect(TrustedHelixApplication.isTrusted(bundleId: "com.helixbio.helix.dev"))
        #expect(TrustedHelixApplication.isTrusted(bundleId: "com.helixbio.helix.dev.worktree"))
        #expect(TrustedHelixApplication.isTrusted(bundleId: "com.github.Electron"))
    }

    @Test("rejects look-alike and unrelated bundle ids")
    func untrusted() {
        #expect(!TrustedHelixApplication.isTrusted(bundleId: "com.helixbio.helix.devtools"))
        #expect(!TrustedHelixApplication.isTrusted(bundleId: "com.helixbio.helixx"))
        #expect(!TrustedHelixApplication.isTrusted(bundleId: "com.example.helix"))
        #expect(!TrustedHelixApplication.isTrusted(bundleId: ""))
    }
}
