export interface CreateUserInput {
  name: string;
  active: boolean;
}

export interface OriginUser {
  id: number;
  score: number;
}

export interface UserResponse {
  id: number;
  name: string;
  score: number;
  active: boolean;
  sameReference: boolean;
}
