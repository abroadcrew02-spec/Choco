use wasm_bindgen::prelude::*;

/// Minimal hello function for M1 connectivity check.
#[wasm_bindgen]
pub fn hello(name: &str) -> String {
    format!("Hello from WASM, {}!", name)
}

/// Canvas state stub - full implementation in M2+.
#[wasm_bindgen]
pub struct CanvasState {
    width: u32,
    height: u32,
}

#[wasm_bindgen]
impl CanvasState {
    #[wasm_bindgen(constructor)]
    pub fn new(width: u32, height: u32) -> Self {
        CanvasState { width, height }
    }

    pub fn width(&self) -> u32 {
        self.width
    }

    pub fn height(&self) -> u32 {
        self.height
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_hello() {
        assert_eq!(hello("world"), "Hello from WASM, world!");
    }

    #[test]
    fn test_canvas_state_dimensions() {
        let state = CanvasState::new(800, 600);
        assert_eq!(state.width(), 800);
        assert_eq!(state.height(), 600);
    }
}
