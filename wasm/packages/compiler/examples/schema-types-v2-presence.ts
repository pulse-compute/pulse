export type PresenceBodyV2 = {
  id: string
  alias?: string
  nickname: string | null
  bio?: string | null
  profile?: {
    active: bool
    note?: string | null
  } | null
}
