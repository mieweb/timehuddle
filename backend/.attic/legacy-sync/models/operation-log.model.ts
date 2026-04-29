import { ObjectId } from "mongodb";

export interface OperationLog {
  _id: ObjectId;
  clientId: string;
  userId: string;
  category: string;
  action: string;
  result: "success" | "failure";
  target?: string;
  targetId?: string;
  details?: Record<string, unknown>;
  errorMessage?: string;
  timestamp: string;
  _rev: number;
  createdAt: Date;
  updatedAt: Date;
}
