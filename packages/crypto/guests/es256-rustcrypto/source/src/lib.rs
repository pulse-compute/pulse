#![no_std]

use core::{panic::PanicInfo, slice};
use ecdsa::{
    hazmat::{bits2field, verify_prehashed},
    Signature,
};
use p256::{
    elliptic_curve::sec1::FromEncodedPoint,
    AffinePoint,
    EncodedPoint,
    NistP256,
    ProjectivePoint,
};
use sha2::{Digest, Sha256};

type P256Signature = Signature<NistP256>;

const MEMORY_BYTES: u32 = 32 * 65_536;
const INVOCATION_REGION_START: u32 = 8 * 65_536;
const FRAME_MAGIC: u32 = 0x3253_4550;
const FRAME_VERSION: u32 = 2;
const FRAME_HEADER_BYTES: u32 = 64;
const FRAME_CAPACITY_BYTES: u32 = 16_640;
const FRAME_ALIGNMENT_BYTES: u32 = 16;
const FRAME_ALGORITHM_ES256: u32 = 1;
const P256_PUBLIC_KEY_BYTES: u32 = 64;
const ES256_SIGNATURE_BYTES: u32 = 64;
const ES256_SIGNING_INPUT_BYTES_MAXIMUM: u32 = 16_340;

const STATUS_VALID: i32 = 1;
const STATUS_INVALID_AUTHENTICATOR: i32 = 0;
const STATUS_INVALID_KEY: i32 = -1;
const STATUS_INVALID_INPUT: i32 = -2;

const HEADER_MAGIC: usize = 0;
const HEADER_VERSION: usize = 4;
const HEADER_LENGTH: usize = 8;
const HEADER_TOTAL_LENGTH: usize = 12;
const HEADER_ALGORITHM: usize = 16;
const HEADER_FLAGS: usize = 20;
const HEADER_SIGNING_INPUT_OFFSET: usize = 24;
const HEADER_SIGNING_INPUT_LENGTH: usize = 28;
const HEADER_PUBLIC_KEY_OFFSET: usize = 32;
const HEADER_PUBLIC_KEY_LENGTH: usize = 36;
const HEADER_SIGNATURE_OFFSET: usize = 40;
const HEADER_SIGNATURE_LENGTH: usize = 44;
const HEADER_RESERVED_0: usize = 48;
const HEADER_RESERVED_1: usize = 52;
const HEADER_RESERVED_2: usize = 56;
const HEADER_RESERVED_3: usize = 60;

#[derive(Clone, Copy)]
struct Span {
    start: u32,
    end: u32,
}

impl Span {
    fn checked(start: u32, length: u32, total_length: u32) -> Option<Self> {
        if start < FRAME_HEADER_BYTES
            || start % FRAME_ALIGNMENT_BYTES != 0
        {
            return None;
        }
        let end = start.checked_add(length)?;
        if end > total_length {
            return None;
        }
        Some(Self { start, end })
    }

    fn overlaps(self, other: Self) -> bool {
        self.start < other.end && other.start < self.end
    }
}

#[panic_handler]
fn panic(_info: &PanicInfo<'_>) -> ! {
    loop {
        core::hint::spin_loop();
    }
}

fn read_u32_le(bytes: &[u8], offset: usize) -> u32 {
    u32::from_le_bytes([
        bytes[offset],
        bytes[offset + 1],
        bytes[offset + 2],
        bytes[offset + 3],
    ])
}

fn outer_frame_is_valid(frame_pointer: u32, frame_capacity: u32) -> bool {
    if frame_capacity != FRAME_CAPACITY_BYTES
        || frame_pointer < INVOCATION_REGION_START
        || frame_pointer % FRAME_ALIGNMENT_BYTES != 0
    {
        return false;
    }
    match frame_pointer.checked_add(frame_capacity) {
        Some(end) => end <= MEMORY_BYTES,
        None => false,
    }
}

fn header_is_valid(frame: &[u8], key_bytes: u32) -> Option<(Span, Span, Span)> {
    signature_header(frame, key_bytes, ES256_SIGNATURE_BYTES, FRAME_ALGORITHM_ES256, ES256_SIGNING_INPUT_BYTES_MAXIMUM)
}

fn signature_header(frame: &[u8], key_bytes: u32, signature_bytes: u32, algorithm: u32, input_max: u32) -> Option<(Span, Span, Span)> {
    let total_length = read_u32_le(frame, HEADER_TOTAL_LENGTH);
    if read_u32_le(frame, HEADER_MAGIC) != FRAME_MAGIC
        || read_u32_le(frame, HEADER_VERSION) != FRAME_VERSION
        || read_u32_le(frame, HEADER_LENGTH) != FRAME_HEADER_BYTES
        || total_length < 192
        || total_length > FRAME_CAPACITY_BYTES
        || total_length % FRAME_ALIGNMENT_BYTES != 0
        || read_u32_le(frame, HEADER_ALGORITHM) != algorithm
        || read_u32_le(frame, HEADER_FLAGS) != 0
        || read_u32_le(frame, HEADER_RESERVED_0) != 0
        || read_u32_le(frame, HEADER_RESERVED_1) != 0
        || read_u32_le(frame, HEADER_RESERVED_2) != 0
        || read_u32_le(frame, HEADER_RESERVED_3) != 0
    {
        return None;
    }

    let signing_input_length =
        read_u32_le(frame, HEADER_SIGNING_INPUT_LENGTH);
    let public_key_length = read_u32_le(frame, HEADER_PUBLIC_KEY_LENGTH);
    let signature_length = read_u32_le(frame, HEADER_SIGNATURE_LENGTH);
    if signing_input_length > input_max
        || public_key_length != key_bytes
        || signature_length != signature_bytes
    {
        return None;
    }

    let signing_input = Span::checked(
        read_u32_le(frame, HEADER_SIGNING_INPUT_OFFSET),
        signing_input_length,
        total_length,
    )?;
    let public_key = Span::checked(
        read_u32_le(frame, HEADER_PUBLIC_KEY_OFFSET),
        public_key_length,
        total_length,
    )?;
    let signature = Span::checked(
        read_u32_le(frame, HEADER_SIGNATURE_OFFSET),
        signature_length,
        total_length,
    )?;

    if signing_input.start == public_key.start
        || signing_input.start == signature.start
        || public_key.start == signature.start
        || signing_input.overlaps(public_key)
        || signing_input.overlaps(signature)
        || public_key.overlaps(signature)
    {
        return None;
    }

    Some((signing_input, public_key, signature))
}

fn verify_es256(
    signing_input: &[u8],
    public_key_bytes: &[u8],
    signature_bytes: &[u8],
) -> i32 {
    let mut sec1_key = [0_u8; P256_PUBLIC_KEY_BYTES as usize + 1];
    sec1_key[0] = 0x04;
    sec1_key[1..].copy_from_slice(public_key_bytes);

    let encoded_point = match EncodedPoint::from_bytes(sec1_key) {
        Ok(value) => value,
        Err(_) => return STATUS_INVALID_KEY,
    };
    sec1_key.fill(0);

    let affine_point = match Option::<AffinePoint>::from(
        AffinePoint::from_encoded_point(&encoded_point),
    ) {
        Some(value) => value,
        None => return STATUS_INVALID_KEY,
    };
    let signature = match P256Signature::from_slice(signature_bytes) {
        Ok(value) => value,
        Err(_) => return STATUS_INVALID_INPUT,
    };
    let digest = Sha256::digest(signing_input);
    let digest_field = match bits2field::<NistP256>(&digest) {
        Ok(value) => value,
        Err(_) => return STATUS_INVALID_INPUT,
    };

    match verify_prehashed::<NistP256>(
        &ProjectivePoint::from(affine_point),
        &digest_field,
        &signature,
    ) {
        Ok(()) => STATUS_VALID,
        Err(_) => STATUS_INVALID_AUTHENTICATOR,
    }
}

/// Verifies one ES256 request encoded in the frozen private invocation frame.
///
/// The caller owns and clears the fixed-capacity frame after capturing the
/// scalar result. This guest does not retain frame pointers or mutate input.
///
/// # Safety
///
/// The host must instantiate this module with the declared fixed, unshared
/// 32-page `env.memory`. This function validates the outer range before its
/// first dereference and validates every described field before field access.
#[no_mangle]
pub unsafe extern "C" fn pulse_crypto_es256_verify(
    frame_pointer: u32,
    frame_capacity: u32,
) -> i32 {
    if !outer_frame_is_valid(frame_pointer, frame_capacity) {
        return STATUS_INVALID_INPUT;
    }

    let frame = slice::from_raw_parts(
        frame_pointer as *const u8,
        frame_capacity as usize,
    );
    let (signing_input, public_key, signature) =
        match header_is_valid(frame, P256_PUBLIC_KEY_BYTES) {
            Some(value) => value,
            None => return STATUS_INVALID_INPUT,
        };

    verify_es256(
        &frame[signing_input.start as usize..signing_input.end as usize],
        &frame[public_key.start as usize..public_key.end as usize],
        &frame[signature.start as usize..signature.end as usize],
    )
}


/// Sign one ES256 request using x || y || d private-key bytes. The frame
/// follows the verification envelope with a 96-byte key and writable output.
/// Input spans must not overlap. Callers clear the frame and borrowed Rust
/// stack after capturing the signature; this function retains no pointers.
#[no_mangle]
pub unsafe extern "C" fn pulse_crypto_es256_sign(frame_pointer: u32, frame_capacity: u32) -> i32 {
    use p256::ecdsa::{signature::hazmat::PrehashSigner, SigningKey};
    if !outer_frame_is_valid(frame_pointer, frame_capacity) { return STATUS_INVALID_INPUT; }
    let frame = slice::from_raw_parts_mut(frame_pointer as *mut u8, frame_capacity as usize);
    let (input, key, output) = match header_is_valid(frame, 96) {
        Some(value) => value, None => return STATUS_INVALID_INPUT,
    };
    // Clear output before validating the key so failed calls cannot expose a
    // prior signature. Header validation already proved disjoint spans.
    frame[output.start as usize..output.end as usize].fill(0);
    let key_start = key.start as usize;
    let signer = match SigningKey::from_slice(&frame[key_start + 64..key.end as usize]) {
        Ok(value) => value, Err(_) => return STATUS_INVALID_KEY,
    };
    let public = signer.verifying_key().to_encoded_point(false);
    if public.as_bytes()[1..] != frame[key_start..key_start + 64] { return STATUS_INVALID_KEY; }
    let digest = Sha256::digest(&frame[input.start as usize..input.end as usize]);
    // RustCrypto's deterministic RFC6979 signing requires no host randomness.
    let signature: P256Signature = match signer.sign_prehash(&digest) {
        Ok(value) => value, Err(_) => return STATUS_INVALID_KEY,
    };
    frame[output.start as usize..output.end as usize].copy_from_slice(&signature.to_bytes());
    STATUS_VALID
}


extern "C" {
    fn pulse_rs256(key: *const u8, key_len: usize, hash: *const u8,
        signature: *mut u8, modulus_len: usize, sign: i32) -> i32;
}

unsafe fn rsa_frame(pointer: u32, capacity: u32, sign: bool) -> i32 {
    if !outer_frame_is_valid(pointer, capacity) { return STATUS_INVALID_INPUT; }
    let frame = slice::from_raw_parts_mut(pointer as *mut u8, capacity as usize);
    let k = read_u32_le(frame, HEADER_SIGNATURE_LENGTH);
    if !matches!(k, 256 | 384 | 512) { return STATUS_INVALID_INPUT; }
    let key_len = if sign { 8 + k * 9 / 2 } else { 8 + k };
    let (input, key, output) = match signature_header(frame, key_len, k, 2, 12_288) {
        Some(value) => value, None => return STATUS_INVALID_INPUT,
    };
    if sign { frame[output.start as usize..output.end as usize].fill(0); }
    let hash = Sha256::digest(&frame[input.start as usize..input.end as usize]);
    pulse_rs256(frame.as_ptr().add(key.start as usize), key_len as usize,
        hash.as_ptr(), frame.as_mut_ptr().add(output.start as usize), k as usize, sign as i32)
}

/// RS256 uses the same checked v2 envelope, algorithm code 2, variable-width
/// key/signature spans, and a 12288-byte data bound. Caller clears frame/stack.
#[no_mangle]
pub unsafe extern "C" fn pulse_crypto_rs256_sign(pointer: u32, capacity: u32) -> i32 {
    rsa_frame(pointer, capacity, true)
}

#[no_mangle]
pub unsafe extern "C" fn pulse_crypto_rs256_verify(pointer: u32, capacity: u32) -> i32 {
    rsa_frame(pointer, capacity, false)
}
