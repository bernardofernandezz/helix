cask "helix" do
  arch arm: "arm64", intel: "x64"

  version "0.1.0"
  sha256 :no_check

  url "https://github.com/bernardofernandezz/helix/releases/download/v#{version}/helix-macos-#{arch}.dmg"
  name "Helix"
  desc "Agentic research environment for the life sciences"
  homepage "https://github.com/bernardofernandezz/helix"

  livecheck do
    url :url
    strategy :github_latest
  end

  # Let the in-app updater own updates; Homebrew skips auto_updates unless --greedy.
  auto_updates true
  conflicts_with cask: "helix@rc"
  depends_on macos: :big_sur

  app "Helix.app"

  # Expose the symlink-resolving bundled CLI on PATH so headless hosts can use helix serve without the in-app installer.
  binary "#{appdir}/Helix.app/Contents/Resources/bin/helix"

  # Zap app-created ~/.helix and Electron userData for a clean uninstall.
  zap trash: [
    "~/.helix",
    "~/Library/Application Support/Helix",
    "~/Library/Caches/com.helixbio.helix",
    "~/Library/Caches/com.helixbio.helix.ShipIt",
    "~/Library/HTTPStorages/com.helixbio.helix",
    "~/Library/Preferences/com.helixbio.helix.plist",
    "~/Library/Saved Application State/com.helixbio.helix.savedState",
  ]
end
