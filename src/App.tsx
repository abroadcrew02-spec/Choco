import { MvpEditor } from "./components/MvpEditor/MvpEditor";

function App() {
  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
      {/* Title bar */}
      <div
        style={{
          padding: "6px 16px",
          background: "#1a1a1a",
          borderBottom: "1px solid #444",
          fontSize: 14,
          color: "#f0f0f0",
          fontFamily: "sans-serif",
          display: "flex",
          alignItems: "center",
          gap: 12,
        }}
      >
        <span style={{ fontWeight: "bold" }}>Choco</span>
        <span style={{ color: "#666", fontSize: 11 }}>MVP — color / transparency / SVG export</span>
      </div>

      {/* Editor fills the rest */}
      <div style={{ flex: 1, overflow: "hidden" }}>
        <MvpEditor />
      </div>
    </div>
  );
}

export default App;
