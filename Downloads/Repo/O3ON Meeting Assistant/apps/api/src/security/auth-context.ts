import { Role } from "@o3on/contracts";

export interface AuthContext {
  userId: string;
  email: string;
  orgId: string;
  role: Role;
  exp?: number;
}
