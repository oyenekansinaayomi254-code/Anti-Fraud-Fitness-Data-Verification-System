import { describe, it, expect, beforeEach } from "vitest";
import { buffCV, uintCV } from "@stacks/transactions";

const ERR_INVALID_SUBMISSION = 100;
const ERR_FRAUD_DETECTED = 101;
const ERR_UNAUTHORIZED = 102;
const ERR_INVALID_HASH = 103;
const ERR_INVALID_TIMESTAMP = 104;
const ERR_INVALID_DEVICE_ID = 105;
const ERR_INVALID_STEPS = 106;
const ERR_INVALID_HEART_RATE = 107;
const ERR_INVALID_CALORIES = 108;
const ERR_INVALID_DISTANCE = 109;
const ERR_INVALID_GPS_DATA = 110;
const ERR_ORACLE_FAILURE = 111;
const ERR_HIGH_FRAUD_SCORE = 112;
const ERR_SUBMISSION_EXISTS = 113;
const ERR_USER_BANNED = 114;
const ERR_INVALID_FRAUD_THRESHOLD = 115;
const ERR_INVALID_ANOMALY_FACTOR = 116;
const ERR_INVALID_ORACLE_RESPONSE = 117;
const ERR_INSUFFICIENT_DATA = 118;
const ERR_MATH_OVERFLOW = 119;
const ERR_INVALID_SCORE_UPDATE = 120;

interface Submission {
  hash: Uint8Array;
  timestamp: number;
  deviceId: Uint8Array;
  steps: number;
  heartRate: number;
  calories: number;
  distance: number;
  gpsData: Uint8Array | null;
}

interface DetectionEntry {
  timestamp: number;
  score: number;
  flagged: boolean;
}

interface OracleResponse {
  valid: boolean;
  reason: string;
}

interface Result<T> {
  ok: boolean;
  value: T;
}

class FraudDetectionMock {
  state: {
    oraclePrincipal: string;
    fraudThreshold: number;
    anomalyFactor: number;
    adminPrincipal: string;
    submissions: Map<string, Submission>;
    fraudFlags: Map<string, boolean>;
    userFraudScores: Map<string, number>;
    detectionHistory: Map<string, DetectionEntry[]>;
    oracleResponses: Map<number, OracleResponse>;
  } = {
    oraclePrincipal: "ST1ADMIN",
    fraudThreshold: 70,
    anomalyFactor: 2,
    adminPrincipal: "ST1ADMIN",
    submissions: new Map(),
    fraudFlags: new Map(),
    userFraudScores: new Map(),
    detectionHistory: new Map(),
    oracleResponses: new Map(),
  };
  blockHeight: number = 100;
  caller: string = "ST1USER";

  constructor() {
    this.reset();
  }

  reset() {
    this.state = {
      oraclePrincipal: "ST1ADMIN",
      fraudThreshold: 70,
      anomalyFactor: 2,
      adminPrincipal: "ST1ADMIN",
      submissions: new Map(),
      fraudFlags: new Map(),
      userFraudScores: new Map(),
      detectionHistory: new Map(),
      oracleResponses: new Map(),
    };
    this.blockHeight = 100;
    this.caller = "ST1USER";
  }

  submitData(
    hash: Uint8Array,
    timestamp: number,
    deviceId: Uint8Array,
    steps: number,
    heartRate: number,
    calories: number,
    distance: number,
    gpsData: Uint8Array | null
  ): Result<boolean> {
    if (hash.length !== 32) return { ok: false, value: ERR_INVALID_HASH };
    if (timestamp < this.blockHeight) return { ok: false, value: ERR_INVALID_TIMESTAMP };
    if (deviceId.length !== 16) return { ok: false, value: ERR_INVALID_DEVICE_ID };
    if (steps > 50000 || steps < 0) return { ok: false, value: ERR_INVALID_STEPS };
    if (heartRate > 220 || heartRate < 40) return { ok: false, value: ERR_INVALID_HEART_RATE };
    if (calories > 10000 || calories < 0) return { ok: false, value: ERR_INVALID_CALORIES };
    if (distance > 100 || distance < 0) return { ok: false, value: ERR_INVALID_DISTANCE };
    if (gpsData && gpsData.length > 64) return { ok: false, value: ERR_INVALID_GPS_DATA };
    if (this.state.submissions.has(this.caller)) return { ok: false, value: ERR_SUBMISSION_EXISTS };
    if (this.state.fraudFlags.get(this.caller)) return { ok: false, value: ERR_USER_BANNED };
    this.state.submissions.set(this.caller, { hash, timestamp, deviceId, steps, heartRate, calories, distance, gpsData });
    return { ok: true, value: true };
  }

  detectFraud(user: string): Result<number> {
    if (this.caller !== this.state.adminPrincipal) return { ok: false, value: ERR_UNAUTHORIZED };
    const submission = this.state.submissions.get(user);
    if (!submission) return { ok: false, value: ERR_INVALID_SUBMISSION };
    let anomalyScore = 0;
    if (submission.steps > 50000 || submission.steps < 0) anomalyScore += 20;
    if (submission.heartRate > 220 || submission.heartRate < 40) anomalyScore += 20;
    if (submission.calories > 10000 || submission.calories < 0) anomalyScore += 20;
    if (submission.distance > 100 || submission.distance < 0) anomalyScore += 20;
    anomalyScore *= this.state.anomalyFactor;
    if (anomalyScore >= this.state.fraudThreshold) {
      this.state.fraudFlags.set(user, true);
      const currentScore = this.state.userFraudScores.get(user) || 0;
      this.state.userFraudScores.set(user, currentScore + anomalyScore);
      let history = this.state.detectionHistory.get(user) || [];
      history = [...history, { timestamp: this.blockHeight, score: anomalyScore, flagged: true }].slice(-10);
      this.state.detectionHistory.set(user, history);
      return { ok: false, value: ERR_FRAUD_DETECTED };
    } else {
      const currentScore = this.state.userFraudScores.get(user) || 0;
      this.state.userFraudScores.set(user, Math.max(0, currentScore - 10));
      let history = this.state.detectionHistory.get(user) || [];
      history = [...history, { timestamp: this.blockHeight, score: anomalyScore, flagged: false }].slice(-10);
      this.state.detectionHistory.set(user, history);
      return { ok: true, value: anomalyScore };
    }
  }

  processOracleResponse(responseId: number, valid: boolean, reason: string): Result<boolean> {
    if (this.caller !== this.state.oraclePrincipal) return { ok: false, value: ERR_UNAUTHORIZED };
    this.state.oracleResponses.set(responseId, { valid, reason });
    return { ok: true, value: true };
  }

  setFraudThreshold(newThreshold: number): Result<boolean> {
    if (this.caller !== this.state.adminPrincipal) return { ok: false, value: ERR_UNAUTHORIZED };
    if (newThreshold <= 0 || newThreshold > 100) return { ok: false, value: ERR_INVALID_FRAUD_THRESHOLD };
    this.state.fraudThreshold = newThreshold;
    return { ok: true, value: true };
  }

  setAnomalyFactor(newFactor: number): Result<boolean> {
    if (this.caller !== this.state.adminPrincipal) return { ok: false, value: ERR_UNAUTHORIZED };
    if (newFactor <= 0) return { ok: false, value: ERR_INVALID_ANOMALY_FACTOR };
    this.state.anomalyFactor = newFactor;
    return { ok: true, value: true };
  }

  getUserFraudScore(user: string): number {
    return this.state.userFraudScores.get(user) || 0;
  }

  getDetectionHistory(user: string): DetectionEntry[] {
    return this.state.detectionHistory.get(user) || [];
  }
}

describe("FraudDetection", () => {
  let contract: FraudDetectionMock;

  beforeEach(() => {
    contract = new FraudDetectionMock();
    contract.reset();
  });

  it("submits data successfully", () => {
    const hash = new Uint8Array(32).fill(1);
    const deviceId = new Uint8Array(16).fill(2);
    const result = contract.submitData(hash, 101, deviceId, 10000, 80, 2000, 10, null);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
  });

  it("rejects invalid hash", () => {
    const hash = new Uint8Array(31).fill(1);
    const deviceId = new Uint8Array(16).fill(2);
    const result = contract.submitData(hash, 101, deviceId, 10000, 80, 2000, 10, null);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_HASH);
  });

  it("validates data successfully", () => {
    const hash = new Uint8Array(32).fill(1);
    const deviceId = new Uint8Array(16).fill(2);
    contract.submitData(hash, 101, deviceId, 10000, 80, 2000, 10, null);
    contract.caller = "ST1ADMIN";
    const result = contract.detectFraud("ST1USER");
    expect(result.ok).toBe(true);
    expect(result.value).toBe(0);
    expect(contract.getDetectionHistory("ST1USER").length).toBe(1);
  });

  it("processes oracle response", () => {
    contract.caller = "ST1ADMIN";
    contract.state.oraclePrincipal = "ST1ADMIN";
    const result = contract.processOracleResponse(1, true, "Valid");
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
  });

  it("sets fraud threshold", () => {
    contract.caller = "ST1ADMIN";
    const result = contract.setFraudThreshold(80);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    expect(contract.state.fraudThreshold).toBe(80);
  });

  it("sets anomaly factor", () => {
    contract.caller = "ST1ADMIN";
    const result = contract.setAnomalyFactor(3);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    expect(contract.state.anomalyFactor).toBe(3);
  });

  it("rejects unauthorized detection", () => {
    const hash = new Uint8Array(32).fill(1);
    const deviceId = new Uint8Array(16).fill(2);
    contract.submitData(hash, 101, deviceId, 10000, 80, 2000, 10, null);
    const result = contract.detectFraud("ST1USER");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_UNAUTHORIZED);
  });

  it("rejects submission from banned user", () => {
    contract.state.fraudFlags.set("ST1USER", true);
    const hash = new Uint8Array(32).fill(1);
    const deviceId = new Uint8Array(16).fill(2);
    const result = contract.submitData(hash, 101, deviceId, 10000, 80, 2000, 10, null);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_USER_BANNED);
  });

  it("decays fraud score on valid submission", () => {
    const hash = new Uint8Array(32).fill(1);
    const deviceId = new Uint8Array(16).fill(2);
    contract.submitData(hash, 101, deviceId, 10000, 80, 2000, 10, null);
    contract.state.userFraudScores.set("ST1USER", 15);
    contract.caller = "ST1ADMIN";
    contract.detectFraud("ST1USER");
    expect(contract.getUserFraudScore("ST1USER")).toBe(5);
  });

  it("handles history overflow", () => {
    const hash = new Uint8Array(32).fill(1);
    const deviceId = new Uint8Array(16).fill(2);
    contract.submitData(hash, 101, deviceId, 10000, 80, 2000, 10, null);
    contract.caller = "ST1ADMIN";
    for (let i = 0; i < 12; i++) {
      contract.detectFraud("ST1USER");
    }
    expect(contract.getDetectionHistory("ST1USER").length).toBe(10);
  });
});