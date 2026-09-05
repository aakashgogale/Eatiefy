import { useEffect } from "react";
import { MAINTENANCE_CONTENT } from "@food/constants/maintenanceContent";
import maintenanceHero from "@food/assets/maintenance/maintenance-hero.png";

/**
 * Full-screen Under Maintenance UI.
 * Banner is a full-bleed wallpaper — covers the whole viewport (no separate bg layer).
 */
export default function MaintenancePage({ content = MAINTENANCE_CONTENT } = {}) {
  const title = content?.title || MAINTENANCE_CONTENT.title;

  useEffect(() => {
    const prev = document.title;
    document.title = title;
    return () => {
      document.title = prev;
    };
  }, [title]);

  return (
    <div className="fixed inset-0 z-[9999] overflow-hidden">
      <img
        src={maintenanceHero}
        alt={title}
        className="absolute inset-0 h-full w-full select-none object-cover object-center"
        draggable={false}
      />
    </div>
  );
}
