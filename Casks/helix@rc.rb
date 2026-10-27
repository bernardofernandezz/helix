cask "helix@rc" do
  arch arm: "arm64", intel: "x64"

  version "0.1.0"
  sha256 :no_check

  url "https://github.com/bernardofernandezz/helix/releases/download/v#{version}/helix-macos-#{arch}.dmg"
  name "Helix RC"
  desc "Agentic research environment for the life sciences"
  homepage "https://github.com/bernardofernandezz/helix"

  livecheck do
    url "https://github.com/bernardofernandezz/helix"
    regex(/^v?(\d+(?:\.\d+)+-rc\.\d+)$/i)
    strategy :github_releases do |json, regex|
      json.map do |release|
        next if release["draft"]
        next unless release["prerelease"]

        match = release["tag_name"]&.match(regex)
        next if match.blank?

        match[1]
      end
    end
  end

  # Use Helix’s prerelease-aware updater between frequent RCs.
  auto_updates true
  conflicts_with cask: "helix"
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
