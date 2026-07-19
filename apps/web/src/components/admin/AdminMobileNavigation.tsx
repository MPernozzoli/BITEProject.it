import { CalendarCheck, Home, Mail, MapPinned, User, Images, UsersRound, Wine } from "lucide-react";
import { NavLink, useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";

const adminNavItems = [
  { to: "/admin", label: "Home", icon: Home, exact: true },
  { to: "/admin/bookings", label: "Booking", icon: CalendarCheck },
  { to: "/admin?section=community", label: "Community", icon: UsersRound },
  { to: "/admin/media", label: "Media", icon: Images },
  { to: "/admin/mail", label: "Mail", icon: Mail },
  { to: "/admin/trackers", label: "Tracker", icon: MapPinned },
  { to: "/admin/spritz", label: "Spritz", icon: Wine },
  { to: "/profile", label: "Profilo", icon: User, exact: true },
];

const AdminMobileNavigation = () => {
  const location = useLocation();

  return (
    <nav
      aria-label="Navigazione admin"
      className="fixed inset-x-0 bottom-0 z-50 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 md:hidden"
    >
      <div className="mx-auto max-w-md rounded-[28px] border border-white/70 bg-background/90 shadow-[0_18px_55px_rgba(15,23,42,0.18)] backdrop-blur-2xl">
        <div className="admin-action-strip flex items-stretch gap-1 overflow-x-auto overscroll-x-contain px-2 py-2">
          {adminNavItems.map((item) => {
            const Icon = item.icon;
            const [itemPath, itemSearch = ""] = item.to.split("?");
            const active = item.exact
              ? location.pathname === itemPath && (!itemSearch || location.search === `?${itemSearch}`)
              : itemSearch
                ? location.pathname === itemPath && location.search === `?${itemSearch}`
                : location.pathname === itemPath || location.pathname.startsWith(`${itemPath}/`);

            return (
              <NavLink
                key={item.to}
                to={item.to}
                aria-label={item.label === "Home" ? "Torna alla home admin" : item.label}
                className={cn(
                  "flex min-h-14 min-w-[4.45rem] shrink-0 flex-col items-center justify-center gap-1 rounded-[20px] px-2 text-[11px] font-sans font-medium leading-none transition-colors",
                  active
                    ? "bg-primary text-primary-foreground shadow-[0_10px_24px_rgba(15,23,42,0.18)]"
                    : "text-muted-foreground hover:bg-white/70 hover:text-foreground",
                )}
              >
                <Icon size={18} strokeWidth={active ? 2.4 : 2} aria-hidden="true" />
                <span>{item.label}</span>
              </NavLink>
            );
          })}
        </div>
      </div>
    </nav>
  );
};

export default AdminMobileNavigation;
