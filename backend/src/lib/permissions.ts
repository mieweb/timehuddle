import {
  AbilityBuilder,
  createMongoAbility,
  type AnyMongoAbility,
} from "@casl/ability";

export const APP_ROLES = ["owner", "admin" ] as const;

export type AppRole = (typeof APP_ROLES)[number];

export type AppAction =
  | "manage"
  | "read"
  | "create"
  | "update"
  | "delete"
  | "comment"
  | "assign"
  | "review";

export type AppSubject = "Ticket" | "Team" | "User" | "all";

export type PermissionContext = {
  userId: string;
  role: AppRole;
  teamIds: string[];
};

export type AppAbility = AnyMongoAbility;

export function buildAbilityFor(context: PermissionContext): AppAbility {
  const { can, build } = new AbilityBuilder<AppAbility>(createMongoAbility);

  // Boilerplate baseline: only elevated roles get full access for now.
  if (context.role === "owner" || context.role === "admin") {
    can("manage", "all");
  }

  return build();
}
