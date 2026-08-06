const valid =
  'eyJ0eXAiOiJKV1QiLCJraWQiOiJnMy1rZXkiLCJhbGciOiJFUzI1NiJ9.' +
  'eyJzdWIiOiJnMy1zZW5zaXRpdmUtc3ViamVjdCIsImlhdCI6MTk5OTk5OTk5MCwi' +
  'ZXhwIjoyMDAwMDAwMDYwLCJyb2xlcyI6WyJtZW1iZXIiXX0.' +
  'LgxFHy8spsAvPR5FgmnHS1MnVWEr7rAOVtS-PMSrwnabWfD3tEmOam2km7ZCLiX2' +
  'l2a_0ycVMIy6VMk95_ZOkQ'

const wrongSignature =
  'eyJ0eXAiOiJKV1QiLCJraWQiOiJnMy1rZXkiLCJhbGciOiJFUzI1NiJ9.' +
  'eyJzdWIiOiJnMy1zZW5zaXRpdmUtc3ViamVjdCIsImlhdCI6MTk5OTk5OTk5MCwi' +
  'ZXhwIjoyMDAwMDAwMDYwLCJyb2xlcyI6WyJtZW1iZXIiXX0.' +
  'rgxFHy8spsAvPR5FgmnHS1MnVWEr7rAOVtS-PMSrwnabWfD3tEmOam2km7ZCLiX2' +
  'l2a_0ycVMIy6VMk95_ZOkQ'

const disallowedAlgorithm =
  'eyJ0eXAiOiJKV1QiLCJraWQiOiJnMy1rZXkiLCJhbGciOiJIUzI1NiJ9.' +
  'eyJzdWIiOiJnMy1zZW5zaXRpdmUtc3ViamVjdCIsImlhdCI6MTk5OTk5OTk5MCwi' +
  'ZXhwIjoyMDAwMDAwMDYwLCJyb2xlcyI6WyJtZW1iZXIiXX0.' +
  'LgxFHy8spsAvPR5FgmnHS1MnVWEr7rAOVtS-PMSrwnabWfD3tEmOam2km7ZCLiX2' +
  'l2a_0ycVMIy6VMk95_ZOkQ'

function authorization(token: string) {
  return { authorization: `Bearer ${token}` }
}

export default { cases: [
  {
    name: 'valid ES256 bearer',
    request: { method: 'GET', path: '/verify', headers: authorization(valid) },
    expect: { status: 200, text: 'g3-sensitive-subject:ES256' },
  },
  {
    name: 'wrong ES256 signature',
    request: {
      method: 'GET',
      path: '/verify',
      headers: authorization(wrongSignature),
    },
    expect: {
      error: { name: 'JwtError', code: 'PULSE_JWT_SIGNATURE_INVALID' },
    },
  },
  {
    name: 'disallowed algorithm',
    request: {
      method: 'GET',
      path: '/verify',
      headers: authorization(disallowedAlgorithm),
    },
    expect: {
      error: { name: 'JwtError', code: 'PULSE_JWT_ALGORITHM_NOT_ALLOWED' },
    },
  },
] }
