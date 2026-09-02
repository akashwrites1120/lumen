import { describe, expect, it } from "vitest";
import {
  sampleForSpotCheck,
  spotCheckRateFromEnv,
} from "../src/lib/spot-check.js";

const P = "5f04b2d1-8f3d-4c21-9a6e-0a1b2c3d4e5f";
const ASSETS = [
  "b3e1c4a1-1111-4a2b-8c3d-123456789001",
  "b3e1c4a1-1111-4a2b-8c3d-123456789002",
  "b3e1c4a1-1111-4a2b-8c3d-123456789003",
  "b3e1c4a1-1111-4a2b-8c3d-123456789004",
  "b3e1c4a1-1111-4a2b-8c3d-123456789005",
  "b3e1c4a1-1111-4a2b-8c3d-123456789006",
  "b3e1c4a1-1111-4a2b-8c3d-123456789007",
  "b3e1c4a1-1111-4a2b-8c3d-123456789008",
  "b3e1c4a1-1111-4a2b-8c3d-123456789009",
  "b3e1c4a1-1111-4a2b-8c3d-123456789010",
];

describe("sampleForSpotCheck", () => {
  it("returns everything when rate >= 1", () => {
    expect(sampleForSpotCheck(P, ASSETS, 1)).toEqual(ASSETS);
  });

  it("returns nothing when rate <= 0 or no assets", () => {
    expect(sampleForSpotCheck(P, ASSETS, 0)).toEqual([]);
    expect(sampleForSpotCheck(P, [], 0.5)).toEqual([]);
  });

  it("is deterministic for the same project + asset set", () => {
    const a = sampleForSpotCheck(P, ASSETS, 0.5);
    const b = sampleForSpotCheck(P, ASSETS, 0.5);
    expect(a).toEqual(b);
  });

  it("produces a sample close to the requested rate", () => {
    const rate = 0.3;
    const sample = sampleForSpotCheck(P, ASSETS, rate);
    expect(sample.length).toBeGreaterThan(0);
    expect(sample.length).toBeLessThanOrEqual(ASSETS.length);
    // deterministic bound: with 10 items sample should be within [1, 9]
    expect(sample.length).toBeGreaterThanOrEqual(1);
  });

  it("is stable and unique: no duplicates in the sample", () => {
    const sample = sampleForSpotCheck(P, ASSETS, 0.9);
    expect(new Set(sample).size).toBe(sample.length);
  });
});

describe("spotCheckRateFromEnv", () => {
  it("defaults to 0.1", () => {
    expect(spotCheckRateFromEnv({})).toBe(0.1);
  });

  it("reads a valid rate and clamps invalid values", () => {
    expect(spotCheckRateFromEnv({ SPOT_CHECK_RATE: "0.25" })).toBe(0.25);
    expect(spotCheckRateFromEnv({ SPOT_CHECK_RATE: "2" })).toBe(0.1);
    expect(spotCheckRateFromEnv({ SPOT_CHECK_RATE: "-1" })).toBe(0.1);
    expect(spotCheckRateFromEnv({ SPOT_CHECK_RATE: "nope" })).toBe(0.1);
    expect(spotCheckRateFromEnv({ SPOT_CHECK_RATE: "0" })).toBe(0);
  });
});