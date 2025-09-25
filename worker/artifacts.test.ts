import {
  extractArtifactsFromOutput,
  extractArtifactsFromTelemetry,
} from "./artifacts.js";

const toolOk = {
  data: {
    cid: "f01551220abc",
    name: "doc",
    topic: "analysis",
    contentPreview: "first 100",
  },
  meta: { ok: true },
};

describe("artifact extraction", () => {
  it("extracts artifacts from output JSON blobs", () => {
    const output = `some text\n${JSON.stringify(toolOk)}\nmore text`;
    const items = extractArtifactsFromOutput(output);
    expect(items.length).toBe(1);
    expect(items[0].cid).toBe("f01551220abc");
    expect(items[0].topic).toBe("analysis");
    expect(items[0].name).toBe("doc");
  });

  it("dedupes across telemetry request/response texts", () => {
    const t = {
      requestText: [JSON.stringify(toolOk)],
      responseText: [JSON.stringify(toolOk)],
    };
    const items = extractArtifactsFromTelemetry(t);
    expect(items.length).toBe(1);
  });

  it("extracts artifacts from deeply nested Gemini CLI telemetry structure", () => {
    // Create a realistic nested telemetry structure as described in the Linear issue
    const nestedTelemetryResponse = {
      candidates: [{
        content: {
          parts: [{
            functionResponse: {
              name: "create_artifact",
              response: {
                output: JSON.stringify({
                  data: {
                    cid: "bafkreiabc123def456",
                    name: "analysis_report",
                    topic: "market_analysis",
                    contentPreview: "Market analysis for Q4 2024..."
                  },
                  meta: { ok: true }
                })
              }
            }
          }]
        }
      }],
      usageMetadata: {
        promptTokenCount: 150,
        candidatesTokenCount: 75,
        totalTokenCount: 225
      }
    };

    const telemetry = {
      responseText: [JSON.stringify(nestedTelemetryResponse)]
    };

    const items = extractArtifactsFromTelemetry(telemetry);
    expect(items.length).toBe(1);
    expect(items[0].cid).toBe("bafkreiabc123def456");
    expect(items[0].name).toBe("analysis_report");
    expect(items[0].topic).toBe("market_analysis");
    expect(items[0].contentPreview).toBe("Market analysis for Q4 2024...");
  });

  it("extracts artifacts from multiple nested function responses", () => {
    // Test with multiple function responses in the same telemetry entry
    const multipleArtifactsResponse = {
      candidates: [{
        content: {
          parts: [
            {
              functionResponse: {
                name: "create_artifact",
                response: {
                  output: JSON.stringify({
                    data: {
                      cid: "bafkrei111222333",
                      name: "report_1",
                      topic: "analysis",
                      contentPreview: "First report..."
                    }
                  })
                }
              }
            },
            {
              functionResponse: {
                name: "create_artifact", 
                response: {
                  output: JSON.stringify({
                    data: {
                      cid: "bafkrei444555666",
                      name: "report_2",
                      topic: "summary",
                      contentPreview: "Second report..."
                    }
                  })
                }
              }
            }
          ]
        }
      }]
    };

    const telemetry = {
      responseText: [JSON.stringify(multipleArtifactsResponse)]
    };

    const items = extractArtifactsFromTelemetry(telemetry);
    expect(items.length).toBe(2);
    expect(items[0].cid).toBe("bafkrei111222333");
    expect(items[1].cid).toBe("bafkrei444555666");
  });

  it("handles mixed flat and nested telemetry structures", () => {
    // Test that the function can handle both old flat structure and new nested structure
    const flatResponse = JSON.stringify(toolOk);
    const nestedResponse = JSON.stringify({
      candidates: [{
        content: {
          parts: [{
            functionResponse: {
              name: "create_artifact",
              response: {
                output: JSON.stringify({
                  data: {
                    cid: "bafkreinested123",
                    name: "nested_doc",
                    topic: "nested_analysis",
                    contentPreview: "nested content"
                  }
                })
              }
            }
          }]
        }
      }]
    });

    const telemetry = {
      responseText: [flatResponse, nestedResponse]
    };

    const items = extractArtifactsFromTelemetry(telemetry);
    expect(items.length).toBe(2);
    // First from flat structure
    expect(items.some(item => item.cid === "f01551220abc")).toBe(true);
    // Second from nested structure
    expect(items.some(item => item.cid === "bafkreinested123")).toBe(true);
  });
});
