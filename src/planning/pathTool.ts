import type { GameState, Operator, Waypoint } from '../types';
import { OPERATOR_RADIUS, PATH_SIMPLIFY_EPSILON } from '../types';
import type { InputState } from '../core/inputManager';
import { distance } from '../math/vec2';
import type { Vec2 } from '../math/vec2';
import { simplifyPath } from '../math/pathSimplify';
import { rebuildPathLUT } from '../operator/pathFollower';

let isDrawingPath = false;
let drawingOperator: Operator | null = null;
let rawPoints: Vec2[] = [];

/**
 * Handle path drawing tool input.
 * - Click on operator to start drawing
 * - Drag to draw path
 * - Release to finish
 */
export function handlePathTool(state: GameState, input: InputState) {
  if (input.justPressed && !isDrawingPath) {
    // Check if clicking on an operator
    for (const op of state.operators) {
      if (distance(input.mousePos, op.position) < OPERATOR_RADIUS + 10) {
        isDrawingPath = true;
        drawingOperator = op;
        rawPoints = [{ x: op.position.x, y: op.position.y }];
        state.selectedOperatorId = op.id;
        // Clear existing path
        op.path.waypoints = [];
        op.path.splineLUT = null;
        return;
      }
    }
  }

  if (isDrawingPath && drawingOperator && input.mouseDown) {
    // Record mouse position while dragging
    const lastPoint = rawPoints[rawPoints.length - 1];
    if (distance(input.mousePos, lastPoint) > 5) {
      rawPoints.push({ x: input.mousePos.x, y: input.mousePos.y });
    }
  }

  if (isDrawingPath && drawingOperator && input.justReleased) {
    // Finish drawing
    if (rawPoints.length >= 2) {
      // Simplify the drawn path
      const simplified = simplifyPath(rawPoints, PATH_SIMPLIFY_EPSILON);

      // Convert to waypoints
      const waypoints: Waypoint[] = simplified.map(p => ({
        position: { x: p.x, y: p.y },
        facingOverride: null,
        hold: false,
        goCode: null,
      }));

      drawingOperator.path.waypoints = waypoints;
      rebuildPathLUT(drawingOperator);
    }

    isDrawingPath = false;
    drawingOperator = null;
    rawPoints = [];
  }
}

/**
 * Handle facing direction tool.
 * Right-click drag on a waypoint to set facing override.
 */
export function handleFacingTool(state: GameState, input: InputState) {
  if (input.rightJustPressed) {
    // Find nearest waypoint
    for (const op of state.operators) {
      for (const wp of op.path.waypoints) {
        if (distance(input.mousePos, wp.position) < 15) {
          // Start setting facing
          state.selectedOperatorId = op.id;
          return;
        }
      }
    }
  }

  if (input.rightMouseDown && state.selectedOperatorId !== null) {
    const op = state.operators.find(o => o.id === state.selectedOperatorId);
    if (!op) return;

    // Find nearest waypoint to set facing on
    let nearestWp: Waypoint | null = null;
    let nearestDist = Infinity;
    for (const wp of op.path.waypoints) {
      const d = distance(input.mousePos, wp.position);
      if (d < nearestDist) {
        nearestDist = d;
        nearestWp = wp;
      }
    }

    // Also check operator position (for setting initial facing)
    if (distance(input.mousePos, op.position) < nearestDist) {
      // Set operator starting angle
      const dx = input.mousePos.x - op.position.x;
      const dy = input.mousePos.y - op.position.y;
      if (dx * dx + dy * dy > 25) {
        op.angle = Math.atan2(dy, dx);
        op.startAngle = op.angle;
      }
      return;
    }

    if (nearestWp) {
      const dx = input.mousePos.x - nearestWp.position.x;
      const dy = input.mousePos.y - nearestWp.position.y;
      if (dx * dx + dy * dy > 25) {
        nearestWp.facingOverride = Math.atan2(dy, dx);
      }
    }
  }
}

/**
 * Handle hold/go-code toggling.
 * Double-click on a waypoint to toggle hold.
 */
let lastClickTime = 0;
let lastClickPos: Vec2 = { x: 0, y: 0 };

export function handleWaypointInteraction(state: GameState, input: InputState) {
  if (input.justPressed && state.activeTool === 'select') {
    const now = Date.now();
    const isDoubleClick = (now - lastClickTime < 400) &&
      distance(input.mousePos, lastClickPos) < 15;

    lastClickTime = now;
    lastClickPos = { x: input.mousePos.x, y: input.mousePos.y };

    if (isDoubleClick) {
      // Toggle hold on nearest waypoint
      for (const op of state.operators) {
        for (const wp of op.path.waypoints) {
          if (distance(input.mousePos, wp.position) < 15) {
            wp.hold = !wp.hold;
            if (wp.hold && !wp.goCode) {
              wp.goCode = 'A'; // Default go code
            }
            return;
          }
        }
      }
    }

    // Single click - select operator
    for (const op of state.operators) {
      if (distance(input.mousePos, op.position) < OPERATOR_RADIUS + 10) {
        state.selectedOperatorId = op.id;
        return;
      }
    }

    // Click on empty space - deselect
    state.selectedOperatorId = null;
  }
}

export function isCurrentlyDrawing(): boolean {
  return isDrawingPath;
}

export function getRawPoints(): Vec2[] {
  return rawPoints;
}
