import {
  Activity,
  CheckSquare,
  Factory,
  type LucideIcon,
  MessageSquare,
  Settings,
  ShoppingBag,
  UserRound,
} from "lucide-react";

export type NavBadge = "new" | "soon";

export interface NavSubItem {
  id: string;
  title: string;
  url: string;
  icon?: LucideIcon;
  badge?: NavBadge;
  disabled?: boolean;
  newTab?: boolean;
}

interface NavItemBase {
  id: string;
  title: string;
  icon?: LucideIcon;
  badge?: NavBadge;
  disabled?: boolean;
  newTab?: boolean;
}

export interface NavMainLinkItem extends NavItemBase {
  url: string;
  subItems?: never;
}

export interface NavMainParentItem extends NavItemBase {
  subItems: NavSubItem[];
}

export type NavMainItem = NavMainLinkItem | NavMainParentItem;

export interface NavGroup {
  id: number;
  label?: string;
  items: NavMainItem[];
}

export const sidebarItems: NavGroup[] = [
  {
    id: 0,
    label: "Command Center",
    items: [
      {
        id: "tonight",
        title: "Actionables",
        url: "/dashboard/actionables",
        icon: CheckSquare,
      },
      {
        id: "factories",
        title: "Factories",
        url: "/dashboard/factories",
        icon: Factory,
      },
      {
        id: "activity",
        title: "Activity",
        url: "/dashboard/activity",
        icon: Activity,
      },
      {
        id: "cc-products",
        title: "Products",
        url: "/dashboard/products",
        icon: ShoppingBag,
      },
      {
        id: "messages",
        title: "Messages",
        url: "/dashboard/messages",
        icon: MessageSquare,
      },
      {
        id: "contacts",
        title: "Contacts",
        url: "/dashboard/contacts",
        icon: UserRound,
      },
      {
        id: "settings",
        title: "Settings",
        url: "/dashboard/settings/playbook",
        icon: Settings,
      },
    ],
  },
];
