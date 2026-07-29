import { useEffect, useState } from 'react';
import { Group, Image as KonvaImage } from 'react-konva';

import {
  type PlanTransform,
  type Viewport,
  pixelToModel,
  worldToScreen,
} from '@mfd/cad-engine';
import type { PlanImage } from '@mfd/document-model';

/**
 * The imported drawing, underneath everything else.
 *
 * ## Why the image is positioned by two corners rather than by a matrix
 *
 * Konva can be handed a rotation and a scale, and it would be shorter. But the
 * composition of the plan transform and the viewport transform would then live half in
 * cad-engine and half in Konva's node properties, and the two would drift the first
 * time either changed. Deriving the on-screen rectangle from the same
 * `pixelToModel` → `worldToScreen` chain every other object uses keeps one definition
 * of where a drawing pixel lands (AD-2).
 */

interface DecodedPlan {
  readonly dataUrl: string;
  readonly bitmap: HTMLImageElement;
}

/**
 * Decode a data URL once per image, not once per render.
 *
 * The decoded bitmap is stored **with the URL it came from**, and the caller gets it
 * only when the two still match. That is what makes clearing the plan a render-time
 * comparison rather than a `setState(null)` inside the effect: a plan removed and a
 * plan still decoding would otherwise both be "not ready", and telling them apart
 * needs the previous image gone before the next render, not after it.
 */
function usePlanBitmap(dataUrl: string | null): HTMLImageElement | null {
  const [decoded, setDecoded] = useState<DecodedPlan | null>(null);

  useEffect(() => {
    if (dataUrl === null) return undefined;

    let cancelled = false;
    const image = new window.Image();
    image.onload = () => {
      // A fast re-import must not have the previous image land after the new one.
      if (!cancelled) setDecoded({ dataUrl, bitmap: image });
    };
    image.src = dataUrl;

    return () => {
      cancelled = true;
    };
  }, [dataUrl]);

  return decoded !== null && decoded.dataUrl === dataUrl ? decoded.bitmap : null;
}

export interface PlanLayerProps {
  readonly planImage: PlanImage | null;
  readonly transform: PlanTransform;
  readonly viewport: Viewport;
  /** Dimmed when the plan is a backdrop rather than the thing being worked on. */
  readonly opacity: number;
}

export function PlanLayer({ planImage, transform, viewport, opacity }: PlanLayerProps) {
  const bitmap = usePlanBitmap(planImage?.dataUrl ?? null);

  if (!planImage || !bitmap) return null;

  const topLeft = worldToScreen(viewport, pixelToModel(transform, { x: 0, y: 0 }));
  const topRight = worldToScreen(
    viewport,
    pixelToModel(transform, { x: planImage.pixelWidth, y: 0 }),
  );
  const bottomLeft = worldToScreen(
    viewport,
    pixelToModel(transform, { x: 0, y: planImage.pixelHeight }),
  );

  const width = Math.hypot(topRight.x - topLeft.x, topRight.y - topLeft.y);
  const height = Math.hypot(bottomLeft.x - topLeft.x, bottomLeft.y - topLeft.y);
  // Read back from the placed corners rather than from the transform, so the drawing
  // and the geometry can never disagree about which way is up.
  const rotationDegrees = (Math.atan2(topRight.y - topLeft.y, topRight.x - topLeft.x) * 180) / Math.PI;

  return (
    <Group listening={false} opacity={opacity}>
      <KonvaImage
        image={bitmap}
        x={topLeft.x}
        y={topLeft.y}
        width={width}
        height={height}
        rotation={rotationDegrees}
      />
    </Group>
  );
}
