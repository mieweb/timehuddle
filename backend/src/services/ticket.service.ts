import { ObjectId } from "mongodb";
import { teamsCollection, ticketsCollection, usersCollection } from "../models/index.js";
import type { Ticket, TicketPriority, TicketStatus } from "../models/ticket.model.js";
import {
  ActivityType,
  type TicketCreatedPayload,
  type TicketUpdatedPayload,
} from "../models/activity.model.js";
import { emitActivity } from "./activity.service.js";
import { notificationService } from "./notification.service.js";
import { pushService } from "./push.service.js";

type OwnerError = "not-found" | "forbidden";
type AssignError = "not-found" | "forbidden" | "bad-assignee";

function isValidId(id: string): boolean {
  return /^[0-9a-f]{24}$/i.test(id);
}

export class TicketService {
  private async getActor(userId: string): Promise<{ id: string; name: string }> {
    const user = isValidId(userId)
      ? await usersCollection().findOne({ _id: new ObjectId(userId) })
      : null;
    return {
      id: userId,
      name: user?.name ?? user?.email?.split("@")[0] ?? "Someone",
    };
  }

  private async emitTicketCreatedActivity(
    userId: string,
    teamId: string,
    payload: TicketCreatedPayload
  ): Promise<void> {
    const actor = await this.getActor(userId);
    await emitActivity({
      userId,
      teamId,
      type: ActivityType.TicketCreated,
      actor,
      payload,
    });
  }

  private async emitTicketUpdatedActivity(
    userId: string,
    teamId: string,
    payload: TicketUpdatedPayload
  ): Promise<void> {
    const actor = await this.getActor(userId);
    await emitActivity({
      userId,
      teamId,
      type: ActivityType.TicketUpdated,
      actor,
      payload,
    });
  }

  async findById(id: string): Promise<Ticket | null> {
    if (!isValidId(id)) return null;
    return ticketsCollection().findOne({ _id: new ObjectId(id) });
  }

  /** Return all tickets the user can see that are flagged sharedWithTimeharbor=true, across all their teams. */
  async findSharedWithTimeharbor(userId: string): Promise<Ticket[]> {
    // Find all team IDs the user is a member or admin of
    const userTeams = await teamsCollection()
      .find({ $or: [{ members: userId }, { admins: userId }] }, { projection: { _id: 1 } })
      .toArray();
    const teamIds = userTeams.map((t) => t._id.toString());
    if (teamIds.length === 0) return [];
    return ticketsCollection()
      .find({
        teamId: { $in: teamIds },
        sharedWithTimeharbor: true,
        status: { $ne: "deleted" as TicketStatus },
      })
      .sort({ updatedAt: -1 })
      .toArray();
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
      status: "open",
      createdBy: data.createdBy,
      assignedTo: data.createdBy,
      createdAt: new Date(),
    });
    await this.emitTicketCreatedActivity(data.createdBy, data.teamId, {
      ticketId: result.insertedId.toHexString(),
      ticketTitle: data.title,
      teamId: data.teamId,
    });
    return { id: result.insertedId.toHexString() };
  }

  async update(
    id: string,
    userId: string,
    updates: Partial<Pick<Ticket, "title" | "github" | "description">>
  ): Promise<Ticket | OwnerError> {
    const ticket = await this.findById(id);
    if (!ticket) return "not-found";
    if (!isValidId(ticket.teamId)) return "forbidden";
    const team = await teamsCollection().findOne({
      _id: new ObjectId(ticket.teamId),
      $or: [{ members: userId }, { admins: userId }],
    });
    if (!team) return "forbidden";
    // Only the ticket creator or a team admin may edit title/github/description.
    const isAdmin = (team.admins ?? []).includes(userId);
    if (ticket.createdBy !== userId && !isAdmin) return "forbidden";
    await ticketsCollection().updateOne(
      { _id: new ObjectId(id) },
      { $set: { ...updates, updatedAt: new Date(), updatedBy: userId } }
    );
    const updated = (await this.findById(id))!;
    await this.emitTicketUpdatedActivity(userId, updated.teamId, {
      ticketId: updated._id.toHexString(),
      ticketTitle: updated.title,
      teamId: updated.teamId,
      action: "edited",
    });
    return updated;
  }

  // Any team member can update status and/or priority.
  async updateStatusPriority(
    id: string,
    userId: string,
    updates: { status?: TicketStatus; priority?: TicketPriority }
  ): Promise<Ticket | OwnerError> {
    const ticket = await this.findById(id);
    if (!ticket) return "not-found";
    if (!isValidId(ticket.teamId)) return "forbidden";
    const team = await teamsCollection().findOne({
      _id: new ObjectId(ticket.teamId),
      $or: [{ members: userId }, { admins: userId }],
    });
    if (!team) return "forbidden";
    const $set: Record<string, unknown> = { ...updates, updatedAt: new Date(), updatedBy: userId };
    if (updates.status === "reviewed") {
      $set.reviewedBy = userId;
      $set.reviewedAt = new Date();
    }
    await ticketsCollection().updateOne({ _id: new ObjectId(id) }, { $set });
    const updated = (await this.findById(id))!;
    const action =
      updates.status && updates.priority
        ? "status-priority-changed"
        : updates.status
          ? "status-changed"
          : "priority-changed";
    await this.emitTicketUpdatedActivity(userId, updated.teamId, {
      ticketId: updated._id.toHexString(),
      ticketTitle: updated.title,
      teamId: updated.teamId,
      action,
      status: updates.status,
      priority: updates.priority,
    });
    return updated;
  }

  // Soft-delete so Phase 5 clock event cleanup can reference the ID.
  async delete(id: string, userId: string): Promise<"ok" | OwnerError> {
    const ticket = await this.findById(id);
    if (!ticket) return "not-found";
    if (!isValidId(ticket.teamId)) return "forbidden";
    const team = await teamsCollection().findOne({
      _id: new ObjectId(ticket.teamId),
      $or: [{ members: userId }, { admins: userId }],
    });
    if (!team) return "forbidden";
    // Only the ticket creator or a team admin may delete.
    const isAdmin = (team.admins ?? []).includes(userId);
    if (ticket.createdBy !== userId && !isAdmin) return "forbidden";
    await ticketsCollection().updateOne(
      { _id: new ObjectId(id) },
      { $set: { status: "deleted" as TicketStatus, updatedAt: new Date() } }
    );
    await this.emitTicketUpdatedActivity(userId, ticket.teamId, {
      ticketId: ticket._id.toHexString(),
      ticketTitle: ticket.title,
      teamId: ticket.teamId,
      action: "deleted",
    });
    return "ok";
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
    const updatedTickets = await ticketsCollection()
      .find({ _id: { $in: validIds }, teamId })
      .toArray();
    await Promise.all(
      updatedTickets.map((ticket) =>
        this.emitTicketUpdatedActivity(adminId, teamId, {
          ticketId: ticket._id.toHexString(),
          ticketTitle: ticket.title,
          teamId,
          action: "batch-status-changed",
          status,
        })
      )
    );
    return result.modifiedCount;
  }

  // Assign ticket: allowed for team admins only.
  async assign(
    id: string,
    requesterId: string,
    assignedToUserId: string | null
  ): Promise<Ticket | AssignError> {
    const ticket = await this.findById(id);
    if (!ticket) return "not-found";
    if (!isValidId(ticket.teamId)) return "forbidden";
    const team = await teamsCollection().findOne({
      _id: new ObjectId(ticket.teamId),
      admins: requesterId,
    });
    if (!team) return "forbidden";
    if (assignedToUserId !== null) {
      const allMembers = [...new Set([...(team.members ?? []), ...(team.admins ?? [])])];
      if (!allMembers.includes(assignedToUserId)) return "bad-assignee";
    }
    await ticketsCollection().updateOne(
      { _id: new ObjectId(id) },
      { $set: { assignedTo: assignedToUserId, updatedAt: new Date(), updatedBy: requesterId } }
    );
    const updated = (await this.findById(id))!;
    const assignee =
      assignedToUserId && isValidId(assignedToUserId)
        ? await usersCollection().findOne({ _id: new ObjectId(assignedToUserId) })
        : null;
    await this.emitTicketUpdatedActivity(requesterId, updated.teamId, {
      ticketId: updated._id.toHexString(),
      ticketTitle: updated.title,
      teamId: updated.teamId,
      action: assignedToUserId ? "assigned" : "unassigned",
      assigneeId: assignedToUserId,
      assigneeName: assignee?.name ?? assignee?.email?.split("@")[0],
    });

    // Notify the assignee (skip if unassigning or assigning to self)
    if (assignedToUserId && assignedToUserId !== requesterId) {
      const requester = await usersCollection().findOne({ _id: new ObjectId(requesterId) });
      const requesterName = requester?.name ?? requester?.email?.split("@")[0] ?? "Someone";
      await Promise.all([
        notificationService
          .create({
            userId: assignedToUserId,
            title: "TiméHuddle",
            body: `${requesterName} assigned you "${ticket.title}"`,
            notificationData: {
              type: "ticket-assigned",
              assignedBy: requesterId,
              assignedByName: requesterName,
              ticketId: id,
              ticketTitle: ticket.title,
              teamId: ticket.teamId,
              url: `/app/tickets`,
            },
          })
          .catch(() => {}),
        pushService
          .sendPush(assignedToUserId, {
            title: `Ticket assigned to you`,
            body: `${requesterName} assigned you "${ticket.title}"`,
            tag: `ticket-assigned-${id}`,
            data: {
              type: "ticket-assigned",
              assignedBy: requesterId,
              assignedByName: requesterName,
              ticketId: id,
              ticketTitle: ticket.title,
              teamId: ticket.teamId,
              url: `/app/tickets`,
            },
          })
          .catch(() => {}),
      ]);
    }

    return updated;
  }
}

export const ticketService = new TicketService();
