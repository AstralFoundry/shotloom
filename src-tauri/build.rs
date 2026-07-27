fn main() {
    // 桌面调试二进制会嵌入 frontendDist。修改 Renderer 后必须重新运行
    // tauri-build，不能只依赖旧的 target/debug 可执行文件。
    tauri_build::build()
}
