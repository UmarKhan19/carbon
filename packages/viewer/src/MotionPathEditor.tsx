import { Line, TransformControls } from "@react-three/drei";
import type { ThreeEvent } from "@react-three/fiber";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Object3D, Vector3 } from "three";
import { motionToWaypoints, waypointsToMotion } from "./motion";
import type { Motion, Vec3 } from "./types";

/**
 * In-scene editor for a step's insertion motion, rendered as a red path with
 * drag-and-drop waypoints. The LAST waypoint is the seated (final) pose and is
 * locked; the first and intermediate waypoints are draggable. Double-click the
 * path to insert a waypoint; select one and press Delete to remove it.
 *
 * Edits serialize back to a RELATIVE motion (`linear`/`L`) via
 * `waypointsToMotion`, so they apply to every part of a rigid-group step. Pure
 * translation — parts keep their seated orientation (see the plan / decision #2).
 *
 * Lives outside the AnimationMixer clip lifecycle: while editing, the player
 * skips building the step clip so parts stay seated and the handles are not
 * fought by playback.
 */
export function MotionPathEditor({
  motion,
  seatedPosition,
  scale,
  onMotionChange
}: {
  motion: Motion;
  /** Centroid of the step's parts' seated world positions (path anchor). */
  seatedPosition: Vec3;
  /** Assembly diagonal (world units) — sizes the waypoint handles. */
  scale: number;
  onMotionChange: (motion: Motion) => void;
}) {
  const [points, setPoints] = useState<Vector3[]>(() =>
    motionToWaypoints(motion, seatedPosition, {
      defaultDistance: scale > 0 ? scale * 0.25 : undefined
    }).map((point) => new Vector3(...point))
  );
  const [selected, setSelected] = useState<number | null>(null);
  // Persistent object the transform gizmo drives; the visible sphere follows it.
  const proxy = useMemo(() => new Object3D(), []);
  // Mirror of `points` for the drag-end commit (state is async).
  const pointsRef = useRef(points);
  useEffect(() => {
    pointsRef.current = points;
  }, [points]);

  const lastIndex = points.length - 1;
  const handleRadius = Math.max(scale * 0.012, 0.5);

  const commit = useCallback(
    (pts: Vector3[]) =>
      onMotionChange(
        waypointsToMotion(
          pts.map((point) => point.toArray() as Vec3),
          seatedPosition
        )
      ),
    [onMotionChange, seatedPosition]
  );

  // Keep the transform gizmo's proxy object sitting on the selected waypoint.
  useEffect(() => {
    const point = selected != null ? points[selected] : null;
    if (point) proxy.position.copy(point);
  }, [selected, points, proxy]);

  const onDrag = useCallback(() => {
    if (selected == null) return;
    setPoints((previous) => {
      const next = previous.map((point, index) =>
        index === selected ? proxy.position.clone() : point
      );
      pointsRef.current = next;
      return next;
    });
  }, [selected, proxy]);

  const insertWaypoint = useCallback(
    (event: ThreeEvent<MouseEvent>) => {
      event.stopPropagation();
      const point = event.point.clone();
      let bestSegment = 0;
      let bestDistance = Number.POSITIVE_INFINITY;
      const current = pointsRef.current;
      for (let i = 0; i < current.length - 1; i++) {
        const from = current[i];
        const to = current[i + 1];
        if (!from || !to) continue;
        const distance = distanceToSegment(point, from, to);
        if (distance < bestDistance) {
          bestDistance = distance;
          bestSegment = i;
        }
      }
      const insertIndex = bestSegment + 1;
      const next = [...current];
      next.splice(insertIndex, 0, point);
      pointsRef.current = next;
      setPoints(next);
      setSelected(insertIndex);
      commit(next);
    },
    [commit]
  );

  // Delete the selected (non-seated) waypoint, keeping at least a start + seated.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Delete" && event.key !== "Backspace") return;
      if (selected == null || selected === lastIndex) return;
      if (pointsRef.current.length <= 2) return;
      const next = pointsRef.current.filter((_, index) => index !== selected);
      pointsRef.current = next;
      setPoints(next);
      setSelected(null);
      commit(next);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selected, lastIndex, commit]);

  const linePoints = useMemo(
    () => points.map((point) => point.toArray() as Vec3),
    [points]
  );

  return (
    <group renderOrder={10}>
      <Line
        points={linePoints}
        color="#ef4444"
        lineWidth={3}
        depthTest={false}
        transparent
        onDoubleClick={insertWaypoint}
      />
      {points.map((point, index) => {
        const isSeated = index === lastIndex;
        return (
          <mesh
            key={index}
            position={point}
            renderOrder={11}
            onClick={(event) => {
              if (isSeated) return;
              event.stopPropagation();
              setSelected(index);
            }}
          >
            <sphereGeometry args={[handleRadius, 20, 20]} />
            <meshBasicMaterial
              color={
                isSeated
                  ? "#9ca3af"
                  : index === selected
                    ? "#f59e0b"
                    : "#ef4444"
              }
              depthTest={false}
              transparent
            />
          </mesh>
        );
      })}
      {/* Invisible proxy the gizmo drags; visible sphere above follows it. */}
      <primitive object={proxy} />
      {selected != null && selected !== lastIndex && (
        <TransformControls
          object={proxy}
          mode="translate"
          onObjectChange={onDrag}
          onMouseUp={() => commit(pointsRef.current)}
        />
      )}
    </group>
  );
}

/** Shortest distance from a point to the segment [a, b]. */
function distanceToSegment(point: Vector3, a: Vector3, b: Vector3): number {
  const ab = b.clone().sub(a);
  const lengthSq = ab.lengthSq();
  if (lengthSq === 0) return point.distanceTo(a);
  const t = Math.max(0, Math.min(1, point.clone().sub(a).dot(ab) / lengthSq));
  return point.distanceTo(a.clone().addScaledVector(ab, t));
}
