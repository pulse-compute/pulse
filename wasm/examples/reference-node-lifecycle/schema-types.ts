export interface CreateUserRequest {
  id: string;
  name: string;
  active: boolean;
}

export interface CreateUserResponse {
  id: string;
  name: string;
  active: boolean;
}

export interface UserResponse {
  id: string;
  name: string;
  active: boolean;
}

export interface UpstreamCreateUserRequest {
  id: string
  name: string
  active: boolean
}
