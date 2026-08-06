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

const P256_PUBLIC_KEY_BYTES: usize = 64;
const ES256_SIGNATURE_BYTES: usize = 64;
const ES256_SIGNING_INPUT_BYTES_MAXIMUM: usize = 16_340;

const STATUS_VALID: i32 = 1;
const STATUS_INVALID_AUTHENTICATOR: i32 = 0;
const STATUS_INVALID_KEY: i32 = -1;
const STATUS_INVALID_INPUT: i32 = -2;

#[panic_handler]
fn panic(_info: &PanicInfo<'_>) -> ! {
    loop {
        core::hint::spin_loop();
    }
}

/// Dependency-selection probe only. G1 owns the private frame and production
/// guest ABI; this function must not become an application or package API.
///
/// # Safety
///
/// The caller must provide readable, non-overlapping spans in the imported
/// fixed memory. G0 executes only maintainer-controlled vectors. G1 must
/// replace this probe boundary with complete frame validation before any
/// dereference.
#[no_mangle]
pub unsafe extern "C" fn pulse_es256_dependency_probe(
    key_pointer: u32,
    key_length: u32,
    data_pointer: u32,
    data_length: u32,
    signature_pointer: u32,
    signature_length: u32,
) -> i32 {
    if key_length as usize != P256_PUBLIC_KEY_BYTES {
        return STATUS_INVALID_KEY;
    }
    if signature_length as usize != ES256_SIGNATURE_BYTES
        || data_length as usize > ES256_SIGNING_INPUT_BYTES_MAXIMUM
    {
        return STATUS_INVALID_INPUT;
    }

    let key_bytes = slice::from_raw_parts(
        key_pointer as *const u8,
        P256_PUBLIC_KEY_BYTES,
    );
    let data = slice::from_raw_parts(
        data_pointer as *const u8,
        data_length as usize,
    );
    let signature_bytes = slice::from_raw_parts(
        signature_pointer as *const u8,
        ES256_SIGNATURE_BYTES,
    );

    let mut sec1_key = [0_u8; P256_PUBLIC_KEY_BYTES + 1];
    sec1_key[0] = 0x04;
    sec1_key[1..].copy_from_slice(key_bytes);

    let encoded_point = match EncodedPoint::from_bytes(sec1_key) {
        Ok(value) => value,
        Err(_) => return STATUS_INVALID_KEY,
    };
    let affine_point = match Option::<AffinePoint>::from(
        AffinePoint::from_encoded_point(&encoded_point),
    ) {
        Some(value) => value,
        None => return STATUS_INVALID_KEY,
    };
    let public_point = ProjectivePoint::from(affine_point);
    let signature = match P256Signature::from_slice(signature_bytes) {
        Ok(value) => value,
        Err(_) => return STATUS_INVALID_INPUT,
    };
    let digest = Sha256::digest(data);
    let digest_field = match bits2field::<NistP256>(&digest) {
        Ok(value) => value,
        Err(_) => return STATUS_INVALID_INPUT,
    };

    match verify_prehashed::<NistP256>(
        &public_point,
        &digest_field,
        &signature,
    ) {
        Ok(()) => STATUS_VALID,
        Err(_) => STATUS_INVALID_AUTHENTICATOR,
    }
}
