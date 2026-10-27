//! Launches the Helix CLI by running the packaged Electron binary as Node.
//!
//! Why a native binary rather than the `.cmd` alone: `cmd.exe` reparses `%*` and
//! executes or truncates embedded newlines, so orchestration message bodies
//! cannot survive it. `helix.cmd` refuses those subcommands and defers
//! here.
//!
//! Why not a managed assembly: a small freshly-compiled MSIL image in a
//! user-writable directory that mutates environment variables and proxies a
//! child process is the shape antivirus MSIL heuristics are trained on, and it
//! was flagged as exactly that across several vendors.
//!
//! On a Windows server host, helixd copies this binary into its profile and
//! writes `helix-launcher.cfg` beside it; that file selects the server mode.

use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{exit, Command};

const SERVER_CONFIG_FILENAME: &str = "helix-launcher.cfg";

#[cfg(windows)]
mod administrator_status;

fn main() {
    #[cfg(windows)]
    administrator_status::run_if_requested();
    let launcher = match env::current_exe() {
        Ok(path) => path,
        Err(error) => fail(&format!("Unable to start the Helix CLI: {error}")),
    };
    if let Some(config) = launcher
        .parent()
        .map(|directory| directory.join(SERVER_CONFIG_FILENAME))
        .filter(|config| config.is_file())
    {
        run_server_cli(&config);
    }

    let Some(resources_directory) = launcher.parent().and_then(Path::parent) else {
        fail(&format!(
            "Unable to locate Helix.exe next to \"{}\"",
            launcher.display()
        ))
    };
    let Some(app_directory) = resources_directory.parent() else {
        fail(&format!(
            "Unable to locate Helix.exe next to \"{}\"",
            resources_directory.display()
        ))
    };

    let electron_path = app_directory.join("Helix.exe");
    if !electron_path.is_file() {
        fail(&format!(
            "Unable to locate Helix.exe next to \"{}\"",
            resources_directory.display()
        ));
    }

    let cli_path: PathBuf = resources_directory
        .join("app.asar.unpacked")
        .join("out")
        .join("cli")
        .join("index.js");
    if !cli_path.is_file() {
        fail(&format!(
            "Unable to locate the Helix CLI entrypoint at \"{}\"",
            cli_path.display()
        ));
    }

    // Preserve duplicate PATH/Path entries by inheriting this process’s environment verbatim; an explicit map broke.
    move_environment_variable("NODE_OPTIONS", "HELIX_NODE_OPTIONS");
    move_environment_variable(
        "NODE_REPL_EXTERNAL_MODULE",
        "HELIX_NODE_REPL_EXTERNAL_MODULE",
    );
    env::set_var("ELECTRON_RUN_AS_NODE", "1");
    env::set_var("HELIX_WINDOWS_PACKAGED_CLI_LAUNCHER", "1");
    let requested_command = env::var("HELIX_CLI_COMMAND").unwrap_or_default();
    env::set_var(
        "HELIX_CLI_COMMAND",
        if requested_command == "helix-ide" {
            "helix-ide"
        } else {
            "helix"
        },
    );

    run_cli(&electron_path, &cli_path)
}

/// The server mode: the pinned Node runs the active slot's CLI under the
/// server's profile, as the POSIX launcher does.
fn run_server_cli(config_path: &Path) -> ! {
    let config = fs::read_to_string(config_path).unwrap_or_else(|error| {
        fail(&format!(
            "Unable to read the Helix CLI configuration at \"{}\": {error}",
            config_path.display()
        ))
    });
    let node_path = PathBuf::from(config_value(&config, "node", config_path));
    let cli_path = PathBuf::from(config_value(&config, "cli", config_path));
    let user_data_path = config_value(&config, "user-data", config_path);
    for path in [&node_path, &cli_path] {
        if !path.is_file() {
            fail(&format!(
                "Unable to locate \"{}\"; reconnect to the Helix server to refresh the CLI",
                path.display()
            ));
        }
    }
    env::set_var("HELIX_USER_DATA_PATH", user_data_path);
    for name in [
        "NODE_OPTIONS",
        "NODE_REPL_EXTERNAL_MODULE",
        "ELECTRON_RUN_AS_NODE",
        // A server started by the desktop's `helix serve` inherits this marker, which would make
        // orchestration demand a bare `helix` resume command.
        "HELIX_WINDOWS_PACKAGED_CLI_LAUNCHER",
    ] {
        env::remove_var(name);
    }
    run_cli(&node_path, &cli_path)
}

fn config_value<'a>(config: &'a str, key: &str, config_path: &Path) -> &'a str {
    config
        .lines()
        .find_map(|line| {
            line.split_once('=')
                .filter(|(name, value)| *name == key && !value.is_empty())
                .map(|(_, value)| value)
        })
        .unwrap_or_else(|| {
            fail(&format!(
                "The Helix CLI configuration at \"{}\" has no {key}",
                config_path.display()
            ))
        })
}

fn run_cli(program: &Path, cli_path: &Path) -> ! {
    // Each argument stays its own argv entry, so a body holding newlines reaches
    // the CLI intact.
    let mut command = Command::new(program);
    command.arg(cli_path).args(env::args_os().skip(1));

    match command.status() {
        Ok(status) => exit(status.code().unwrap_or(1)),
        Err(error) => fail(&format!("Unable to start the Helix CLI: {error}")),
    }
}

fn move_environment_variable(source_name: &str, target_name: &str) {
    match env::var_os(source_name) {
        // A missing source clears the target, so a stale value cannot leak in.
        None => env::remove_var(target_name),
        Some(value) => {
            env::remove_var(source_name);
            env::set_var(target_name, value);
        }
    }
}

fn fail(message: &str) -> ! {
    eprintln!("{message}");
    exit(1)
}
