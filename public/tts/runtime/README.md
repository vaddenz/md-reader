# sherpa-onnx TTS WASM 运行时

这些文件来自 [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx)（Apache-2.0）：

- `sherpa-onnx-tts.js`
- `sherpa-onnx-wasm-main-tts.js`（已去掉内置 `.data` 模型包；模型由 OPFS 在运行时挂载）
- `sherpa-onnx-wasm-main-tts.wasm`

预构建文件取自 ModelScope 的官方 WebAssembly 空间
`k2-fsa/web-assembly-tts-sherpa-onnx-en`，通过 `scripts/tts-runtime-setup.mjs` 重新生成。
运行时是单线程 WASM（GitHub Pages 没有 COOP/COEP，无法使用 SharedArrayBuffer）。
