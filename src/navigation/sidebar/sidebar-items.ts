import {
  CheckSquare,
  type LucideIcon,
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
        title: "Tonight",
        url: "/dashboard/tonight",
        icon: CheckSquare,
      },
      {
        id: "cc-products",
        title: "Products",
        url: "/dashboard/products",
        icon: ShoppingBag,
      },
      {
        id: "contacts",
        title: "Contacts",
        url: "/dashboard/contacts",
        icon: UserRound,
      },
    ],
  },
];
