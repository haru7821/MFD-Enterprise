import { EquipmentPalette } from '@/features/equipment/EquipmentPalette';
import { PlanPanel } from '@/features/plan/PlanPanel';
import { SpaceInspector } from '@/features/space/SpaceInspector';

/**
 * The left sidebar, in the order a review is actually carried out:
 *
 *   1. import and calibrate the hospital's drawing
 *   2. trace the rooms
 *   3. place the machines
 *
 * The equipment list takes the remaining height and scrolls, because it is the part
 * an engineer returns to repeatedly; the plan and the room list are set up once and
 * then mostly read.
 */
export function ProjectSidebar() {
  return (
    <aside
      className="flex w-64 shrink-0 flex-col overflow-y-auto border-r border-edge bg-chrome"
      aria-label="Project"
    >
      <PlanPanel />
      <SpaceInspector />
      <EquipmentPalette />
    </aside>
  );
}
