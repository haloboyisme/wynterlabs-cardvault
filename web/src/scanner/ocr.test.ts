import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  recognize,
  setParameters,
  terminate,
  titleCanvas,
  secondTitleCanvas,
  thirdTitleCanvas,
  fourthTitleCanvas,
  collectorCanvas,
  fallbackCanvas,
  preprocessOcrRegion,
} = vi.hoisted(() => {
  const title = { region: "title" } as unknown as HTMLCanvasElement;
  const secondTitle = { region: "title-2" } as unknown as HTMLCanvasElement;
  const thirdTitle = { region: "title-3" } as unknown as HTMLCanvasElement;
  const fourthTitle = { region: "title-4" } as unknown as HTMLCanvasElement;
  const collector = { region: "collector" } as unknown as HTMLCanvasElement;
  return {
    recognize: vi.fn(),
    setParameters: vi.fn(async (_parameters?: Record<string, string>) => undefined),
    terminate: vi.fn(async () => undefined),
    titleCanvas: title,
    secondTitleCanvas: secondTitle,
    thirdTitleCanvas: thirdTitle,
    fourthTitleCanvas: fourthTitle,
    collectorCanvas: collector,
    fallbackCanvas: { region: "full" } as unknown as HTMLCanvasElement,
    preprocessOcrRegion: vi.fn((_source, region: { y: number }) => {
      if (region.y < 0.025) return title;
      if (region.y < 0.075) return secondTitle;
      if (region.y < 0.125) return thirdTitle;
      if (region.y < 0.175) return fourthTitle;
      return collector;
    }),
  };
});

vi.mock("./capture", () => ({ preprocessOcrRegion }));
vi.mock("tesseract.js", () => ({
  OEM: { LSTM_ONLY: 1 },
  PSM: { SINGLE_LINE: "7", SPARSE_TEXT: "11" },
  createWorker: vi.fn(async (_languages, _oem, options) => ({
    recognize,
    setParameters,
    terminate,
    options,
  })),
}));

beforeEach(() => {
  recognize.mockReset();
  setParameters.mockClear();
  terminate.mockClear();
  preprocessOcrRegion.mockClear();
});

describe("private card OCR", () => {
  it("recognizes title and collector regions and scores a plausible card name", async () => {
    recognize
      .mockResolvedValueOnce({ data: { text: "| noise |\nVoja, Jaws of the Conclave" } })
      .mockResolvedValueOnce({ data: { text: "" } })
      .mockResolvedValueOnce({ data: { text: "" } })
      .mockResolvedValueOnce({ data: { text: "" } })
      .mockResolvedValueOnce({ data: { text: "FDN 0234" } });
    const { createWorker } = await import("tesseract.js");
    const { createCardOcrWorker } = await import("./ocr");
    const progress = vi.fn();
    const worker = await createCardOcrWorker(progress);
    const hints = await worker.recognize(fallbackCanvas);
    await worker.terminate();
    await worker.terminate();

    expect(createWorker).toHaveBeenCalledWith("eng", expect.anything(), expect.objectContaining({
      workerPath: "/ocr/worker.min.js",
      corePath: "/ocr/tesseract-core-simd-lstm.wasm.js",
      langPath: "/ocr",
      logger: expect.any(Function),
    }));
    expect(preprocessOcrRegion).toHaveBeenNthCalledWith(1, fallbackCanvas, expect.objectContaining({
      y: 0,
      height: expect.any(Number),
      minimumWidth: expect.any(Number),
    }));
    expect(preprocessOcrRegion).toHaveBeenNthCalledWith(2, fallbackCanvas, expect.objectContaining({
      y: expect.any(Number),
      height: expect.any(Number),
      minimumWidth: expect.any(Number),
    }));
    const titleRegions = preprocessOcrRegion.mock.calls.slice(0, 4)
      .map(([, region]) => region as unknown as {
        x: number; width: number; height: number;
      });
    expect(titleRegions).toHaveLength(4);
    expect(titleRegions.every((region) => (
      region.x >= 0.04
      && region.width >= 0.88
      && region.height >= 0.25
    ))).toBe(true);
    expect(preprocessOcrRegion.mock.calls.slice(0, 4).every(([, region]) => (
      (region as unknown as { preprocessing?: string }).preprocessing === "adaptive"
    ))).toBe(true);
    expect(setParameters.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
      tessedit_pageseg_mode: "11",
      tessedit_char_whitelist: expect.stringContaining("A"),
    }));
    expect(recognize.mock.calls.map(([canvas]) => canvas)).toEqual([
      titleCanvas,
      secondTitleCanvas,
      thirdTitleCanvas,
      fourthTitleCanvas,
      collectorCanvas,
    ]);
    expect(hints).toEqual({
      name: "Voja, Jaws of the Conclave",
      titleCandidates: ["Voja, Jaws of the Conclave", "noise"],
      set: "fdn",
      collector: "0234",
      rawText: "| noise |\nVoja, Jaws of the Conclave\nFDN 0234",
    });
    expect(terminate).toHaveBeenCalledTimes(1);
  });

  it("uses one full-card fallback only when the title region is unusable", async () => {
    recognize
      .mockResolvedValueOnce({ data: { text: "| |" } })
      .mockResolvedValueOnce({ data: { text: "" } })
      .mockResolvedValueOnce({ data: { text: "" } })
      .mockResolvedValueOnce({ data: { text: "" } })
      .mockResolvedValueOnce({ data: { text: "LEA 233" } })
      .mockResolvedValueOnce({ data: { text: "Black Lotus\nArtifact" } });
    const { createCardOcrWorker } = await import("./ocr");
    const worker = await createCardOcrWorker(vi.fn());

    expect(await worker.recognize(fallbackCanvas)).toEqual({
      name: "Black Lotus",
      titleCandidates: ["Black Lotus", "Artifact"],
      set: "lea",
      collector: "233",
      rawText: "| |\nLEA 233\nBlack Lotus\nArtifact",
    });
    expect(recognize.mock.calls.map(([canvas]) => canvas)).toEqual([
      titleCanvas,
      secondTitleCanvas,
      thirdTitleCanvas,
      fourthTitleCanvas,
      collectorCanvas,
      fallbackCanvas,
    ]);
  });

  it("rejects punctuation and one-letter title noise so full-card OCR can recover", async () => {
    recognize
      .mockResolvedValueOnce({ data: { text: "i ro a \\ a A" } })
      .mockResolvedValueOnce({ data: { text: "" } })
      .mockResolvedValueOnce({ data: { text: "" } })
      .mockResolvedValueOnce({ data: { text: "" } })
      .mockResolvedValueOnce({ data: { text: "SLD 2284" } })
      .mockResolvedValueOnce({ data: { text: "Voja, Jaws of the Conclave" } });
    const { createCardOcrWorker } = await import("./ocr");
    const worker = await createCardOcrWorker(vi.fn());

    const hints = await worker.recognize(fallbackCanvas);

    expect(hints.name).toBe("Voja, Jaws of the Conclave");
    expect(hints.titleCandidates).toEqual(["Voja, Jaws of the Conclave"]);
    expect(recognize.mock.calls.map(([canvas]) => canvas)).toEqual([
      titleCanvas,
      secondTitleCanvas,
      thirdTitleCanvas,
      fourthTitleCanvas,
      collectorCanvas,
      fallbackCanvas,
    ]);
  });

  it("checks every title band before choosing over a plausible rules fragment", async () => {
    recognize.mockImplementation(async (canvas) => {
      if (canvas === titleCanvas) return { data: { text: "" } };
      if (canvas === secondTitleCanvas) {
        return { data: { text: "Whenever Voi ata" } };
      }
      if (canvas === thirdTitleCanvas) {
        return { data: { text: "Voja, Jaws of the Conclave" } };
      }
      if (canvas === fourthTitleCanvas) return { data: { text: "" } };
      if (canvas === collectorCanvas) return { data: { text: "SLD 2284" } };
      return { data: { text: "Whenever Voja attacks, put X +1/+1 counters" } };
    });
    const { createCardOcrWorker } = await import("./ocr");
    const worker = await createCardOcrWorker(vi.fn());

    const hints = await worker.recognize(fallbackCanvas);

    expect(hints.name).toBe("Voja, Jaws of the Conclave");
    expect(hints.titleCandidates).toContain("Whenever Voi ata");
    expect(hints.titleCandidates).not.toContain(
      "Whenever Voja attacks, put X +1/+1 counters",
    );
    expect(recognize.mock.calls.map(([canvas]) => canvas)).toEqual([
      titleCanvas,
      secondTitleCanvas,
      thirdTitleCanvas,
      fourthTitleCanvas,
      collectorCanvas,
    ]);
  });

  it("keeps a real multiword title with one rules-like word", async () => {
    recognize
      .mockResolvedValueOnce({ data: { text: "When We Were Young" } })
      .mockResolvedValueOnce({ data: { text: "" } })
      .mockResolvedValueOnce({ data: { text: "" } })
      .mockResolvedValueOnce({ data: { text: "" } })
      .mockResolvedValueOnce({ data: { text: "MID 40" } });
    const { createCardOcrWorker } = await import("./ocr");
    const worker = await createCardOcrWorker(vi.fn());

    const hints = await worker.recognize(fallbackCanvas);

    expect(hints).toEqual(expect.objectContaining({
      name: "When We Were Young",
      titleCandidates: ["When We Were Young"],
      set: "mid",
      collector: "40",
    }));
    expect(recognize).toHaveBeenCalledTimes(5);
  });

  it("reads the collector number before the set code in modern lower-left details", async () => {
    recognize
      .mockResolvedValueOnce({ data: { text: "Voja, Jaws of the Conclave" } })
      .mockResolvedValueOnce({ data: { text: "" } })
      .mockResolvedValueOnce({ data: { text: "" } })
      .mockResolvedValueOnce({ data: { text: "" } })
      .mockResolvedValueOnce({ data: { text: "M 2284 SLD EN" } });
    const { createCardOcrWorker } = await import("./ocr");
    const worker = await createCardOcrWorker(vi.fn());

    expect(await worker.recognize(fallbackCanvas)).toEqual(expect.objectContaining({
      set: "sld",
      collector: "2284",
    }));
  });

  it("does not mistake a numbered set code for the collector number", async () => {
    recognize
      .mockResolvedValueOnce({ data: { text: "Tamiyo, Inquisitive Student" } })
      .mockResolvedValueOnce({ data: { text: "" } })
      .mockResolvedValueOnce({ data: { text: "" } })
      .mockResolvedValueOnce({ data: { text: "" } })
      .mockResolvedValueOnce({ data: { text: "MH3 0123" } });
    const { createCardOcrWorker } = await import("./ocr");
    const worker = await createCardOcrWorker(vi.fn());

    expect(await worker.recognize(fallbackCanvas)).toEqual(expect.objectContaining({
      set: "mh3",
      collector: "0123",
    }));
  });

  it("returns at most five ordered unique title hypotheses for catalog recovery", async () => {
    recognize
      .mockResolvedValueOnce({ data: { text: [
        "| Voja, Jaws of the Conciave |",
        "Voja, Jaws of the Conclave",
        "Candidate Three",
        "Candidate Four",
        "Candidate Five",
        "Candidate Six",
        "Candidate Seven",
      ].join("\n") } })
      .mockResolvedValueOnce({ data: { text: "" } })
      .mockResolvedValueOnce({ data: { text: "" } })
      .mockResolvedValueOnce({ data: { text: "" } })
      .mockResolvedValueOnce({ data: { text: "SLD 2284" } });
    const { createCardOcrWorker } = await import("./ocr");
    const worker = await createCardOcrWorker(vi.fn());

    const hints = await worker.recognize(fallbackCanvas);

    expect(hints.name).toBe("Voja, Jaws of the Conciave");
    expect(hints.titleCandidates).toEqual([
      "Voja, Jaws of the Conciave",
      "Voja, Jaws of the Conclave",
      "Candidate Three",
      "Candidate Four",
      "Candidate Five",
    ]);
    expect(hints.titleCandidates).toHaveLength(5);
    expect(hints.titleCandidates).not.toContain("SLD 2284");
  });

  it("aggregates worker progress monotonically across the three bounded passes", async () => {
    let logger: ((message: { progress: number; status: string }) => void) | undefined;
    const { createWorker } = await import("tesseract.js");
    vi.mocked(createWorker).mockImplementationOnce(async (_languages, _oem, options) => {
      logger = options?.logger as unknown as typeof logger;
      return { recognize, setParameters, terminate } as never;
    });
    recognize.mockImplementation(async (canvas) => {
      logger?.({ progress: 0.5, status: "recognizing text" });
      if (canvas === collectorCanvas) return { data: { text: "" } };
      if (canvas === fallbackCanvas) {
        logger?.({ progress: 1, status: "recognizing text" });
        return { data: { text: "Black Lotus" } };
      }
      return { data: { text: "" } };
    });
    const { createCardOcrWorker } = await import("./ocr");
    const progress = vi.fn();
    const worker = await createCardOcrWorker(progress);
    await worker.recognize(fallbackCanvas);

    const values = progress.mock.calls.map(([value]) => value as number);
    expect(values).toEqual([...values].sort((a, b) => a - b));
    expect(values.at(-1)).toBe(1);
  });
});
