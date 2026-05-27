import { useEffect, useState } from "react";
import { CanvasStage } from "./components/Canvas/CanvasStage";
import { initWorker } from "./worker/wasmLoader";

function App() {
  const [workerReady, setWorkerReady] = useState(false);
  const [wasmHello, setWasmHello] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    initWorker()
      .then(async (api) => {
        if (!mounted) return;
        setWorkerReady(true);

        // M1 connectivity check: call hello() via Worker + WASM
        try {
          const msg = await api.hello("Choco");
          if (mounted) setWasmHello(msg);
        } catch (e) {
          // WASM pkg may not be built yet in dev - gracefully degrade
          if (mounted)
            setWasmHello("(WASM not built yet - run: pnpm wasm:build)");
        }
      })
      .catch((e: unknown) => {
        if (mounted)
          setError(e instanceof Error ? e.message : String(e));
      });

    return () => {
      mounted = false;
    };
  }, []);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        background: "#2d2d2d",
        color: "#f0f0f0",
        fontFamily: "sans-serif",
      }}
    >
      {/* Title bar */}
      <div
        style={{
          padding: "8px 16px",
          background: "#1a1a1a",
          borderBottom: "1px solid #444",
          fontSize: 14,
          display: "flex",
          alignItems: "center",
          gap: 16,
        }}
      >
        <span style={{ fontWeight: "bold" }}>Choco</span>
        <span style={{ color: "#888", fontSize: 12 }}>
          Worker: {workerReady ? "ready" : "initializing..."}
          {wasmHello ? ` | WASM: ${wasmHello}` : ""}
          {error ? ` | Error: ${error}` : ""}
        </span>
      </div>

      {/* Canvas area */}
      <div
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
        }}
      >
        <CanvasStage width={800} height={600} />
      </div>
    </div>
  );
}

export default App;
