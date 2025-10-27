import { describe, it, expect, beforeEach } from "vitest";
import { buffCV, uintCV } from "@stacks/transactions";

const ERR_INVALID_SUBMISSION = 100;
const ERR_SUBMISSION_NOT_FOUND = 101;
const ERR_UNAUTHORIZED = 102;
const ERR_INVALID_HASH = 103;
const ERR_INVALID_TIMESTAMP = 104;
const ERR_INVALID_DEVICE_ID = 105;
const ERR_INVALID_USER = 106;
const ERR_SUBMISSION_EXISTS = 107;
const ERR_INVALID_METADATA = 108;
const ERR_INVALID_GPS = 109;
const ERR_BLOCK_HEIGHT_MISMATCH = 110;
const ERR_INVALID_STEPS = 111;
const ERR_INVALID_HEART_RATE = 112;
const ERR_INVALID_CALORIES = 113;
const ERR_INVALID_DISTANCE = 114;
const ERR_GPS_REQUIRED = 115;
const ERR_METADATA_TOO_LARGE = 116;
const ERR_INVALID_SESSION = 117;
const ERR_SESSION_EXPIRED = 118;
const ERR_INVALID_NONCE = 119;

interface Submission {
  submissionId: number;
  user: string;
  hash: Uint8Array;
  timestamp: number;
  blockHeight: number;
  deviceId: Uint8Array;
  steps: number;
  heartRateAvg: number;
  calories: number;
  distance: number;
  gpsData: Uint8Array | null;
  metadata: Uint8Array | null;
  sessionNonce: number;
  fraudScore: number;
  status: string;
}

interface Result<T> {
  ok: boolean;
  value: T;
}

class DataSubmissionMock {
  state: {
    nextSubmissionId: number;
    adminPrincipal: string;
    submissions: Map<number, Submission>;
    userSubmissions: Map<string, number[]>;
    submissionByHash: Map<string, number>;
    sessionNonces: Map<string, number>;
  } = {
    nextSubmissionId: 0,
    adminPrincipal: "ST1ADMIN",
    submissions: new Map(),
    userSubmissions: new Map(),
    submissionByHash: new Map(),
    sessionNonces: new Map(),
  };
  blockHeight: number = 1000;
  caller: string = "ST1USER";

  constructor() {
    this.reset();
  }

  reset() {
    this.state = {
      nextSubmissionId: 0,
      adminPrincipal: "ST1ADMIN",
      submissions: new Map(),
      userSubmissions: new Map(),
      submissionByHash: new Map(),
      sessionNonces: new Map(),
    };
    this.blockHeight = 1000;
    this.caller = "ST1USER";
  }

  submitData(
    hash: Uint8Array,
    timestamp: number,
    deviceId: Uint8Array,
    steps: number,
    heartRateAvg: number,
    calories: number,
    distance: number,
    gpsData: Uint8Array | null,
    metadata: Uint8Array | null,
    sessionNonce: number
  ): Result<number> {
    if (hash.length !== 32) return { ok: false, value: ERR_INVALID_HASH };
    if (timestamp < this.blockHeight || timestamp > this.blockHeight + 10)
      return { ok: false, value: ERR_INVALID_TIMESTAMP };
    if (deviceId.length !== 16)
      return { ok: false, value: ERR_INVALID_DEVICE_ID };
    if (steps < 0 || steps > 30000)
      return { ok: false, value: ERR_INVALID_STEPS };
    if (heartRateAvg < 40 || heartRateAvg > 220)
      return { ok: false, value: ERR_INVALID_HEART_RATE };
    if (calories < 0 || calories > 5000)
      return { ok: false, value: ERR_INVALID_CALORIES };
    if (distance < 0 || distance > 50)
      return { ok: false, value: ERR_INVALID_DISTANCE };
    if (gpsData && gpsData.length > 128)
      return { ok: false, value: ERR_INVALID_GPS };
    if (metadata && metadata.length > 256)
      return { ok: false, value: ERR_METADATA_TOO_LARGE };
    const currentNonce = this.state.sessionNonces.get(this.caller) || 0;
    if (sessionNonce !== currentNonce + 1)
      return { ok: false, value: ERR_INVALID_NONCE };
    const hashKey = Array.from(hash).join(",");
    if (this.state.submissionByHash.has(hashKey))
      return { ok: false, value: ERR_SUBMISSION_EXISTS };

    const submissionId = this.state.nextSubmissionId;
    const submission: Submission = {
      submissionId,
      user: this.caller,
      hash,
      timestamp,
      blockHeight: this.blockHeight,
      deviceId,
      steps,
      heartRateAvg,
      calories,
      distance,
      gpsData,
      metadata,
      sessionNonce,
      fraudScore: 0,
      status: "pending",
    };
    this.state.submissions.set(submissionId, submission);
    this.state.submissionByHash.set(hashKey, submissionId);
    const userList = this.state.userSubmissions.get(this.caller) || [];
    const newList =
      userList.length < 50
        ? [...userList, submissionId]
        : [...userList.slice(1), submissionId];
    this.state.userSubmissions.set(this.caller, newList);
    this.state.sessionNonces.set(this.caller, sessionNonce);
    this.state.nextSubmissionId++;
    return { ok: true, value: submissionId };
  }

  updateSubmissionStatus(
    submissionId: number,
    newStatus: string
  ): Result<boolean> {
    if (this.caller !== this.state.adminPrincipal)
      return { ok: false, value: ERR_UNAUTHORIZED };
    const submission = this.state.submissions.get(submissionId);
    if (!submission) return { ok: false, value: ERR_SUBMISSION_NOT_FOUND };
    if (!["verified", "flagged", "rejected"].includes(newStatus))
      return { ok: false, value: ERR_INVALID_METADATA };
    this.state.submissions.set(submissionId, {
      ...submission,
      status: newStatus,
    });
    return { ok: true, value: true };
  }

  setAdmin(newAdmin: string): Result<boolean> {
    if (this.caller !== this.state.adminPrincipal)
      return { ok: false, value: ERR_UNAUTHORIZED };
    this.state.adminPrincipal = newAdmin;
    return { ok: true, value: true };
  }

  getSubmission(submissionId: number): Submission | null {
    return this.state.submissions.get(submissionId) || null;
  }

  getUserSubmissions(user: string): number[] {
    return this.state.userSubmissions.get(user) || [];
  }

  getSubmissionCount(): number {
    return this.state.nextSubmissionId;
  }
}

describe("DataSubmission", () => {
  let contract: DataSubmissionMock;

  beforeEach(() => {
    contract = new DataSubmissionMock();
    contract.reset();
  });

  it("submits data successfully", () => {
    const hash = new Uint8Array(32).fill(1);
    const deviceId = new Uint8Array(16).fill(2);
    const result = contract.submitData(
      hash,
      1005,
      deviceId,
      10000,
      80,
      1500,
      10,
      null,
      null,
      1
    );
    expect(result.ok).toBe(true);
    expect(result.value).toBe(0);
    const sub = contract.getSubmission(0);
    expect(sub?.steps).toBe(10000);
    expect(sub?.status).toBe("pending");
  });

  it("rejects invalid hash", () => {
    const hash = new Uint8Array(31).fill(1);
    const deviceId = new Uint8Array(16).fill(2);
    const result = contract.submitData(
      hash,
      1005,
      deviceId,
      10000,
      80,
      1500,
      10,
      null,
      null,
      1
    );
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_HASH);
  });

  it("rejects duplicate hash", () => {
    const hash = new Uint8Array(32).fill(1);
    const deviceId = new Uint8Array(16).fill(2);
    contract.submitData(
      hash,
      1005,
      deviceId,
      10000,
      80,
      1500,
      10,
      null,
      null,
      1
    );
    const result = contract.submitData(
      hash,
      1006,
      deviceId,
      12000,
      85,
      1600,
      11,
      null,
      null,
      2
    );
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_SUBMISSION_EXISTS);
  });

  it("rejects invalid session nonce", () => {
    const hash = new Uint8Array(32).fill(1);
    const deviceId = new Uint8Array(16).fill(2);
    const result = contract.submitData(
      hash,
      1005,
      deviceId,
      10000,
      80,
      1500,
      10,
      null,
      null,
      5
    );
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_NONCE);
  });

  it("updates submission status", () => {
    const hash = new Uint8Array(32).fill(1);
    const deviceId = new Uint8Array(16).fill(2);
    contract.submitData(
      hash,
      1005,
      deviceId,
      10000,
      80,
      1500,
      10,
      null,
      null,
      1
    );
    contract.caller = "ST1ADMIN";
    const result = contract.updateSubmissionStatus(0, "verified");
    expect(result.ok).toBe(true);
    expect(contract.getSubmission(0)?.status).toBe("verified");
  });

  it("rejects unauthorized status update", () => {
    const hash = new Uint8Array(32).fill(1);
    const deviceId = new Uint8Array(16).fill(2);
    contract.submitData(
      hash,
      1005,
      deviceId,
      10000,
      80,
      1500,
      10,
      null,
      null,
      1
    );
    const result = contract.updateSubmissionStatus(0, "verified");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_UNAUTHORIZED);
  });

  it("tracks user submissions", () => {
    const hash1 = new Uint8Array(32).fill(1);
    const hash2 = new Uint8Array(32).fill(2);
    const deviceId = new Uint8Array(16).fill(2);
    contract.submitData(
      hash1,
      1005,
      deviceId,
      10000,
      80,
      1500,
      10,
      null,
      null,
      1
    );
    contract.submitData(
      hash2,
      1006,
      deviceId,
      12000,
      85,
      1600,
      11,
      null,
      null,
      2
    );
    expect(contract.getUserSubmissions("ST1USER")).toEqual([0, 1]);
  });


  it("returns correct submission count", () => {
    const hash = new Uint8Array(32).fill(1);
    const deviceId = new Uint8Array(16).fill(2);
    contract.submitData(
      hash,
      1005,
      deviceId,
      10000,
      80,
      1500,
      10,
      null,
      null,
      1
    );
    expect(contract.getSubmissionCount()).toBe(1);
  });
});
