import { ObjectId } from "mongodb";
import { teamsCollection, ticketsCollection } from "../models/index.js";
import type { Ticket, TicketStatus } from "../models/ticket.model.js";

type OwnerError = "not-found" | "forbidden";
type AssignError = "not-found" | "forbidden" | "bad-assignee";

function isValidId(id: string): boolean {
  return /^[0-9a-f]{24}$/i.test(id);
}

export class TicketService {
  async findById(id: string): Promise<Ticket | null> {
    if (!isValidId(id)) return null;
    return ticketsCollection().findOne({ _id: new ObjectId(id) });
  }

  async findByTeam(teamId: string, userId: string): Promise<Ticket[] | "forbidden"> {
    if (!isValidId(teamId)) return "forbidden";
    const team = await teamsCollection().findOne({
      _id: new ObjectId(teamId),
      $or: [{ members: userId }, { admins: userId }],
    });
    if (!team) return "forbidden";
    return ticketsCollection()
      .find({ teamId, status: { $ne: "deleted" as TicketStatus } })
      .sort({ createdAt: -1 })
      .toArray();
  }

  async create(data: {
    teamId: string;
    title: string;
    github: string;
    accumulatedTime: number;
    createdBy: string;
  }): Promise<{ id: string } | "forbidden"> {
    if (!isValidId(data.teamId)) return "forbidden";
    const team = await teamsCollection().findOne({
      _id: new ObjectId(data.teamId),
      $or: [{ members: data.createdBy }, { admins: data.createdBy }],
    });
    if (!team) return "forbidden";
    const result = await ticketsCollection().insertOne({
      _id: new ObjectId(),
      teamId: data.teamId,
      title: data.title,
      github: data.github,
      accumulatedTime: data.accumulatedTime,
      status: "open",
      createdBy: data.createdBy,
      assignedTo: data.createdBy,
      createdAt: new Date(),
    });
    return { id: result.insertedId.toHexString() };
  }

  async update(
    id: string,
    userId: string,
    updates: Partial<Pick<Ticket, "title" | "github" | "accumulatedTime" | "status">>
  ): Promise<Ticket | OwnerError> {
    const ticket = await this.findById(id);
    if (!ticket) return "not-found";
    if (ticket.createdBy !== userId) return "forbidden";
    await ticketsCollection().updateOne(
      { _id: new ObjectId(id) },
      { $set: { ...updates, updatedAt: new Date(), updatedBy: userId } }
    );
    return (await this.findById(id))!;
  }

  // Soft-delete so Phase 5 clock event cleanup can reference the ID.
  async delete(id: string, userId: string): Promise<"ok" | OwnerError> {
    const ticket = await this.findById(id);
    if (!ticket) return "not-found";
    if (ticket.createdBy !== userId) return "forbidden";
    await ticketsCollection().updateOne(
      { _id: new ObjectId(id) },
      { $set: { status: "deleted" as TicketStatus, updatedAt: new Date() } }
    );
    return "ok";
  }

  async startTimer(id: string, userId: string, now: number): Promise<Ticket | OwnerError> {
    const ticket = await this.findById(id);
    if (!ticket) return "not-found";
    if (ticket.createdBy !== userId) return "forbidden";
    await ticketsCollection().updateOne(
      { _id: new ObjectId(id) },
      { $set: { startTimestamp: now } }
    );
    return (await this.findById(id))!;
  }

  async stopTimer(id: string, userId: string, now: number): Promise<Ticket | OwnerError> {
    const ticket = await this.findById(id);
    if (!ticket) return "not-found";
    if (ticket.createdBy !== userId) return "forbidden";
    if (ticket.startTimestamp != null) {
      const elapsed = Math.floor((now - ticket.startTimestamp) / 1000);
      const prev = ticket.accumulatedTime ?? 0;
      await ticketsCollection().updateOne(
        { _id: new ObjectId(id) },
        { $set: { accumulatedTime: prev + elapsed }, $unset: { startTimestamp: "" } }
      );
    }
    return (await this.findById(id))!;
  }

  async batchUpdateStatus(
    ticketIds: string[],
    teamId: string,
    status: TicketStatus,
    adminId: string
  ): Promise<number | "forbidden"> {
    if (!isValidId(teamId)) return "forbidden";
    const team = await teamsCollection().findOne({
      _id: new ObjectId(teamId),
      admins: adminId,
    });
    if (!team) return "forbidden";
    const validIds = ticketIds.filter(isValidId).map((id) => new ObjectId(id));
    if (validIds.length === 0) return 0;
    const $set: Record<string, unknown> = { status, updatedAt: new Date(), updatedBy: adminId };
    if (status === "reviewed") {
      $set.reviewedBy = adminId;
      $set.reviewedAt = new Date();
    }
    const result = await ticketsCollection().updateMany(
      { _id: { $in: validIds }, teamId },
      { $set }
    );
    return result.modifiedCount;
  }

  async assign(
    id: string,
    adminId: string,
    assignedToUserId: string | null
  ): Promise<Ticket | AssignError> {
    const ticket = await this.findById(id);
    if (!ticket) return "not-found";
    if (!isValidId(ticket.teamId)) return "forbidden";
    const team = await teamsCollection().findOne({
      _id: new ObjectId(ticket.teamId),
      admins: adminId,
    });
    if (!team) return "forbidden";
    if (assignedToUserId !== null) {
      const allMembers = [...new Set([...(team.members ?? []), ...(team.admins ?? [])])];
      if (!allMembers.includes(assignedToUserId)) return "bad-assignee";
    }
    await ticketsCollection().updateOne(
      { _id: new ObjectId(id) },
      { $set: { assignedTo: assignedToUserId, updatedAt: new Date(), updatedBy: adminId } }
    );
    return (await this.findById(id))!;
  }
}

export const ticketService = new TicketService();
