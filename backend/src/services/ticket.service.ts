import { ObjectId } from "mongodb";
import { teamsCollection, ticketsCollection, usersCollection } from "../models/index.js";
import type { Ticket, TicketPriority, TicketStatus } from "../models/ticket.model.js";
import { notificationService } from "./notification.service.js";
import { pushService } from "./push.service.js";

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
    updates: Partial<Pick<Ticket, "title" | "github" | "accumulatedTime" | "description">>
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

  async startTimer(
    id: string,
    userId: string,
    now: number
  ): Promise<{ ticket: Ticket; stoppedTickets: Ticket[] } | OwnerError> {
    const ticket = await this.findById(id);
    if (!ticket) return "not-found";
    // If assigned: only assignee can run timer. If unassigned: only creator can.
    const canTimer = ticket.assignedTo ? ticket.assignedTo === userId : ticket.createdBy === userId;
    if (!canTimer) return "forbidden";

    // Stop any other running timers owned by this user before starting the new one.
    const running = await ticketsCollection()
      .find({
        createdBy: userId,
        startTimestamp: { $exists: true },
        _id: { $ne: new ObjectId(id) },
      })
      .toArray();

    const stoppedTickets: Ticket[] = [];
    if (running.length > 0) {
      // Batch all stops into a single bulkWrite round-trip.
      const bulkOps = running.map((other) => {
        const elapsed = Math.floor((now - other.startTimestamp!) / 1000);
        const newAccumulatedTime = (other.accumulatedTime ?? 0) + elapsed;
        return {
          updateOne: {
            filter: { _id: other._id },
            update: {
              $set: { accumulatedTime: newAccumulatedTime },
              $unset: { startTimestamp: 1 as const },
            },
          },
        };
      });
      await ticketsCollection().bulkWrite(bulkOps);

      // Build stopped-ticket objects from in-memory data to avoid extra DB reads.
      for (const other of running) {
        const elapsed = Math.floor((now - other.startTimestamp!) / 1000);
        const stopped: Ticket = {
          ...other,
          accumulatedTime: (other.accumulatedTime ?? 0) + elapsed,
        };
        delete stopped.startTimestamp;
        stoppedTickets.push(stopped);
      }
    }

    const started = await ticketsCollection().findOneAndUpdate(
      { _id: new ObjectId(id) },
      { $set: { startTimestamp: now } },
      { returnDocument: "after" }
    );
    if (!started) return "not-found";

    // Notify team admins
    if (isValidId(ticket.teamId)) {
      const [team, user] = await Promise.all([
        teamsCollection().findOne({ _id: new ObjectId(ticket.teamId) }),
        usersCollection().findOne({ _id: new ObjectId(userId) }),
      ]);
      if (team) {
        const userName = user?.name ?? user?.email?.split("@")[0] ?? "Someone";
        const notifyAdmins = (team.admins ?? []).filter((aid) => aid !== userId);
        await Promise.all(
          notifyAdmins.map((adminId) =>
            Promise.all([
              notificationService.create({
                userId: adminId,
                title: "TiméHuddle",
                body: `${userName} started a timer on "${ticket.title}"`,
                notificationData: {
                  type: "ticket-timer-start",
                  userId,
                  userName,
                  ticketId: id,
                  ticketTitle: ticket.title,
                  teamId: ticket.teamId,
                  url: `/app/tickets`,
                },
              }).catch(() => {}),
              pushService.sendPush(adminId, {
                title: `${userName} started "${ticket.title}"`,
                body: `${userName} started a timer on "${ticket.title}"`,
                tag: `ticket-start-${id}`,
                data: {
                  type: "ticket-timer-start",
                  userId,
                  userName,
                  ticketId: id,
                  ticketTitle: ticket.title,
                  teamId: ticket.teamId,
                  url: `/app/tickets`,
                },
              }).catch(() => {}),
            ])
          )
        );
      }
    }

    return { ticket: started, stoppedTickets };
  }

  async stopTimer(id: string, userId: string, now: number): Promise<Ticket | OwnerError> {
    const ticket = await this.findById(id);
    if (!ticket) return "not-found";
    // If assigned: only assignee can run timer. If unassigned: only creator can.
    const canTimer = ticket.assignedTo ? ticket.assignedTo === userId : ticket.createdBy === userId;
    if (!canTimer) return "forbidden";
    if (ticket.startTimestamp != null) {
      const elapsed = Math.floor((now - ticket.startTimestamp) / 1000);
      const prev = ticket.accumulatedTime ?? 0;
      await ticketsCollection().updateOne(
        { _id: new ObjectId(id) },
        { $set: { accumulatedTime: prev + elapsed }, $unset: { startTimestamp: "" } }
      );
    }
    const updated = (await this.findById(id))!;

    // Notify team admins
    if (isValidId(ticket.teamId)) {
      const [team, user] = await Promise.all([
        teamsCollection().findOne({ _id: new ObjectId(ticket.teamId) }),
        usersCollection().findOne({ _id: new ObjectId(userId) }),
      ]);
      if (team) {
        const userName = user?.name ?? user?.email?.split("@")[0] ?? "Someone";
        const notifyAdmins = (team.admins ?? []).filter((aid) => aid !== userId);
        await Promise.all(
          notifyAdmins.map((adminId) =>
            Promise.all([
              notificationService.create({
                userId: adminId,
                title: "TiméHuddle",
                body: `${userName} stopped the timer on "${ticket.title}"`,
                notificationData: {
                  type: "ticket-timer-stop",
                  userId,
                  userName,
                  ticketId: id,
                  ticketTitle: ticket.title,
                  teamId: ticket.teamId,
                  url: `/app/tickets`,
                },
              }).catch(() => {}),
              pushService.sendPush(adminId, {
                title: `${userName} stopped "${ticket.title}"`,
                body: `${userName} stopped the timer on "${ticket.title}"`,
                tag: `ticket-stop-${id}`,
                data: {
                  type: "ticket-timer-stop",
                  userId,
                  userName,
                  ticketId: id,
                  ticketTitle: ticket.title,
                  teamId: ticket.teamId,
                  url: `/app/tickets`,
                },
              }).catch(() => {}),
            ])
          )
        );
      }
    }

    return updated;
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

  // Assign ticket: allowed for the ticket creator or a team admin.
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
      $or: [{ members: requesterId }, { admins: requesterId }],
    });
    if (!team) return "forbidden";
    const isCreator = ticket.createdBy === requesterId;
    const isAdmin = (team.admins ?? []).includes(requesterId);
    if (!isCreator && !isAdmin) return "forbidden";
    if (assignedToUserId !== null) {
      const allMembers = [...new Set([...(team.members ?? []), ...(team.admins ?? [])])];
      if (!allMembers.includes(assignedToUserId)) return "bad-assignee";
    }
    await ticketsCollection().updateOne(
      { _id: new ObjectId(id) },
      { $set: { assignedTo: assignedToUserId, updatedAt: new Date(), updatedBy: requesterId } }
    );
    const updated = (await this.findById(id))!;

    // Notify the assignee (skip if unassigning or assigning to self)
    if (assignedToUserId && assignedToUserId !== requesterId) {
      const requester = await usersCollection().findOne({ _id: new ObjectId(requesterId) });
      const requesterName = requester?.name ?? requester?.email?.split("@")[0] ?? "Someone";
      await Promise.all([
        notificationService.create({
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
        }).catch(() => {}),
        pushService.sendPush(assignedToUserId, {
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
        }).catch(() => {}),
      ]);
    }

    return updated;
  }
}

export const ticketService = new TicketService();
