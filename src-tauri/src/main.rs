// Prevents a terminal window from opening on Windows release builds
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    xfinder_lib::run()
}
