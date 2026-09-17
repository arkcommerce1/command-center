import {
  Activity,
  CheckSquare,
  Factory,
  LayoutDashboard,
  type LucideIcon,
  MessageSquare,
  Package,
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
        id: "dashboard",
        title: "Dashboard",
        url: "/dashboard/default",
        icon: LayoutDashboard,
      },
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
        id: "samples",
        title: "Samples",
        url: "/dashboard/samples",
        icon: Package,
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
        icon: Settings,
        subItems: [
          {
            id: "settings-playbook",
            title: "Playbook",
            url: "/dashboard/settings/playbook",
          },
          {
            id: "settings-learning",
            title: "What Donna learned",
            url: "/dashboard/settings/learning",
          },
        ],
      },
    ],
  },
];
