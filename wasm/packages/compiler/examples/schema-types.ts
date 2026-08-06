export type CreateUserBody = {
  name: string
  age: i32
  active: bool
}

export type LoginBody = {
  email: string
  password: string
}
