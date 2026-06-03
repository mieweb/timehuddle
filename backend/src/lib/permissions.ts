import { AbilityBuilder, createMongoAbility, type AnyMongoAbility } from "@casl/ability";

export const APP_ROLES = ["owner", "admin"] as const;

export type AppRole = (typeof APP_ROLES)[number];

export type AppAction =
  | "manage"
  | "read"
  | "create"
  | "update"
  | "delete"
  | "batchStatus"
  | "comment"
  | "assign"
  | "review";

export type AppSubject = "Ticket" | "Team" | "User" | "Organization" | "Enterprise" | "all";

export type PermissionContext = {
  userId: string;
  role: AppRole | "member";
  teamIds: string[];
  orgIds?: string[];
  enterpriseIds?: string[];
  isEnterpriseElevated?: boolean;
  teamAdminIds?: string[];
};

export type AppAbility = AnyMongoAbility;

export function buildAbilityFor(context: PermissionContext): AppAbility {
  const { can, build } = new AbilityBuilder<AppAbility>(createMongoAbility);

  if (context.role === "owner" || context.role === "admin") {
    can("manage", "all");
    return build();
  }

  if (context.teamIds.length > 0) {
    const teamScope = { teamId: { $in: context.teamIds } };
    can("read", "Ticket", teamScope);
    can("create", "Ticket", teamScope);
    can(["update", "assign", "review", "comment", "batchStatus"], "Ticket", teamScope);
    can("delete", "Ticket", { ...teamScope, createdBy: context.userId });
  }

  if ((context.orgIds ?? []).length > 0) {
    can("read", "Organization", { id: { $in: context.orgIds } });
  }

  if ((context.enterpriseIds ?? []).length > 0 || context.isEnterpriseElevated) {
    can("read", "Enterprise");
  }

  return build();
}
