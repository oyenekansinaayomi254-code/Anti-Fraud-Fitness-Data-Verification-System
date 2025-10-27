(define-constant ERR_INVALID_SUBMISSION_ID u100)
(define-constant ERR_SUBMISSION_NOT_FOUND u101)
(define-constant ERR_UNAUTHORIZED u102)
(define-constant ERR_INVALID_ORACLE_ID u103)
(define-constant ERR_ORACLE_ALREADY_EXISTS u104)
(define-constant ERR_ORACLE_NOT_FOUND u105)
(define-constant ERR_INVALID_RESPONSE u106)
(define-constant ERR_RESPONSE_TIMEOUT u107)
(define-constant ERR_INSUFFICIENT_STAKE u108)
(define-constant ERR_ORACLE_INACTIVE u109)
(define-constant ERR_INVALID_VALIDITY u110)
(define-constant ERR_INVALID_CONFIDENCE u111)
(define-constant ERR_INVALID_GPS_DATA u112)
(define-constant ERR_INVALID_HEART_RATE_DATA u113)
(define-constant ERR_INVALID_STEP_DATA u114)
(define-constant ERR_RESPONSE_ALREADY_PROCESSED u115)
(define-constant ERR_QUORUM_NOT_MET u116)
(define-constant ERR_INVALID_THRESHOLD u117)
(define-constant ERR_ORACLE_REGISTRATION_FEE u118)
(define-constant ERR_STAKE_TOO_LOW u119)

(define-constant MIN_STAKE u1000000)
(define-constant RESPONSE_TIMEOUT u100)
(define-constant MIN_CONFIDENCE u80)
(define-constant QUORUM_THRESHOLD u66)
(define-constant REGISTRATION_FEE u5000)

(define-data-var admin-principal principal tx-sender)
(define-data-var next-oracle-id uint u0)
(define-data-var next-request-id uint u0)

(define-map oracles uint {
  oracle-id: uint,
  principal: principal,
  stake: uint,
  reputation: uint,
  active: bool,
  registered-at: uint,
  last-response: uint,
  total-responses: uint,
  correct-responses: uint
})

(define-map oracle-by-principal principal uint)
(define-map requests uint {
  request-id: uint,
  submission-id: uint,
  status: (string-ascii 20),
  created-at: uint,
  deadline: uint,
  total-oracles: uint,
  responses-received: uint,
  valid-count: uint,
  invalid-count: uint
})

(define-map oracle-responses { request-id: uint, oracle-id: uint } {
  valid: bool,
  confidence: uint,
  gps-verified: bool,
  hr-consistency: bool,
  step-plausibility: bool,
  timestamp: uint,
  processed: bool
})

(define-map submission-requests uint uint)

(define-read-only (get-oracle (oracle-id uint))
  (map-get? oracles oracle-id)
)

(define-read-only (get-oracle-by-principal (principal principal))
  (map-get? oracle-by-principal principal)
)

(define-read-only (get-request (request-id uint))
  (map-get? requests request-id)
)

(define-read-only (get-response (request-id uint) (oracle-id uint))
  (map-get? oracle-responses { request-id: request-id, oracle-id: oracle-id })
)

(define-read-only (get-next-oracle-id)
  (var-get next-oracle-id)
)

(define-read-only (get-next-request-id)
  (var-get next-request-id)
)

(define-private (validate-confidence (confidence uint))
  (if (and (>= confidence u0) (<= confidence u100)) (ok true) (err ERR_INVALID_CONFIDENCE))
)

(define-private (validate-stake (stake uint))
  (if (>= stake MIN_STAKE) (ok true) (err ERR_STAKE_TOO_LOW))
)

(define-read-only (calculate-reputation (correct uint) (total uint))
  (if (> total u0)
    (ok (/ (* correct u100) total))
    (ok u0)
  )
)

(define-public (register-oracle (stake-amount uint))
  (let (
    (oracle-id (var-get next-oracle-id))
    (caller tx-sender)
  )
    (asserts! (is-none (map-get? oracle-by-principal caller)) (err ERR_ORACLE_ALREADY_EXISTS))
    (try! (validate-stake stake-amount))
    (try! (stx-transfer? REGISTRATION_FEE caller (as-contract tx-sender)))
    (map-set oracles oracle-id {
      oracle-id: oracle-id,
      principal: caller,
      stake: stake-amount,
      reputation: u0,
      active: true,
      registered-at: block-height,
      last-response: u0,
      total-responses: u0,
      correct-responses: u0
    })
    (map-set oracle-by-principal caller oracle-id)
    (var-set next-oracle-id (+ oracle-id u1))
    (print { event: "oracle-registered", id: oracle-id, principal: caller })
    (ok oracle-id)
  )
)

(define-public (create-validation-request (submission-id uint))
  (let (
    (request-id (var-get next-request-id))
    (admin (var-get admin-principal))
  )
    (asserts! (is-eq tx-sender admin) (err ERR_UNAUTHORIZED))
    (asserts! (is-none (map-get? submission-requests submission-id)) (err ERR_INVALID_SUBMISSION_ID))
    (map-set requests request-id {
      request-id: request-id,
      submission-id: submission-id,
      status: "active",
      created-at: block-height,
      deadline: (+ block-height RESPONSE_TIMEOUT),
      total-oracles: u0,
      responses-received: u0,
      valid-count: u0,
      invalid-count: u0
    })
    (map-set submission-requests submission-id request-id)
    (var-set next-request-id (+ request-id u1))
    (print { event: "validation-request-created", request-id: request-id, submission-id: submission-id })
    (ok request-id)
  )
)

(define-public (submit-oracle-response
  (request-id uint)
  (valid bool)
  (confidence uint)
  (gps-verified bool)
  (hr-consistency bool)
  (step-plausibility bool)
)
  (let (
    (request (unwrap! (get-request request-id) (err ERR_SUBMISSION_NOT_FOUND)))
    (oracle-id (unwrap! (get-oracle-by-principal tx-sender) (err ERR_ORACLE_NOT_FOUND)))
    (oracle (unwrap! (get-oracle oracle-id) (err ERR_ORACLE_NOT_FOUND)))
    (existing-response (get-response request-id oracle-id))
  )
    (asserts! (get active oracle) (err ERR_ORACLE_INACTIVE))
    (asserts! (is-eq (get status request) "active") (err ERR_INVALID_RESPONSE))
    (asserts! (<= block-height (get deadline request)) (err ERR_RESPONSE_TIMEOUT))
    (asserts! (is-none existing-response) (err ERR_RESPONSE_ALREADY_PROCESSED))
    (try! (validate-confidence confidence))
    (asserts! (>= confidence MIN_CONFIDENCE) (err ERR_INVALID_CONFIDENCE))
    (map-set oracle-responses { request-id: request-id, oracle-id: oracle-id } {
      valid: valid,
      confidence: confidence,
      gps-verified: gps-verified,
      hr-consistency: hr-consistency,
      step-plausibility: step-plausibility,
      timestamp: block-height,
      processed: false
    })
    (let ((new-received (+ (get responses-received request) u1)))
      (map-set requests request-id
        (merge request {
          responses-received: new-received,
          valid-count: (if valid (+ (get valid-count request) u1) (get valid-count request)),
          invalid-count: (if (not valid) (+ (get invalid-count request) u1) (get invalid-count request))
        })
      )
      (map-set oracles oracle-id
        (merge oracle {
          last-response: block-height,
          total-responses: (+ (get total-responses oracle) u1)
        })
      )
      (try! (finalize-request-if-quorum request-id))
      (ok true)
    )
  )
)

(define-private (finalize-request-if-quorum (request-id uint))
  (let ((request (unwrap! (get-request request-id) (err ERR_SUBMISSION_NOT_FOUND))))
    (if (>= (* (get responses-received request) u100) (* (get total-oracles request) QUORUM_THRESHOLD))
      (begin
        (map-set requests request-id (merge request { status: "finalized" }))
        (print { event: "request-finalized", request-id: request-id, valid: (>= (* (get valid-count request) u100) (* (get responses-received request) QUORUM_THRESHOLD)) })
        (ok true)
      )
      (ok false)
    )
  )
)

(define-public (deactivate-oracle (oracle-id uint))
  (let ((oracle (unwrap! (get-oracle oracle-id) (err ERR_ORACLE_NOT_FOUND))))
    (asserts! (is-eq tx-sender (var-get admin-principal)) (err ERR_UNAUTHORIZED))
    (map-set oracles oracle-id (merge oracle { active: false }))
    (ok true)
  )
)

(define-public (set-admin (new-admin principal))
  (begin
    (asserts! (is-eq tx-sender (var-get admin-principal)) (err ERR_UNAUTHORIZED))
    (var-set admin-principal new-admin)
    (ok true)
  )
)

(define-public (update-oracle-count-in-request (request-id uint) (oracle-count uint))
  (let ((request (unwrap! (get-request request-id) (err ERR_SUBMISSION_NOT_FOUND))))
    (asserts! (is-eq tx-sender (var-get admin-principal)) (err ERR_UNAUTHORIZED))
    (map-set requests request-id (merge request { total-oracles: oracle-count }))
    (ok true)
  )
)