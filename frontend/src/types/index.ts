export interface User {
  id: string;
  email: string;
  name: string;
  createdAt?: string;
}

export interface FamilyMember {
  id: string;
  familyId: string;
  userId: string;
  role: 'admin' | 'member' | 'viewer';
  createdAt: string;
  user: User;
}

export interface Family {
  id: string;
  name: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
  members: FamilyMember[];
}

export interface AuthState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
}

export interface ApiError {
  error: string;
}
