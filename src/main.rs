use wonderland_plugin_sdk::serve;

mod commands;

const PLUGIN_ID: &str = "wla_template_plugin";
const PLUGIN_NAME: &str = "Wonderland Plugin Template";
const PLUGIN_VERSION: &str = env!("CARGO_PKG_VERSION");

fn main() {
    if let Err(error) = serve(
        PLUGIN_ID,
        PLUGIN_VERSION,
        include_str!("../package/contract.json"),
        commands::dispatch,
    ) {
        eprintln!("plugin protocol stopped: {error}");
        std::process::exit(1);
    }
}
