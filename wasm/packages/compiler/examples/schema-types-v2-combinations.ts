export type RichComboBodyV2 = {
  id: string
  roles: Array<'admin' | 'user'>
  steps: Array<{
    kind: 'click' | 'view'
    count: i32
    note?: string | null
    score?: f64 | null
  }>
  profile?: {
    status: 'draft' | 'live'
    aliases: string[]
    metrics?: {
      score: f64 | null
    } | null
  } | null
}
