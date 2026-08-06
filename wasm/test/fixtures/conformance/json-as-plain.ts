class __Pulse_CompatibilityUser {
  id: string = ''
  attempts: i32 = 0
  score: f64 = 0.0
  active: bool = false
  tags: Array<string> = []
}

export function baseline_construct(): i32 {
  const value = new __Pulse_CompatibilityUser()
  value.id = 'u1'
  value.attempts = 2
  value.score = 1.5
  value.active = true
  value.tags = ['one']
  return value.id == 'u1' && value.tags.length == 1 ? 1 : 0
}
