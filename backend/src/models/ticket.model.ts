import { ObjectId } from "mongodb";
import mongoose from "mongoose";

const { Schema, model, models } = mongoose;

export type TicketStatus = "open" | "in-progress" | "blocked" | "reviewed" | "closed" | "deleted";
export type TicketPriority = "low" | "medium" | "high" | "critical";

const ALL_STATUSES: TicketStatus[] = [
  "open",
  "in-progress",
  "blocked",
  "reviewed",
  "closed",
  "deleted",
];
const ALL_PRIORITIES: TicketPriority[] = ["low", "medium", "high", "critical"];

const ticketSchema = new Schema(
  {
    teamId: { type: String, required: true, index: true },
    title: { type: String, required: true },
    description: { type: String },
    github: { type: String, required: true, default: "" },
    status: { type: String, enum: ALL_STATUSES, required: true, default: "open", index: true },
    priority: { type: String, enum: ALL_PRIORITIES },
    createdBy: { type: String, required: true, index: true },
    assignedTo: { type: [String], default: [], index: true },
    reviewedBy: { type: String },
    reviewedAt: { type: Date },
    updatedBy: { type: String },
    createdAt: { type: Date, required: true, default: () => new Date() },
    updatedAt: { type: Date },
    sharedWithTimeharbor: { type: Boolean },
    externalTrackedMs: { type: Number },
  },
  {
    collection: "tickets",
    versionKey: false,
  }
);

// Auto-set updatedAt on every save
ticketSchema.pre("save", async function () {
  this.updatedAt = new Date();
});

export type Ticket = mongoose.InferSchemaType<typeof ticketSchema> & {
  _id: ObjectId;
};

export const TicketModel = models.Ticket || model("Ticket", ticketSchema);

// ─── Query helpers ────────────────────────────────────────────────────────────

export async function findTicketById(id: string): Promise<Ticket | null> {
  if (!mongoose.Types.ObjectId.isValid(id)) return null;
  return TicketModel.findById(id).lean<Ticket>().exec();
}

export async function findTicketsByTeam(teamId: string): Promise<Ticket[]> {
  return TicketModel.find({ teamId, status: { $ne: "deleted" } })
    .sort({ createdAt: -1 })
    .lean<Ticket[]>()
    .exec();
}
