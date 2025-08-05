use std::process::Command;

fn main() {
    // Tell Cargo to rerun this build script if any source files change
    println!("cargo:rerun-if-changed=src/");
    println!("cargo:rerun-if-changed=Cargo.toml");
    
    // Get the current git commit hash
    let output = Command::new("git")
        .args(&["rev-parse", "HEAD"])
        .output()
        .expect("Failed to execute git command");
    
    let git_hash = String::from_utf8(output.stdout)
        .expect("Invalid UTF-8 sequence from git")
        .trim()
        .to_string();
    
    // Get the current git commit hash (short version)
    let output_short = Command::new("git")
        .args(&["rev-parse", "--short", "HEAD"])
        .output()
        .expect("Failed to execute git command");
    
    let git_hash_short = String::from_utf8(output_short.stdout)
        .expect("Invalid UTF-8 sequence from git")
        .trim()
        .to_string();
    
    // Set environment variables that will be available in the binary
    println!("cargo:rustc-env=GIT_HASH={}", git_hash);
    println!("cargo:rustc-env=GIT_HASH_SHORT={}", git_hash_short);
    
    // Get build timestamp
    let build_time = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S UTC").to_string();
    println!("cargo:rustc-env=BUILD_TIME={}", build_time);
}