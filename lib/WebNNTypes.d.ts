declare global {
  type MLOperand = unknown;

  type MLGraph = unknown;

  interface MLContext {
    compute(
      graph: MLGraph,
      inputs: Record<string, Float32Array>,
      outputs: Record<string, Float32Array>
    ): Promise<void>;
  }

  interface MLOperandDescriptor {
    dataType: "float32";
    dimensions: number[];
  }

  class MLGraphBuilder {
    constructor(context: MLContext);
    input(name: string, descriptor: MLOperandDescriptor): MLOperand;
    reshape(input: MLOperand, dimensions: number[]): MLOperand;
    matmul(a: MLOperand, b: MLOperand): MLOperand;
    build(outputs: Record<string, MLOperand>): Promise<MLGraph>;
  }

  interface Navigator {
    ml?: {
      createContext(options?: {
        deviceType?: "cpu" | "gpu" | "npu";
      }): Promise<MLContext>;
    };
  }
}

export {};
