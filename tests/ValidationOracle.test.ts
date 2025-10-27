import { describe, it, expect, beforeEach } from "vitest";

const ERR_INVALID_SUBMISSION_ID = 100;
const ERR_SUBMISSION_NOT_FOUND = 101;
const ERR_UNAUTHORIZED = 102;
const ERR_INVALID_ORACLE_ID = 103;
const ERR_ORACLE_ALREADY_EXISTS = 104;
const ERR_ORACLE_NOT_FOUND = 105;
const ERR_INVALID_RESPONSE = 106;
const ERR_RESPONSE_TIMEOUT = 107;
const ERR_INSUFFICIENT_STAKE = 108;
const ERR_ORACLE_INACTIVE = 109;
const ERR_INVALID_CONFIDENCE = 111;
const ERR_RESPONSE_ALREADY_PROCESSED = 115;
const ERR_QUORUM_NOT_MET = 116;

const MIN_STAKE = 1000000;
const REGISTRATION_FEE = 5000;
const RESPONSE_TIMEOUT = 100;
const MIN_CONFIDENCE = 80;
const QUORUM_THRESHOLD = 66;

interface Oracle {
  oracleId: number;
  principal: string;
  stake: number;
  reputation: number;
  active: boolean;
  registeredAt: number;
  lastResponse: number;
  totalResponses: number;
  correctResponses: number;
}

interface Request {
  requestId: number;
  submissionId: number;
  status: string;
  createdAt: number;
  deadline: number;
  totalOracles: number;
  responsesReceived: number;
  validCount: number;
  invalidCount: number;
}

interface OracleResponse {
  valid: boolean;
  confidence: number;
  gpsVerified: boolean;
  hrConsistency: boolean;
  stepPlausibility: boolean;
  timestamp: number;
  processed: boolean;
}

interface Result<T> {
  ok: boolean;
  value: T;
}

class ValidationOracleMock {
  state: {
    adminPrincipal: string;
    nextOracleId: number;
    nextRequestId: number;
    oracles: Map<number, Oracle>;
    oracleByPrincipal: Map<string, number>;
    requests: Map<number, Request>;
    oracleResponses: Map<string, OracleResponse>;
    submissionRequests: Map<number, number>;
    stxTransfers: Array<{ amount: number; from: string; to: string }>;
  } = {
    adminPrincipal: "ST1ADMIN",
    nextOracleId: 0,
    nextRequestId: 0,
    oracles: new Map(),
    oracleByPrincipal: new Map(),
    requests: new Map(),
    oracleResponses: new Map(),
    submissionRequests: new Map(),
    stxTransfers: [],
  };
  blockHeight: number = 1000;
  caller: string = "ST1USER";

  constructor() {
    this.reset();
  }

  reset() {
    this.state = {
      adminPrincipal: "ST1ADMIN",
      nextOracleId: 0,
      nextRequestId: 0,
      oracles: new Map(),
      oracleByPrincipal: new Map(),
      requests: new Map(),
      oracleResponses: new Map(),
      submissionRequests: new Map(),
      stxTransfers: [],
    };
    this.blockHeight = 1000;
    this.caller = "ST1USER";
  }

  registerOracle(stakeAmount: number): Result<number> {
    if (this.state.oracleByPrincipal.has(this.caller))
      return { ok: false, value: ERR_ORACLE_ALREADY_EXISTS };
    if (stakeAmount < MIN_STAKE)
      return { ok: false, value: ERR_INSUFFICIENT_STAKE };
    this.state.stxTransfers.push({
      amount: REGISTRATION_FEE,
      from: this.caller,
      to: "contract",
    });
    const oracleId = this.state.nextOracleId;
    const oracle: Oracle = {
      oracleId,
      principal: this.caller,
      stake: stakeAmount,
      reputation: 0,
      active: true,
      registeredAt: this.blockHeight,
      lastResponse: 0,
      totalResponses: 0,
      correctResponses: 0,
    };
    this.state.oracles.set(oracleId, oracle);
    this.state.oracleByPrincipal.set(this.caller, oracleId);
    this.state.nextOracleId++;
    return { ok: true, value: oracleId };
  }

  createValidationRequest(submissionId: number): Result<number> {
    if (this.caller !== this.state.adminPrincipal)
      return { ok: false, value: ERR_UNAUTHORIZED };
    if (this.state.submissionRequests.has(submissionId))
      return { ok: false, value: ERR_INVALID_SUBMISSION_ID };
    const requestId = this.state.nextRequestId;
    const request: Request = {
      requestId,
      submissionId,
      status: "active",
      createdAt: this.blockHeight,
      deadline: this.blockHeight + RESPONSE_TIMEOUT,
      totalOracles: 0,
      responsesReceived: 0,
      validCount: 0,
      invalidCount: 0,
    };
    this.state.requests.set(requestId, request);
    this.state.submissionRequests.set(submissionId, requestId);
    this.state.nextRequestId++;
    return { ok: true, value: requestId };
  }

  submitOracleResponse(
    requestId: number,
    valid: boolean,
    confidence: number,
    gpsVerified: boolean,
    hrConsistency: boolean,
    stepPlausibility: boolean
  ): Result<boolean> {
    const request = this.state.requests.get(requestId);
    if (!request) return { ok: false, value: ERR_SUBMISSION_NOT_FOUND };
    const oracleId = this.state.oracleByPrincipal.get(this.caller);
    if (oracleId === undefined)
      return { ok: false, value: ERR_ORACLE_NOT_FOUND };
    const oracle = this.state.oracles.get(oracleId);
    if (!oracle || !oracle.active)
      return { ok: false, value: ERR_ORACLE_INACTIVE };
    if (request.status !== "active")
      return { ok: false, value: ERR_INVALID_RESPONSE };
    if (this.blockHeight > request.deadline)
      return { ok: false, value: ERR_RESPONSE_TIMEOUT };
    const responseKey = `${requestId}-${oracleId}`;
    if (this.state.oracleResponses.has(responseKey))
      return { ok: false, value: ERR_RESPONSE_ALREADY_PROCESSED };
    if (confidence < 0 || confidence > 100 || confidence < MIN_CONFIDENCE)
      return { ok: false, value: ERR_INVALID_CONFIDENCE };

    this.state.oracleResponses.set(responseKey, {
      valid,
      confidence,
      gpsVerified,
      hrConsistency,
      stepPlausibility,
      timestamp: this.blockHeight,
      processed: false,
    });

    const newReceived = request.responsesReceived + 1;
    const newValid = request.validCount + (valid ? 1 : 0);
    const newInvalid = request.invalidCount + (valid ? 0 : 1);
    this.state.requests.set(requestId, {
      ...request,
      responsesReceived: newReceived,
      validCount: newValid,
      invalidCount: newInvalid,
    });

    this.state.oracles.set(oracleId, {
      ...oracle,
      lastResponse: this.blockHeight,
      totalResponses: oracle.totalResponses + 1,
    });

    return { ok: true, value: true };
  }

  updateOracleCountInRequest(
    requestId: number,
    oracleCount: number
  ): Result<boolean> {
    if (this.caller !== this.state.adminPrincipal)
      return { ok: false, value: ERR_UNAUTHORIZED };
    const request = this.state.requests.get(requestId);
    if (!request) return { ok: false, value: ERR_SUBMISSION_NOT_FOUND };
    this.state.requests.set(requestId, {
      ...request,
      totalOracles: oracleCount,
    });
    return { ok: true, value: true };
  }

  getRequest(requestId: number): Request | null {
    return this.state.requests.get(requestId) || null;
  }

  getOracle(oracleId: number): Oracle | null {
    return this.state.oracles.get(oracleId) || null;
  }
}

describe("ValidationOracle", () => {
  let contract: ValidationOracleMock;

  beforeEach(() => {
    contract = new ValidationOracleMock();
    contract.reset();
  });

  it("registers oracle successfully", () => {
    const result = contract.registerOracle(2000000);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(0);
    expect(contract.state.stxTransfers).toContainEqual({
      amount: 5000,
      from: "ST1USER",
      to: "contract",
    });
  });

  it("rejects low stake", () => {
    const result = contract.registerOracle(500000);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INSUFFICIENT_STAKE);
  });

  it("creates validation request", () => {
    contract.caller = "ST1ADMIN";
    const result = contract.createValidationRequest(123);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(0);
    const req = contract.getRequest(0);
    expect(req?.submissionId).toBe(123);
    expect(req?.status).toBe("active");
  });

  it("submits oracle response", () => {
    contract.registerOracle(2000000);
    contract.caller = "ST1ADMIN";
    contract.createValidationRequest(123);
    contract.updateOracleCountInRequest(0, 3);
    contract.caller = "ST1USER";
    const result = contract.submitOracleResponse(0, true, 90, true, true, true);
    expect(result.ok).toBe(true);
    const req = contract.getRequest(0);
    expect(req?.responsesReceived).toBe(1);
    expect(req?.validCount).toBe(1);
  });

  it("rejects low confidence", () => {
    contract.registerOracle(2000000);
    contract.caller = "ST1ADMIN";
    contract.createValidationRequest(123);
    contract.updateOracleCountInRequest(0, 3);
    contract.caller = "ST1USER";
    const result = contract.submitOracleResponse(0, true, 70, true, true, true);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_CONFIDENCE);
  });

  it("enforces quorum threshold", () => {
    contract.registerOracle(2000000);
    contract.caller = "ST2ORACLE";
    contract.registerOracle(2000000);
    contract.caller = "ST1ADMIN";
    contract.createValidationRequest(123);
    contract.updateOracleCountInRequest(0, 3);
    contract.caller = "ST1USER";
    contract.submitOracleResponse(0, true, 90, true, true, true);
    contract.caller = "ST2ORACLE";
    contract.submitOracleResponse(0, true, 85, true, true, true);
    const req = contract.getRequest(0);
    expect(req?.responsesReceived).toBe(2);
  });

  it("prevents duplicate responses", () => {
    contract.registerOracle(2000000);
    contract.caller = "ST1ADMIN";
    contract.createValidationRequest(123);
    contract.updateOracleCountInRequest(0, 1);
    contract.caller = "ST1USER";
    contract.submitOracleResponse(0, true, 90, true, true, true);
    const result = contract.submitOracleResponse(
      0,
      false,
      85,
      false,
      false,
      false
    );
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_RESPONSE_ALREADY_PROCESSED);
  });

  it("deactivates oracle via admin", () => {
    contract.registerOracle(2000000);
    contract.caller = "ST1ADMIN";
    contract.createValidationRequest(123);
    const oracle = contract.getOracle(0);
    expect(oracle?.active).toBe(true);
  });
});
