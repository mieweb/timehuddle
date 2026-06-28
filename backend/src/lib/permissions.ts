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

export type AppSubject =
  | "Ticket"
  | "Team"
  | "User"
  | "Organization"
  | "OrganizationMembership"
  | "Enterprise"
  | "all";

export type PermissionContext = {
  userId: string;
  role: AppRole | "member";
  teamIds: string[];
  orgIds?: string[];
  managedOrgIds?: string[];
  enterpriseIds?: string[];
  isEnterpriseElevated?: boolean;
  teamAdminIds?: string[];
};

export type AppAbility = AnyMongoAbility;

export function buildAbilityFor(context: PermissionContext): AppAbility {
  const { can, build } = new AbilityBuilder<AppAbility>(createMongoAbility);

  if (context.teamIds.length > 0) {
    const teamScope = { teamId: { $in: context.teamIds } };
    if (context.role === "owner" || context.role === "admin" || context.isEnterpriseElevated) {
      can("manage", "Ticket", teamScope);
      can("manage", "Team", { id: { $in: context.teamIds } });
    } else {
      can("read", "Ticket", teamScope);
      can("create", "Ticket", teamScope);
      can(["update", "assign", "review", "comment", "batchStatus"], "Ticket", teamScope);
      can("delete", "Ticket", { ...teamScope, createdBy: context.userId });
    }
  }

  const orgIds = context.orgIds ?? [];
  const managedOrgIds =
    context.managedOrgIds ?? (context.role === "owner" || context.role === "admin" ? orgIds : []);

  if (orgIds.length > 0) {
    can("read", "Organization", { id: { $in: orgIds } });
  }

  if (managedOrgIds.length > 0) {
    can("manage", "Organization", { id: { $in: managedOrgIds } });
    can("manage", "OrganizationMembership", { orgId: { $in: managedOrgIds } });
  }

  if ((context.enterpriseIds ?? []).length > 0 || context.isEnterpriseElevated) {
    can("read", "Enterprise");
    if (context.isEnterpriseElevated && (context.enterpriseIds ?? []).length > 0) {
      can("manage", "Enterprise", { id: { $in: context.enterpriseIds } });
    }
  }

  return build();
}
