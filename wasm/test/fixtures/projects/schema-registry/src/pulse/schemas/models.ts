import type { Int32, Uint32 } from '@pulse-compute/pulse/schema'

export interface PostalAddress {
  city: string
  postalCode: string
}

export interface CreateUserInput {
  name: string
  attempts: Int32
  quota: Uint32
  role: 'admin' | 'member'
  address: PostalAddress
  tags: string[]
  referralCode: string | null
}

export interface User {
  id: string
  name: string
  score: number
  active: boolean
}

export interface ApiError {
  code: string
  message: string
}
