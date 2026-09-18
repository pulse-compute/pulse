use std::{env, fs, path::PathBuf, process::Command};

fn run(command: &mut Command) {
    assert!(command.status().expect("C toolchain invocation failed").success(), "C toolchain failed");
}

fn main() {
    let zig = env::var("PULSE_RSA_ZIG").expect("PULSE_RSA_ZIG must select pinned Zig 0.13.0");
    let version = Command::new(&zig).arg("version").output().expect("Zig unavailable");
    assert!(version.status.success());
    assert_eq!(String::from_utf8(version.stdout).unwrap().trim(), "0.13.0");
    let out = PathBuf::from(env::var_os("OUT_DIR").unwrap());
    let mut sources = vec![PathBuf::from("rs256.c")];
    for dir in ["bearssl/src/int", "bearssl/src/rsa", "bearssl/src/codec"] {
        for entry in fs::read_dir(dir).unwrap() {
            let path = entry.unwrap().path();
            if path.extension().is_some_and(|ext| ext == "c") { sources.push(path); }
        }
    }
    sources.sort();
    let mut objects = Vec::new();
    for (index, source) in sources.iter().enumerate() {
        let object = out.join(format!("rsa-{index}.o"));
        run(Command::new(&zig).args(["cc", "-target", "wasm32-freestanding", "-mcpu=mvp",
            "-Oz", "-std=c99", "-ffreestanding", "-fno-builtin", "-fvisibility=hidden",
            "-I", "freestanding", "-I", "bearssl/inc", "-I", "bearssl/src", "-c"])
            .arg(source).arg("-o").arg(&object));
        objects.push(object);
    }
    let archive = out.join("libpulse_rsa.a");
    run(Command::new(&zig).args(["ar", "rcs"]).arg(&archive).args(objects));
    println!("cargo:rustc-link-search=native={}", out.display());
    println!("cargo:rustc-link-lib=static=pulse_rsa");
    println!("cargo:rerun-if-env-changed=PULSE_RSA_ZIG");
    println!("cargo:rerun-if-changed=rs256.c");
    println!("cargo:rerun-if-changed=bearssl");
    println!("cargo:rerun-if-changed=freestanding");
}
