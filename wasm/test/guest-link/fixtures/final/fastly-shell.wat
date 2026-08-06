(module
  (import "env" "memory" (memory $memory 32 32))
  (import "env" "pulseRunMemoryCase" (func $run-case (param i32) (result i32)))
  (import "env" "pulseRunEveryByteProbe" (func $run-every-byte (result i32)))
  (import "env" "pulseGuestInvalidStatus" (func $guest-status (param i32 i32) (result i32)))
  (import "env" "pulseMemoryBytes" (func $memory-bytes (result i32)))
  (import "env" "pulseMaxGuestLength" (func $max-length (result i32)))
  (import "env" "pulseInvalidRangeStatus" (func $invalid-status (result i32)))
  (import "env" "pulsePrimaryLayoutMarkerPointer" (func $primary-marker-pointer (result i32)))
  (import "env" "pulse_guest_layout_marker_pointer" (func $guest-marker-pointer (result i32)))

  (import "fastly_http_body" "new" (func $body-new (param i32) (result i32)))
  (import "fastly_http_body" "write" (func $body-write (param i32 i32 i32 i32 i32) (result i32)))
  (import "fastly_http_resp" "new" (func $response-new (param i32) (result i32)))
  (import "fastly_http_resp" "status_set" (func $response-status-set (param i32 i32) (result i32)))
  (import "fastly_http_resp" "header_insert" (func $response-header-insert (param i32 i32 i32 i32 i32) (result i32)))
  (import "fastly_http_resp" "send_downstream" (func $response-send-downstream (param i32 i32 i32) (result i32)))

  (data (i32.const 327680) "content-type")
  (data (i32.const 327696) "application/json")
  (data (i32.const 327712) "{\"status\":\"passed\",\"cases\":5,\"invalid\":9,\"empty\":2,\"boundary\":2,\"bytes\":2097152,\"max\":4096,\"sentinel\":true,\"everyByte\":64}\0a")
  (data (i32.const 327840) "{\"status\":\"failed\"}\0a")

  (func $expect (param $actual i32) (param $expected i32) (result i32)
    (i32.ne (local.get $actual) (local.get $expected))
  )

  (func $check-host-status (param $status i32)
    (if (local.get $status)
      (then unreachable)
    )
  )

  (func $_start
    (local $failed i32)
    (local $response i32)
    (local $body i32)
    (local $body-pointer i32)
    (local $body-length i32)

    (local.set $failed
      (i32.or
        (local.get $failed)
        (call $expect (call $memory-bytes) (i32.const 2097152))
      )
    )
    (local.set $failed
      (i32.or
        (local.get $failed)
        (call $expect (call $max-length) (i32.const 4096))
      )
    )
    (local.set $failed
      (i32.or
        (local.get $failed)
        (call $expect (call $invalid-status) (i32.const -2147483648))
      )
    )
    (local.set $failed
      (i32.or
        (local.get $failed)
        (call $expect (call $guest-marker-pointer) (i32.const 131072))
      )
    )
    (local.set $failed
      (i32.or
        (local.get $failed)
        (call $expect (call $primary-marker-pointer) (i32.const 262144))
      )
    )
    (local.set $failed
      (i32.or
        (local.get $failed)
        (call $expect (i32.load8_u (i32.const 131072)) (i32.const 80))
      )
    )
    (local.set $failed
      (i32.or
        (local.get $failed)
        (call $expect (i32.load8_u (i32.const 262144)) (i32.const 65))
      )
    )

    (local.set $failed
      (i32.or (local.get $failed) (call $expect (call $run-case (i32.const 0)) (i32.const 0)))
    )
    (local.set $failed
      (i32.or (local.get $failed) (call $expect (call $run-case (i32.const 1)) (i32.const 0)))
    )
    (local.set $failed
      (i32.or (local.get $failed) (call $expect (call $run-case (i32.const 2)) (i32.const 0)))
    )
    (local.set $failed
      (i32.or (local.get $failed) (call $expect (call $run-case (i32.const 3)) (i32.const 0)))
    )
    (local.set $failed
      (i32.or (local.get $failed) (call $expect (call $run-case (i32.const 4)) (i32.const 0)))
    )
    (local.set $failed
      (i32.or (local.get $failed) (call $expect (call $run-every-byte) (i32.const 0)))
    )

    (local.set $failed
      (i32.or
        (local.get $failed)
        (call $expect
          (call $guest-status (i32.const 2097153) (i32.const 0))
          (i32.const -2147483648)
        )
      )
    )
    (local.set $failed
      (i32.or
        (local.get $failed)
        (call $expect
          (call $guest-status (i32.const 2097152) (i32.const 1))
          (i32.const -2147483648)
        )
      )
    )
    (local.set $failed
      (i32.or
        (local.get $failed)
        (call $expect
          (call $guest-status (i32.const 2097151) (i32.const 2))
          (i32.const -2147483648)
        )
      )
    )
    (local.set $failed
      (i32.or
        (local.get $failed)
        (call $expect
          (call $guest-status (i32.const -1) (i32.const 0))
          (i32.const -2147483648)
        )
      )
    )
    (local.set $failed
      (i32.or
        (local.get $failed)
        (call $expect
          (call $guest-status (i32.const -1) (i32.const 1))
          (i32.const -2147483648)
        )
      )
    )
    (local.set $failed
      (i32.or
        (local.get $failed)
        (call $expect
          (call $guest-status (i32.const -16) (i32.const 32))
          (i32.const -2147483648)
        )
      )
    )
    (local.set $failed
      (i32.or
        (local.get $failed)
        (call $expect
          (call $guest-status (i32.const 2097148) (i32.const 8))
          (i32.const -2147483648)
        )
      )
    )
    (local.set $failed
      (i32.or
        (local.get $failed)
        (call $expect
          (call $guest-status (i32.const 524288) (i32.const 4097))
          (i32.const -2147483648)
        )
      )
    )
    (local.set $failed
      (i32.or
        (local.get $failed)
        (call $expect
          (call $guest-status (i32.const 0) (i32.const 2097153))
          (i32.const -2147483648)
        )
      )
    )

    (local.set $failed
      (i32.or
        (local.get $failed)
        (call $expect
          (call $guest-status (i32.const 2097152) (i32.const 0))
          (i32.const 1566760132)
        )
      )
    )
    (local.set $failed
      (i32.or
        (local.get $failed)
        (call $expect
          (call $guest-status (i32.const 0) (i32.const 0))
          (i32.const 1566760132)
        )
      )
    )
    (local.set $failed
      (i32.or
        (local.get $failed)
        (call $expect
          (call $guest-status (i32.const 2097151) (i32.const 1))
          (i32.const 547441850)
        )
      )
    )
    (local.set $failed
      (i32.or
        (local.get $failed)
        (call $expect
          (call $guest-status (i32.const 526336) (i32.const 4096))
          (i32.const 1543232708)
        )
      )
    )

    (i32.store (i32.const 196608) (i32.const 0))
    (call $check-host-status (call $response-new (i32.const 196608)))
    (local.set $response (i32.load (i32.const 196608)))

    (i32.store (i32.const 196612) (i32.const 0))
    (call $check-host-status (call $body-new (i32.const 196612)))
    (local.set $body (i32.load (i32.const 196612)))

    (call $check-host-status
      (call $response-status-set
        (local.get $response)
        (select (i32.const 200) (i32.const 500) (i32.eqz (local.get $failed)))
      )
    )
    (call $check-host-status
      (call $response-header-insert
        (local.get $response)
        (i32.const 327680)
        (i32.const 12)
        (i32.const 327696)
        (i32.const 16)
      )
    )

    (local.set $body-pointer
      (select (i32.const 327712) (i32.const 327840) (i32.eqz (local.get $failed)))
    )
    (local.set $body-length
      (select (i32.const 123) (i32.const 20) (i32.eqz (local.get $failed)))
    )
    (i32.store (i32.const 196616) (i32.const 0))
    (call $check-host-status
      (call $body-write
        (local.get $body)
        (local.get $body-pointer)
        (local.get $body-length)
        (i32.const 0)
        (i32.const 196616)
      )
    )
    (local.set $failed
      (i32.or
        (local.get $failed)
        (i32.ne (i32.load (i32.const 196616)) (local.get $body-length))
      )
    )
    (call $check-host-status
      (call $response-send-downstream
        (local.get $response)
        (local.get $body)
        (i32.const 0)
      )
    )
  )

  (export "_start" (func $_start))
)
