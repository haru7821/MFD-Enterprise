import { EquipmentPalette } from '@/features/equipment/EquipmentPalette';
import { LevelPanel } from '@/features/level/LevelPanel';
import { PlanPanel } from '@/features/plan/PlanPanel';
import { ProjectDetailsPanel } from '@/features/project/ProjectDetailsPanel';
import { ObstructionInspector } from '@/features/space/ObstructionInspector';
import { SpaceInspector } from '@/features/space/SpaceInspector';

/**
 * The left sidebar, in the order a review is actually carried out:
 *
 *   1. say whose hospital this is
 *   2. pick the floor
 *   3. import and calibrate the hospital's drawing
 *   4. trace the rooms and the things in the way
 *   5. place the machines
 *
 * The equipment list takes the remaining height and scrolls, because it is the part an
 * engineer returns to repeatedly; everything above it is set up once and then mostly
 * read.
 */
export function ProjectSidebar() {
  return (
    <aside
      className="flex w-64 shrink-0 flex-col overflow-y-auto border-r border-edge bg-chrome"
      aria-label="Project"
    >
      <ProjectDetailsPanel />
      <LevelPanel />
      <PlanPanel />
      <SpaceInspector />
      <ObstructionInspector />
      <EquipmentPalette />
    </aside>
  );
}
