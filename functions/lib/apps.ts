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
    id: "agenda",
    name: "Dev Agenda",
    description: "Projects, tasks, and day-to-day operational schedule.",
    icon: "agenda",
    route: "/private/agenda/",
    status: "active",
    version: "0.1.0",
    sort_order: 20,
  },
  {
    id: "music-studio",
    name: "Music studio",
    description: "Private music workspace for tracks, sessions, and studio tools.",
    icon: "music",
    route: "/private/music/",
    status: "active",
    version: "0.1.0",
    sort_order: 30,
  },
  {
    id: "administration",
    name: "Administration",
    description: "Identity, integrations, application registry, and account controls.",
    icon: "admin",
    route: "/private/settings/",
    status: "active",
    version: "0.1.0",
    sort_order: 90,
  },
];
