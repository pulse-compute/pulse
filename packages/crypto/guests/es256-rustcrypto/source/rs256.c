/* Pulse RS256 adapter. RSA arithmetic is BearSSL 0.6's unmodified i31 code.
 * Wire: LE32(k), n[k], e[4], then d[k], p/q/dp/dq/qi[k/2] for signing.
 * All integers are unsigned big endian. Only balanced 2048/3072/4096 keys.
 * No allocation, entropy, host callbacks, or retained pointers.
 */
#include "inner.h"

#define WORDS 136
static const unsigned char sha256_oid[] = {9, 0x60, 0x86, 0x48, 1, 0x65, 3, 4, 2, 1};

static uint32_t equal(const unsigned char *a, const unsigned char *b, size_t n) {
    uint32_t diff = 0;
    for (size_t i = 0; i < n; i++) diff |= a[i] ^ b[i];
    return EQ(diff, 0);
}

/* Use the declared fixed width, including for secret exponents. BearSSL's
 * arithmetic lengths must not depend on their leading zero bits. */
static void decode(uint32_t *a, const unsigned char *p, size_t n) {
    memset(a, 0, WORDS * sizeof *a);
    br_i31_decode(a, p, n);
    a[0] = (uint32_t)((n * 8 / 31) * 32 + n * 8 % 31);
}

static uint32_t reduced_equal(const uint32_t *a, const uint32_t *m,
    const unsigned char *expected, size_t n) {
    uint32_t r[WORDS] = {0};
    unsigned char encoded[512];
    br_i31_reduce(r, a, m);
    br_i31_encode(encoded, n, r);
    return equal(encoded, expected, n);
}

/* Check n=p*q, d mod (p-1)=dp, d mod (q-1)=dq,
 * e*dp=1 mod (p-1), e*dq=1 mod (q-1), and q*qi=1 mod p.
 * These are consistency checks, not a primality proof/key generation API.
 * Factors have a fixed public width and top bit; no variable-time inverse. */
static uint32_t private_valid(const unsigned char *key, size_t k) {
    const size_t h = k / 2;
    const unsigned char *n = key + 4, *e = n + k, *d = e + 4;
    const unsigned char *p = d + k, *q = p + h, *dp = q + h;
    const unsigned char *dq = dp + h, *qi = dq + h;
    uint32_t a[WORDS], b[WORDS], product[WORDS], m[WORDS], one[WORDS];
    unsigned char encoded[512], expected[256] = {0};
    uint32_t ok = (p[0] >> 7) & (q[0] >> 7) & (p[h-1] & q[h-1] & 1);
    ok &= 1 ^ equal(p, q, h);
    decode(a, p, h); decode(b, q, h);
    memset(product, 0, sizeof product); product[0] = a[0];
    br_i31_mulacc(product, a, b); br_i31_encode(encoded, k, product);
    ok &= equal(encoded, n, k);
    decode(a, d, k); decode(m, n, k);
    ok &= br_i31_sub(a, m, 0);
    for (size_t i = 0; i < 2; i++) {
        decode(m, i == 0 ? p : q, h);
        memset(one, 0, sizeof one); one[0] = m[0]; one[1] = 1;
        br_i31_sub(m, one, 1);
        decode(a, d, k);
        ok &= reduced_equal(a, m, i == 0 ? dp : dq, h);
        decode(a, i == 0 ? dp : dq, h); decode(b, e, 4);
        memset(product, 0, sizeof product); product[0] = a[0];
        br_i31_mulacc(product, a, b);
        expected[h-1] = 1;
        ok &= reduced_equal(product, m, expected, h);
    }
    decode(m, p, h); decode(a, q, h); decode(b, qi, h);
    /* qi must be the canonical residue, not qi+p. */
    ok &= br_i31_sub(b, m, 0);
    memset(product, 0, sizeof product); product[0] = a[0];
    br_i31_mulacc(product, a, b);
    ok &= reduced_equal(product, m, expected, h);
    return ok;
}

static uint32_t public_valid(const unsigned char *key, size_t k) {
    const unsigned char *e = key + 4 + k;
    uint32_t exponent = br_dec32be(e);
    return (key[4] >> 7) & (key[3+k] & 1) & (exponent & 1) & GT(exponent, 2);
}

int pulse_rs256(const unsigned char *key, size_t key_len, const unsigned char *hash,
    unsigned char *signature, size_t k, int sign) {
    if (!(k == 256 || k == 384 || k == 512)
        || key_len != (sign ? 8 + k * 9 / 2 : 8 + k)
        || br_dec32le(key) != k || !public_valid(key, k)) return -1;
    unsigned char expected[512], actual[512];
    br_rsa_public_key pk = {(unsigned char *)key + 4, k, (unsigned char *)key + 4 + k, 4};
    if (!br_rsa_pkcs1_sig_pad(sha256_oid, hash, 32, (uint32_t)k * 8, expected)) return -2;
    if (sign) {
        if (!private_valid(key, k)) return -1;
        const size_t h = k / 2;
        unsigned char *p = (unsigned char *)key + 8 + 2*k;
        br_rsa_private_key sk = {(uint32_t)k*8, p, h, p+h, h, p+2*h, h, p+3*h, h, p+4*h, h};
        memcpy(actual, expected, k);
        if (!br_rsa_i31_private(actual, &sk)) return -1;
        memcpy(signature, actual, k);
    } else memcpy(actual, signature, k);
    /* Exact EMSA-PKCS1-v1_5 encoding, including NULL AlgorithmIdentifier.
     * Also a fault/CRT check before any private result is released. */
    uint32_t ok = br_rsa_i31_public(actual, k, &pk);
    ok &= equal(actual, expected, k);
    if (sign && !ok) { memset(signature, 0, k); return -1; }
    return (int)ok;
}
