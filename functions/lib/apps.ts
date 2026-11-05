/** Fallback application registry when D1 is not yet bound. */

export type AppRecord = {
  id: string;
  name: string;
  description: string;
  icon: string;
  route: string;
  status: "active" | "planned" | "disabled" | "hidden";
  version: string;
  sort_order: number;
};

export const FALLBACK_APPS: AppRecord[] = [
  {
    id: "publisher-hq",
    name: "Publisher HQ",
    description: "Centralized multi-website publishing management.",
    icon: "publish",
    route: "/private/publisher/",
    status: "active",
    version: "0.1.0",
    sort_order: 10,
  },
  {
    id: "trading-center",
    name: "Trading Center",
    description: "Future financial research and trading tools.",
    icon: "trade",
    route: "/private/apps/#trading-center",
    status: "planned",
    version: "0.0.0",
    sort_order: 20,
  },
  {
    id: "project-center",
    name: "Project Center",
    description: "Future project and operations management.",
    icon: "project",
    route: "/private/apps/#project-center",
    status: "planned",
    version: "0.0.0",
    sort_order: 30,
  },
  {
    id: "administration",
    name: "Administration",
    description: "Private settings, accounts, integrations, and application management.",
    icon: "admin",
    route: "/private/settings/",
    status: "active",
    version: "0.1.0",
    sort_order: 90,
  },
];
