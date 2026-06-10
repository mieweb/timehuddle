import { subject } from "@casl/ability";
import { ObjectId } from "mongodb";
import {
  enterprisesCollection,
  orgMembersCollection,
  organizationsCollection,
  teamsCollection,
  ticketsCollection,
  usersCollection,
} from "../models/index.js";
import { buildAbilityFor, type AppAction } from "../lib/permissions.js";
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

// ─── WebSocket Pub/Sub ────────────────────────────────────────────────────────

type TicketListener = (teamId: string, ticket: Ticket | null, action: "update" | "delete") => void;
const ticketListeners = new Map<string, Set<TicketListener>>();

/** Subscribe to ticket updates for a specific team. Returns unsubscribe function. */
export function subscribeToTeam(teamId: string, fn: TicketListener): () => void {
  if (!ticketListeners.has(teamId)) {
    ticketListeners.set(teamId, new Set());
  }
  ticketListeners.get(teamId)!.add(fn);
  return () => {
    const listeners = ticketListeners.get(teamId);
    if (listeners) {
      listeners.delete(fn);
      if (listeners.size === 0) ticketListeners.delete(teamId);
    }
  };
}

/** Broadcast a ticket update to all subscribers of the team. */
function broadcast(teamId: string, ticket: Ticket | null, action: "update" | "delete") {
  const listeners = ticketListeners.get(teamId);
  if (!listeners) return;
  for (const fn of listeners) {
    fn(teamId, ticket, action);
  }
}

// ──────────────────────────────────────────────────────────────────────────────

export class TicketService {
  private async resolveOrgRoleForTeam(
    userId: string,
    team: { orgId?: string }
  ): Promise<"owner" | "admin" | "member"> {
    if (!team.orgId || !isValidId(team.orgId)) return "member";
    const membership = await orgMembersCollection().findOne({ orgId: team.orgId, userId });
    if (membership?.role === "owner") return "owner";
    if (membership?.role === "admin") return "admin";
    return "member";
  }

  private async isEnterpriseElevatedForTeamOrg(
    userId: string,
    team: { orgId?: string }
  ): Promise<{ elevated: boolean; enterpriseId: string | null }> {
    if (!team.orgId || !isValidId(team.orgId)) {
      return { elevated: false, enterpriseId: null };
    }

    const org = await organizationsCollection().findOne({ _id: new ObjectId(team.orgId) });
    const enterpriseId = org?.enterpriseId ?? null;
    if (!enterpriseId || !isValidId(enterpriseId)) {
      return { elevated: false, enterpriseId: null };
    }

    const enterprise = await enterprisesCollection().findOne({ _id: new ObjectId(enterpriseId) });
    if (!enterprise) {
      return { elevated: false, enterpriseId };
    }

    const elevated =
      (enterprise.owners ?? []).includes(userId) || (enterprise.admins ?? []).includes(userId);
    return { elevated, enterpriseId };
  }

  private async buildTeamAbility(userId: string, teamId: string) {
    if (!isValidId(teamId)) return null;
    const team = await teamsCollection().findOne({ _id: new ObjectId(teamId) });
    if (!team) return null;

    const role = await this.resolveOrgRoleForTeam(userId, team);
    const enterpriseScope = await this.isEnterpriseElevatedForTeamOrg(userId, team);
    const isTeamMember =
      (team.members ?? []).includes(userId) || (team.admins ?? []).includes(userId);
    const isOrgElevated = role === "owner" || role === "admin";
    const scopedTeamIds = isTeamMember || isOrgElevated || enterpriseScope.elevated ? [teamId] : [];

    return {
      team,
      ability: buildAbilityFor({
        userId,
        role,
        teamIds: scopedTeamIds,
        orgIds: team.orgId ? [team.orgId] : [],
        enterpriseIds: enterpriseScope.enterpriseId ? [enterpriseScope.enterpriseId] : [],
        isEnterpriseElevated: enterpriseScope.elevated,
        teamAdminIds: (team.admins ?? []).includes(userId) ? [teamId] : [],
      }),
    };
  }

  async canUserPerformOnTicket(
    userId: string,
    ticket: Ticket,
    action: AppAction
  ): Promise<boolean> {
    const context = await this.buildTeamAbility(userId, ticket.teamId);
    if (!context) return false;
    return context.ability.can(action, subject("Ticket", ticket));
  }

  async findAuthorizedTicket(
    id: string,
    userId: string,
    action: AppAction
  ): Promise<Ticket | OwnerError> {
    const ticket = await this.findById(id);
    if (!ticket) return "not-found";
    const allowed = await this.canUserPerformOnTicket(userId, ticket, action);
    if (!allowed) return "forbidden";
    return ticket;
  }

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
    const teamIds = userTeams.map((t) => t._id.toHexString());
    const baseFilter = {
      sharedWithTimeharbor: true,
      status: { $ne: "deleted" as TicketStatus },
    };

    const [orgElevatedMemberships, enterpriseElevated] = await Promise.all([
      orgMembersCollection()
        .find({ userId, role: { $in: ["owner", "admin"] } }, { projection: { orgId: 1 } })
        .toArray(),
      enterprisesCollection()
        .find({ $or: [{ owners: userId }, { admins: userId }] }, { projection: { _id: 1 } })
        .toArray(),
    ]);

    const enterpriseIds = enterpriseElevated.map((enterprise) => enterprise._id.toHexString());
    const enterpriseOrgIds = enterpriseIds.length
      ? (
          await organizationsCollection()
            .find({ enterpriseId: { $in: enterpriseIds } }, { projection: { _id: 1 } })
            .toArray()
        ).map((org) => org._id.toHexString())
      : [];

    const elevatedOrgIds = Array.from(
      new Set([
        ...orgElevatedMemberships.map((membership) => membership.orgId),
        ...enterpriseOrgIds,
      ])
    );

    const elevatedTeamIds = elevatedOrgIds.length
      ? (
          await teamsCollection()
            .find({ orgId: { $in: elevatedOrgIds } }, { projection: { _id: 1 } })
            .toArray()
        ).map((team) => team._id.toHexString())
      : [];

    const visibleTeamIds = Array.from(new Set([...teamIds, ...elevatedTeamIds]));
    if (visibleTeamIds.length === 0) return [];

    const query = { ...baseFilter, teamId: { $in: visibleTeamIds } };
    return ticketsCollection()
      .find({
        ...query,
      })
      .sort({ updatedAt: -1 })
      .toArray();
  }

  async findByTeam(teamId: string, userId: string): Promise<Ticket[] | "forbidden"> {
    const context = await this.buildTeamAbility(userId, teamId);
    if (!context) return "forbidden";
    if (!context.ability.can("read", subject("Ticket", { teamId }))) return "forbidden";

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
    const context = await this.buildTeamAbility(data.createdBy, data.teamId);
    if (!context) return "forbidden";
    if (!context.ability.can("create", subject("Ticket", { teamId: data.teamId }))) {
      return "forbidden";
    }

    const result = await ticketsCollection().insertOne({
      _id: new ObjectId(),
      teamId: data.teamId,
      title: data.title,
      github: data.github,
      status: "open",
      createdBy: data.createdBy,
      assignedTo: [data.createdBy],
      createdAt: new Date(),
    });
    await this.emitTicketCreatedActivity(data.createdBy, data.teamId, {
      ticketId: result.insertedId.toHexString(),
      ticketTitle: data.title,
      teamId: data.teamId,
    });
    const created = (await this.findById(result.insertedId.toHexString()))!;
    broadcast(data.teamId, created, "update");
    return { id: result.insertedId.toHexString() };
  }

  async update(
    id: string,
    userId: string,
    updates: Partial<Pick<Ticket, "title" | "github" | "description">>
  ): Promise<Ticket | OwnerError> {
    const ticket = await this.findAuthorizedTicket(id, userId, "update");
    if (ticket === "not-found" || ticket === "forbidden") return ticket;

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
    broadcast(updated.teamId, updated, "update");
    return updated;
  }

  // Any team member can update status and/or priority.
  async updateStatusPriority(
    id: string,
    userId: string,
    updates: { status?: TicketStatus; priority?: TicketPriority }
  ): Promise<Ticket | OwnerError> {
    const ticket = await this.findAuthorizedTicket(id, userId, "update");
    if (ticket === "not-found" || ticket === "forbidden") return ticket;

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
    broadcast(updated.teamId, updated, "update");
    return updated;
  }

  // Soft-delete so Phase 5 clock event cleanup can reference the ID.
  async delete(id: string, userId: string): Promise<"ok" | OwnerError> {
    const ticket = await this.findAuthorizedTicket(id, userId, "delete");
    if (ticket === "not-found" || ticket === "forbidden") return ticket;

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
    broadcast(ticket.teamId, null, "delete");
    return "ok";
  }

  async batchUpdateStatus(
    ticketIds: string[],
    teamId: string,
    status: TicketStatus,
    requesterId: string
  ): Promise<number | "forbidden"> {
    const context = await this.buildTeamAbility(requesterId, teamId);
    if (!context) return "forbidden";
    if (!context.ability.can("batchStatus", subject("Ticket", { teamId }))) return "forbidden";

    const validIds = ticketIds.filter(isValidId).map((id) => new ObjectId(id));
    if (validIds.length === 0) return 0;
    const $set: Record<string, unknown> = { status, updatedAt: new Date(), updatedBy: requesterId };
    if (status === "reviewed") {
      $set.reviewedBy = requesterId;
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
        this.emitTicketUpdatedActivity(requesterId, teamId, {
          ticketId: ticket._id.toHexString(),
          ticketTitle: ticket.title,
          teamId,
          action: "batch-status-changed",
          status,
        })
      )
    );
    // Broadcast each updated ticket
    updatedTickets.forEach((ticket) => broadcast(teamId, ticket, "update"));
    return result.modifiedCount;
  }

  // Assign ticket: allowed for any team member.
  async assign(
    id: string,
    requesterId: string,
    assignedToUserIds: string[]
  ): Promise<Ticket | AssignError> {
    const ticket = await this.findAuthorizedTicket(id, requesterId, "assign");
    if (ticket === "not-found" || ticket === "forbidden") return ticket;

    const team = await teamsCollection().findOne({ _id: new ObjectId(ticket.teamId) });
    if (!team) return "forbidden";

    // Validate all assignees are team members
    const allMembers = [...new Set([...(team.members ?? []), ...(team.admins ?? [])])];
    for (const userId of assignedToUserIds) {
      if (!allMembers.includes(userId)) return "bad-assignee";
    }

    await ticketsCollection().updateOne(
      { _id: new ObjectId(id) },
      { $set: { assignedTo: assignedToUserIds, updatedAt: new Date(), updatedBy: requesterId } }
    );
    const updated = (await this.findById(id))!;

    // Determine newly added assignees (not previously assigned)
    const previousAssignees = ticket.assignedTo ?? [];
    const newAssignees = assignedToUserIds.filter((uid) => !previousAssignees.includes(uid));

    // Fetch assignee names for activity log
    const assigneeNames =
      assignedToUserIds.length > 0
        ? await usersCollection()
            .find({ _id: { $in: assignedToUserIds.map((uid) => new ObjectId(uid)) } })
            .toArray()
            .then((users) =>
              users.map((u) => u.name ?? u.email?.split("@")[0] ?? "Unknown").join(", ")
            )
        : "";

    await this.emitTicketUpdatedActivity(requesterId, updated.teamId, {
      ticketId: updated._id.toHexString(),
      ticketTitle: updated.title,
      teamId: updated.teamId,
      action: assignedToUserIds.length > 0 ? "assigned" : "unassigned",
      assigneeId: assignedToUserIds[0] ?? null,
      assigneeName: assigneeNames || undefined,
    });

    // Notify newly added assignees (skip requester)
    const requester = await usersCollection().findOne({ _id: new ObjectId(requesterId) });
    const requesterName = requester?.name ?? requester?.email?.split("@")[0] ?? "Someone";

    await Promise.all(
      newAssignees
        .filter((uid) => uid !== requesterId)
        .map((uid) =>
          Promise.all([
            notificationService
              .create({
                userId: uid,
                title: "Huddle",
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
              .sendPush(uid, {
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
          ])
        )
    );

    broadcast(updated.teamId, updated, "update");
    return updated;
  }
}

export const ticketService = new TicketService();
