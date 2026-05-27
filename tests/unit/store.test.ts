import { describe, it, expect, beforeEach } from "vitest";
import { useDocumentStore } from "../../src/store/documentStore";
import { useToolStore } from "../../src/store/toolStore";
import type { CanvasDocument } from "../../src/types/canvas";

describe("documentStore", () => {
  beforeEach(() => {
    useDocumentStore.setState({ document: null });
  });

  it("initializes with null document", () => {
    const { document } = useDocumentStore.getState();
    expect(document).toBeNull();
  });

  it("sets document correctly", () => {
    const doc: CanvasDocument = {
      id: "test-id",
      width: 800,
      height: 600,
      layers: [],
      activeLayerId: "",
      createdAt: Date.now(),
    };
    useDocumentStore.getState().setDocument(doc);
    expect(useDocumentStore.getState().document).toEqual(doc);
  });

  it("clears document when set to null", () => {
    const doc: CanvasDocument = {
      id: "test-id",
      width: 800,
      height: 600,
      layers: [],
      activeLayerId: "",
      createdAt: Date.now(),
    };
    useDocumentStore.getState().setDocument(doc);
    useDocumentStore.getState().setDocument(null);
    expect(useDocumentStore.getState().document).toBeNull();
  });
});

describe("toolStore", () => {
  beforeEach(() => {
    useToolStore.setState({
      activeTool: "brush",
      brushSize: 20,
      brushOpacity: 1.0,
      tolerance: 32,
      foregroundColor: [0, 0, 0, 255],
    });
  });

  it("initializes with brush tool", () => {
    const { activeTool } = useToolStore.getState();
    expect(activeTool).toBe("brush");
  });

  it("changes active tool", () => {
    useToolStore.getState().setActiveTool("bucket");
    expect(useToolStore.getState().activeTool).toBe("bucket");
  });

  it("updates brush size", () => {
    useToolStore.getState().setBrushSize(50);
    expect(useToolStore.getState().brushSize).toBe(50);
  });

  it("updates tolerance", () => {
    useToolStore.getState().setTolerance(128);
    expect(useToolStore.getState().tolerance).toBe(128);
  });

  it("updates foreground color", () => {
    useToolStore.getState().setForegroundColor([255, 0, 0, 255]);
    expect(useToolStore.getState().foregroundColor).toEqual([255, 0, 0, 255]);
  });
});
