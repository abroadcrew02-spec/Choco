import type { UseUpdaterReturn } from "../hooks/useUpdater";

interface UpdateModalProps {
  updater: UseUpdaterReturn;
}

/**
 * Lightweight update notification modal.
 *
 * Shown when updater.phase is "available", "downloading", "ready", or "error".
 * Uses inline styles consistent with the existing MvpEditor UI (dark theme).
 */
export function UpdateModal({ updater }: UpdateModalProps) {
  const { phase } = updater;

  if (
    phase === "idle" ||
    phase === "checking"
  ) {
    return null;
  }

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.6)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 2000,
      }}
    >
      <div
        style={{
          background: "#1e1e1e",
          border: "1px solid #555",
          borderRadius: 8,
          padding: "24px 32px",
          minWidth: 360,
          maxWidth: 480,
          color: "#f0f0f0",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {phase === "available" && (
          <AvailableView updater={updater} />
        )}
        {phase === "downloading" && (
          <DownloadingView updater={updater} />
        )}
        {phase === "ready" && (
          <ReadyView updater={updater} />
        )}
        {phase === "error" && (
          <ErrorView updater={updater} />
        )}
      </div>
    </div>
  );
}

function AvailableView({ updater }: UpdateModalProps) {
  return (
    <>
      <h3 style={{ margin: "0 0 12px", fontSize: 16 }}>
        アップデートが利用可能です
      </h3>
      {updater.availableVersion && (
        <p style={{ margin: "0 0 8px", fontSize: 13, color: "#aaa" }}>
          バージョン {updater.availableVersion}
        </p>
      )}
      {updater.releaseNotes && (
        <p
          style={{
            margin: "0 0 16px",
            fontSize: 12,
            color: "#ccc",
            whiteSpace: "pre-wrap",
            maxHeight: 120,
            overflow: "auto",
          }}
        >
          {updater.releaseNotes}
        </p>
      )}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button
          type="button"
          onClick={updater.dismiss}
          style={btnSecondaryStyle}
        >
          後で
        </button>
        <button
          type="button"
          onClick={() => void updater.startInstall()}
          style={btnPrimaryStyle}
        >
          更新する
        </button>
      </div>
    </>
  );
}

function DownloadingView({ updater }: UpdateModalProps) {
  const pct = updater.downloadProgress;
  return (
    <>
      <h3 style={{ margin: "0 0 12px", fontSize: 16 }}>
        ダウンロード中...
      </h3>
      <div
        style={{
          background: "#333",
          borderRadius: 4,
          height: 8,
          margin: "0 0 8px",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            background: "#0066cc",
            height: "100%",
            width: `${pct}%`,
            transition: "width 0.2s ease",
          }}
        />
      </div>
      <p style={{ margin: 0, fontSize: 12, color: "#aaa", textAlign: "right" }}>
        {pct}%
      </p>
    </>
  );
}

function ReadyView({ updater }: UpdateModalProps) {
  return (
    <>
      <h3 style={{ margin: "0 0 12px", fontSize: 16 }}>
        アップデート完了
      </h3>
      <p style={{ margin: "0 0 16px", fontSize: 13, color: "#ccc" }}>
        再起動すると新しいバージョンが適用されます。
      </p>
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button
          type="button"
          onClick={updater.dismiss}
          style={btnSecondaryStyle}
        >
          後で再起動
        </button>
        <button
          type="button"
          onClick={() => void updater.doRelaunch()}
          style={btnPrimaryStyle}
        >
          今すぐ再起動
        </button>
      </div>
    </>
  );
}

function ErrorView({ updater }: UpdateModalProps) {
  return (
    <>
      <h3 style={{ margin: "0 0 12px", fontSize: 16, color: "#ff6666" }}>
        アップデートエラー
      </h3>
      <p style={{ margin: "0 0 16px", fontSize: 13, color: "#ccc" }}>
        {updater.errorMessage ?? "不明なエラーが発生しました。現在のバージョンを引き続き使用します。"}
      </p>
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button
          type="button"
          onClick={updater.dismiss}
          style={btnSecondaryStyle}
        >
          閉じる
        </button>
      </div>
    </>
  );
}

const btnPrimaryStyle: React.CSSProperties = {
  padding: "4px 16px",
  background: "#0066cc",
  color: "#f0f0f0",
  border: "1px solid #0055aa",
  borderRadius: 4,
  cursor: "pointer",
  fontSize: 13,
};

const btnSecondaryStyle: React.CSSProperties = {
  padding: "4px 16px",
  background: "#444",
  color: "#f0f0f0",
  border: "1px solid #666",
  borderRadius: 4,
  cursor: "pointer",
  fontSize: 13,
};
