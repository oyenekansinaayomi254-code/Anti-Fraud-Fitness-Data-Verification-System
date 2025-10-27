(define-constant ERR_INVALID_SUBMISSION u100)
(define-constant ERR_SUBMISSION_NOT_FOUND u101)
(define-constant ERR_UNAUTHORIZED u102)
(define-constant ERR_INVALID_HASH u103)
(define-constant ERR_INVALID_TIMESTAMP u104)
(define-constant ERR_INVALID_DEVICE_ID u105)
(define-constant ERR_INVALID_USER u106)
(define-constant ERR_SUBMISSION_EXISTS u107)
(define-constant ERR_INVALID_METADATA u108)
(define-constant ERR_INVALID_GPS u109)
(define-constant ERR_BLOCK_HEIGHT_MISMATCH u110)
(define-constant ERR_INVALID_STEPS u111)
(define-constant ERR_INVALID_HEART_RATE u112)
(define-constant ERR_INVALID_CALORIES u113)
(define-constant ERR_INVALID_DISTANCE u114)
(define-constant ERR_GPS_REQUIRED u115)
(define-constant ERR_METADATA_TOO_LARGE u116)
(define-constant ERR_INVALID_SESSION u117)
(define-constant ERR_SESSION_EXPIRED u118)
(define-constant ERR_INVALID_NONCE u119)

(define-constant MAX_METADATA_SIZE u256)
(define-constant MAX_GPS_SIZE u128)
(define-constant MIN_STEPS_PER_SESSION u0)
(define-constant MAX_STEPS_PER_SESSION u30000)
(define-constant MIN_HEART_RATE u40)
(define-constant MAX_HEART_RATE u220)
(define-constant MIN_CALORIES_PER_SESSION u0)
(define-constant MAX_CALORIES_PER_SESSION u5000)
(define-constant MIN_DISTANCE_PER_SESSION u0)
(define-constant MAX_DISTANCE_PER_SESSION u50)

(define-data-var next-submission-id uint u0)
(define-data-var admin-principal principal tx-sender)

(define-map submissions uint {
  submission-id: uint,
  user: principal,
  hash: (buff 32),
  timestamp: uint,
  block-height: uint,
  device-id: (buff 16),
  steps: uint,
  heart-rate-avg: uint,
  calories: uint,
  distance: uint,
  gps-data: (optional (buff 128)),
  metadata: (optional (buff 256)),
  session-nonce: uint,
  fraud-score: uint,
  status: (string-ascii 20)
})

(define-map user-submissions principal (list 50 uint))
(define-map submission-by-hash (buff 32) uint)
(define-map session-nonces principal uint)

(define-read-only (get-submission (submission-id uint))
  (map-get? submissions submission-id)
)

(define-read-only (get-user-submissions (user principal))
  (default-to (list) (map-get? user-submissions user))
)

(define-read-only (get-submission-by-hash (hash (buff 32)))
  (map-get? submission-by-hash hash)
)

(define-read-only (get-session-nonce (user principal))
  (default-to u0 (map-get? session-nonces user))
)

(define-read-only (get-next-submission-id)
  (var-get next-submission-id)
)

(define-private (validate-hash (hash (buff 32)))
  (if (is-eq (len hash) u32) (ok true) (err ERR_INVALID_HASH))
)

(define-private (validate-timestamp (timestamp uint))
  (if (and (>= timestamp block-height) (<= timestamp (+ block-height u10))) (ok true) (err ERR_INVALID_TIMESTAMP))
)

(define-private (validate-device-id (device-id (buff 16)))
  (if (is-eq (len device-id) u16) (ok true) (err ERR_INVALID_DEVICE_ID))
)

(define-private (validate-steps (steps uint))
  (if (and (>= steps MIN_STEPS_PER_SESSION) (<= steps MAX_STEPS_PER_SESSION)) (ok true) (err ERR_INVALID_STEPS))
)

(define-private (validate-heart-rate (hr uint))
  (if (and (>= hr MIN_HEART_RATE) (<= hr MAX_HEART_RATE)) (ok true) (err ERR_INVALID_HEART_RATE))
)

(define-private (validate-calories (cal uint))
  (if (and (>= cal MIN_CALORIES_PER_SESSION) (<= cal MAX_CALORIES_PER_SESSION)) (ok true) (err ERR_INVALID_CALORIES))
)

(define-private (validate-distance (dist uint))
  (if (and (>= dist MIN_DISTANCE_PER_SESSION) (<= dist MAX_DISTANCE_PER_SESSION)) (ok true) (err ERR_INVALID_DISTANCE))
)

(define-private (validate-gps (gps (optional (buff 128))))
  (match gps data (if (<= (len data) MAX_GPS_SIZE) (ok true) (err ERR_INVALID_GPS)) (ok true))
)

(define-private (validate-metadata (meta (optional (buff 256))))
  (match meta data (if (<= (len data) MAX_METADATA_SIZE) (ok true) (err ERR_METADATA_TOO_LARGE)) (ok true))
)

(define-private (validate-session-nonce (user principal) (nonce uint))
  (let ((current-nonce (get-session-nonce user)))
    (if (is-eq nonce (+ current-nonce u1)) (ok true) (err ERR_INVALID_NONCE))
  )
)

(define-private (update-session-nonce (user principal))
  (let ((current (get-session-nonce user)))
    (map-set session-nonces user (+ current u1))
  )
)

(define-public (submit-data
  (hash (buff 32))
  (timestamp uint)
  (device-id (buff 16))
  (steps uint)
  (heart-rate-avg uint)
  (calories uint)
  (distance uint)
  (gps-data (optional (buff 128)))
  (metadata (optional (buff 256)))
  (session-nonce uint)
)
  (let (
    (submission-id (var-get next-submission-id))
    (user tx-sender)
  )
    (try! (validate-hash hash))
    (try! (validate-timestamp timestamp))
    (try! (validate-device-id device-id))
    (try! (validate-steps steps))
    (try! (validate-heart-rate heart-rate-avg))
    (try! (validate-calories calories))
    (try! (validate-distance distance))
    (try! (validate-gps gps-data))
    (try! (validate-metadata metadata))
    (try! (validate-session-nonce user session-nonce))
    (asserts! (is-none (map-get? submission-by-hash hash)) (err ERR_SUBMISSION_EXISTS))
    (map-set submissions submission-id {
      submission-id: submission-id,
      user: user,
      hash: hash,
      timestamp: timestamp,
      block-height: block-height,
      device-id: device-id,
      steps: steps,
      heart-rate-avg: heart-rate-avg,
      calories: calories,
      distance: distance,
      gps-data: gps-data,
      metadata: metadata,
      session-nonce: session-nonce,
      fraud-score: u0,
      status: "pending"
    })
    (map-set submission-by-hash hash submission-id)
    (let ((user-list (get-user-submissions user)))
      (map-set user-submissions user (if (< (len user-list) u50)
        (append user-list submission-id)
        (append (unwrap-panic (as-max-len? (slice? user-list u1 u50) u49)) submission-id)
      ))
    )
    (update-session-nonce user)
    (var-set next-submission-id (+ submission-id u1))
    (print { event: "data-submitted", id: submission-id, user: user })
    (ok submission-id)
  )
)

(define-public (update-submission-status (submission-id uint) (new-status (string-ascii 20)))
  (let ((submission (unwrap! (get-submission submission-id) (err ERR_SUBMISSION_NOT_FOUND))))
    (asserts! (is-eq tx-sender (var-get admin-principal)) (err ERR_UNAUTHORIZED))
    (asserts! (or (is-eq new-status "verified") (is-eq new-status "flagged") (is-eq new-status "rejected")) (err ERR_INVALID_METADATA))
    (map-set submissions submission-id (merge submission { status: new-status }))
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

(define-public (get-submission-count)
  (ok (var-get next-submission-id))
)