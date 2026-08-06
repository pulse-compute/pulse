export type CreateUserBodyV2 = {
  name: string
  tags: string[]
  profile?: {
    active: bool
    score: f64 | null
    role: 'admin' | 'user'
  } | null
}

export type LoginBodyV2 = {
  email: string
  password: string
  remember?: bool
}
