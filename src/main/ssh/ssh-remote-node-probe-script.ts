// Probe all plausible Node paths directly, independent of shell startup-file behavior.

// sshd exec lacks profile-only MISE_DATA_DIR/NVM_DIR; read relocated data-dir assignments from dotfiles.
export const REMOTE_NODE_PATH_PROBE_SCRIPT = `
command -v node 2>/dev/null
helix_dotfile_dirs() {
  helix_var_name=$1
  helix_dirs=$2
  for helix_file in "$HOME/.profile" "$HOME/.bash_profile" "$HOME/.bashrc" "$HOME/.zprofile" "$HOME/.zshrc"
  do
    [ -r "$helix_file" ] || continue
    helix_dir_from_file=$(sed -n "s/^[[:space:]]*export[[:space:]][[:space:]]*$helix_var_name[[:space:]]*=[[:space:]]*//p; s/^[[:space:]]*$helix_var_name[[:space:]]*=[[:space:]]*//p" "$helix_file" | tail -n 1)
    case "$helix_dir_from_file" in
      \\"*\\") helix_dir_from_file=\${helix_dir_from_file#\\"}; helix_dir_from_file=\${helix_dir_from_file%%\\"*} ;;
      \\'*\\') helix_dir_from_file=\${helix_dir_from_file#\\'}; helix_dir_from_file=\${helix_dir_from_file%%\\'*} ;;
      *) helix_dir_from_file=\${helix_dir_from_file%%[[:space:]]*} ;;
    esac
    case "$helix_dir_from_file" in
      '$XDG_DATA_HOME'*) helix_dir_from_file="\${XDG_DATA_HOME:-$HOME/.local/share}\${helix_dir_from_file#'$XDG_DATA_HOME'}" ;;
      '$HOME'*) helix_dir_from_file="$HOME\${helix_dir_from_file#'$HOME'}" ;;
      "~/"*) helix_dir_from_file="$HOME/\${helix_dir_from_file#\\~/}" ;;
    esac
    [ -n "$helix_dir_from_file" ] && helix_dirs="$helix_dirs
$helix_dir_from_file"
  done
  printf '%s\\n' "$helix_dirs"
}
nvm_dirs=\${NVM_DIR:-"$HOME/.nvm"}
nvm_dirs=$(helix_dotfile_dirs NVM_DIR "$nvm_dirs")
printf '%s\\n' "$nvm_dirs" | while IFS= read -r nvm_dir
do
  [ -n "$nvm_dir" ] || continue
  for candidate in "$nvm_dir"/versions/node/*/bin/node
  do
    [ -x "$candidate" ] && printf '%s\\n' "$candidate"
  done
done
mise_dirs=\${MISE_DATA_DIR:-\${XDG_DATA_HOME:-$HOME/.local/share}/mise}
mise_dirs=$(helix_dotfile_dirs MISE_DATA_DIR "$mise_dirs")
printf '%s\\n' "$mise_dirs" | while IFS= read -r mise_dir
do
  [ -n "$mise_dir" ] || continue
  [ -x "$mise_dir/shims/node" ] && printf '%s\\n' "$mise_dir/shims/node"
  for candidate in "$mise_dir"/installs/node/*/bin/node
  do
    [ -x "$candidate" ] && printf '%s\\n' "$candidate"
  done
done
for candidate in \\
  /usr/local/bin/node \\
  /opt/homebrew/bin/node \\
  "$HOME/.local/bin/node" \\
  "$HOME/.fnm/aliases/default/bin/node" \\
  "$HOME/.fnm/node-versions"/*/installation/bin/node \\
  "$HOME/.local/share/fnm/node-versions"/*/installation/bin/node \\
  "$HOME/.local/share/mise/shims/node" \\
  "$HOME/.local/share/mise/installs/node"/*/bin/node \\
  "$HOME/.asdf/shims/node" \\
  "$HOME/.asdf/installs/nodejs"/*/bin/node \\
  "$HOME/.volta/bin/node" \\
  /usr/local/n/versions/node/*/bin/node
do
  [ -x "$candidate" ] && printf '%s\\n' "$candidate"
done
true
`
