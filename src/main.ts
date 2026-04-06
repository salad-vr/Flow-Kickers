import './style.css';
import type { GameState, Operator, Interaction, NodePopup, Room, SharePanelBtn, PendingNode, SpeedSliderState, RadialMenu, RadialMenuItem, HudBtn } from './types';
import type { Vec2 } from './math/vec2';
import { C, OP_R, NODE_R, DEPLOY_PANEL_H, DEPLOY_OP_SPACING, GRID, DOOR_W, WALL_W, OP_SPEED, FOV_ANG, FOV_DIST, makeWaypoint } from './types';
import { startGameLoop } from './core/gameLoop';
import { initInput, getInput, clearFrameInput } from './core/inputManager';
import { ROOM_TEMPLATES, type RoomTemplateName, STAMP_TEMPLATES, STAMP_NAMES, type StampName } from './room/templates';
import { createOperator, resetOperatorId, resetOperator, setOperatorNextId } from './operator/operator';
import { rebuildPathLUT } from './operator/pathFollower';
import { distance, copy, distToSegment, closestPointOnSegment } from './math/vec2';
import { updateSimulation, resetSimulation, startExecution } from './core/simulation';
import { renderGame, resetSharePanelAnim, SHARE_BTN, getShareBtnX } from './rendering/renderer';
import { exportGIF, downloadBlob } from './export/gifExporter';
import { cornerFedRoom } from './room/templates';
import { makeWall, makeThreat, createEmptyRoom, getStairAtPoint, getStairDestFloor } from './room/room';
import { encodeRoomCode, decodeRoomCode } from './room/roomCode';
import { initMusic, toggleMute, isMuted } from './audio/musicPlayer';
import { sfxClick, sfxSelect, sfxConfirm, sfxBack, sfxTick, sfxDelete } from './audio/sfx';

// ---- Extracted game modules (for multiplayer reuse) ----
import {
  doGo as _doGo, doReset as _doReset, doReplay as _doReplay,
  doClearLevel as _doClearLevel, saveStage as _saveStage,
  editStage as _editStage, deleteSelected as _deleteSelected,
  checkStageCompletion as _checkStageCompletion,
  loadAndExecuteStage as _loadAndExecuteStage,
  resetAllThreats as _resetAllThreats, clearUIOverlays,
} from './game/actions';
import {
  openSharePanel as _openSharePanel, closeSharePanel as _closeSharePanel,
  copyRoomCode as _copyRoomCode, doExportGif as _doExportGif,
  downloadShareGif as _downloadShareGif,
} from './game/hudActions';
import {
  handleInput as _handleGameInput, handleGameKeydown,
  saveConfirmTimer as _saveConfirmTimerRef, tickSaveConfirmTimer,
  showSaveConfirmation as _showSaveConfirmation,
} from './game/gameInput';
import { computeFloorCells } from './game/helpers';
import { bakePieDirection } from './game/radialMenu';
import {
  serializeSession, restoreSession as restoreSessionData,
  restoreWalls, restoreObjects, roomFromSavedMap,
  saveSessionToStorage, clearSessionStorage, loadSessionFromStorage,
  loadSavedMaps, saveMapsToStorage, deleteSavedMap as _deleteSavedMap,
  saveImportedMap, loadInProgressSessions, saveInProgressToStorage,
  deleteInProgressSession as _deleteInProgressSession,
  saveProgress as _saveProgress, saveCurrentMap as _saveCurrentMap,
  type SavedMap, type SerializedSession, type SavedSession,
} from './game/persistence';
import { NetworkSync } from './network/sync';
import { PLAYER_COLORS } from './network/types';
import { setNetSync } from './network/index';

// ---- HTML ----
const app = document.getElementById('app')!;
app.innerHTML = `
<div id="menu-screen">
  <div class="menu-content">
    <div class="menu-header">
      <h1 class="menu-title">
        <span class="menu-title-flow">Flow</span>
        <span class="menu-title-kickers">Kickers</span>
      </h1>
      <div class="menu-swoosh">
        <svg viewBox="0 0 200 16" preserveAspectRatio="none"><path d="M0 12 C40 12, 60 2, 100 2 S160 12, 200 8" fill="none" stroke="var(--cream)" stroke-width="2.5" stroke-linecap="round" opacity=".3"/></svg>
      </div>
      <p class="menu-subtitle">Room Clearing Simulator</p>
    </div>

    <div class="menu-section">
      <label class="menu-label">Select Room</label>
      <div id="room-btns" class="menu-room-grid"></div>
    </div>

    <button id="btn-start" class="menu-start-btn">START MISSION</button>

    <div class="menu-section" style="margin-top:12px;">
      <label class="menu-label">Multiplayer</label>
      <div class="menu-footer-row" style="gap:8px;">
        <button id="btn-mp-host" class="menu-link-btn" style="flex:1;">Host Game</button>
        <button id="btn-mp-join" class="menu-link-btn" style="flex:1;">Join Game</button>
      </div>
      <div id="mp-join-row" class="menu-code-row" style="display:none;margin-top:6px;">
        <input id="mp-join-input" class="menu-code-input" type="text" placeholder="Enter room code (e.g. FKAB12)" spellcheck="false" autocomplete="off" maxlength="6" style="text-transform:uppercase;" />
        <button id="btn-mp-join-go" class="menu-code-btn">JOIN</button>
      </div>
      <p id="mp-error" class="menu-code-error"></p>
    </div>

    <div id="in-progress-section" class="menu-section" style="display:none">
      <label class="menu-label">In Progress</label>
      <div id="in-progress-btns" class="menu-room-grid"></div>
    </div>

    <div class="menu-code-section">
      <div class="menu-code-header">
        <label class="menu-label">Enter Room Code</label>
      </div>
      <div class="menu-code-row">
        <input id="menu-code-input" class="menu-code-input" type="text" placeholder="Paste room code here..." spellcheck="false" autocomplete="off" />
        <button id="btn-load-code" class="menu-code-btn">LOAD</button>
      </div>
      <p id="menu-code-error" class="menu-code-error"></p>
    </div>

    <div id="custom-maps-section" class="menu-section" style="display:none">
      <label class="menu-label">Your Custom Maps</label>
      <div id="custom-map-btns" class="menu-room-grid"></div>
    </div>

    <div class="menu-footer">
      <div class="menu-footer-row">
        <button id="btn-tut" class="menu-link-btn">How to Play</button>
        <button id="btn-build" class="menu-link-btn">Build Your Own</button>
      </div>
    </div>
  </div>
</div>

<div id="tut-screen" style="display:none">
  <div class="tut-deck">
    <div class="tut-slides" id="tut-slides">

      <!-- Slide 1: Deploy Operators -->
      <div class="tut-slide">
        <div class="tut-visual">
          <svg viewBox="0 0 280 160" class="tut-svg">
            <rect x="0" y="0" width="280" height="160" rx="6" fill="#0c1525"/>
            <!-- Room floor -->
            <rect x="80" y="15" width="180" height="110" rx="2" fill="#d4c9a8" opacity=".15"/>
            <!-- Walls -->
            <rect x="80" y="15" width="180" height="110" rx="2" fill="none" stroke="#1e3352" stroke-width="4"/>
            <!-- Door gap bottom -->
            <rect x="150" y="121" width="30" height="6" fill="#0c1525"/>
            <rect x="150" y="121" width="30" height="4" rx="1" fill="#4a6040" opacity=".6"/>
            <!-- Deploy panel -->
            <rect x="8" y="132" width="130" height="24" rx="6" fill="rgba(12,21,37,0.95)" stroke="#e8dfc6" stroke-width="1" stroke-dasharray="5 4"/>
            <text x="73" y="141" text-anchor="middle" fill="#8a836e" font-size="4.5" font-family="monospace">DRAG OPERATORS INTO PLACE</text>
            <!-- Ops in panel (smaller, matching deploy panel scale) -->
            <g transform="translate(30,148) scale(0.75)"><polygon points="12,0 -8,-8 -2.25,0 -8,8" fill="#c8bb96" stroke="#5588cc" stroke-width="2"/></g>
            <g transform="translate(58,148) scale(0.75)"><polygon points="12,0 -8,-8 -2.25,0 -8,8" fill="#c8bb96" stroke="#cc7744" stroke-width="2"/></g>
            <g transform="translate(86,148) scale(0.75)"><polygon points="12,0 -8,-8 -2.25,0 -8,8" fill="#c8bb96" stroke="#55aa66" stroke-width="2"/></g>
            <!-- Drag arrow -->
            <path d="M42,142 C55,125 120,90 165,80" fill="none" stroke="#e8dfc6" stroke-width="1" stroke-dasharray="4 3" opacity=".4"/>
            <polygon points="168,79 163,83 164,76" fill="#e8dfc6" opacity=".4"/>
            <!-- Deployed op at destination -->
            <g transform="translate(170,80) rotate(-30)"><polygon points="12,0 -8,-8 -2.25,0 -8,8" fill="#c8bb96" stroke="#5588cc" stroke-width="2"/></g>
            <!-- Selection glow -->
            <circle cx="170" cy="80" r="14" fill="none" stroke="#5588cc" stroke-width="1" opacity=".25"/>
          </svg>
        </div>
        <div class="tut-text">
          <h3 class="tut-slide-title">Deploy Operators</h3>
          <p><b>Drag operators</b> from the bottom panel onto the map to position them. Place them near doors and entry points to prepare your breach.</p>
        </div>
      </div>

      <!-- Slide 2: Plan the Route -->
      <div class="tut-slide">
        <div class="tut-visual">
          <svg viewBox="0 0 280 160" class="tut-svg">
            <rect x="0" y="0" width="280" height="160" rx="6" fill="#0c1525"/>
            <!-- Room -->
            <rect x="20" y="12" width="240" height="120" rx="2" fill="#d4c9a8" opacity=".12"/>
            <rect x="20" y="12" width="240" height="120" rx="2" fill="none" stroke="#1e3352" stroke-width="3"/>
            <!-- Deployed op (selected, bottom-left) -->
            <g transform="translate(50,108) rotate(-50)"><polygon points="10,0 -7,-7 -2,0 -7,7" fill="#c8bb96" stroke="#5588cc" stroke-width="1.8"/></g>
            <circle cx="50" cy="108" r="13" fill="none" stroke="#5588cc" stroke-width="0.8" opacity=".3"/>
            <!-- Path -->
            <path d="M50,108 C80,85 120,50 165,42 S220,45 240,55" fill="none" stroke="#5588cc" stroke-width="1.8" stroke-dasharray="7 4" opacity=".6" stroke-linecap="round"/>
            <!-- Waypoint nodes -->
            <circle cx="120" cy="55" r="4.5" fill="#5588cc" stroke="#e8dfc6" stroke-width="1.2"/>
            <circle cx="165" cy="42" r="4.5" fill="#5588cc" stroke="#e8dfc6" stroke-width="1.2"/>
            <circle cx="240" cy="55" r="4.5" fill="#5588cc" stroke="#e8dfc6" stroke-width="1.2"/>
            <!-- Confirm/cancel next to last node -->
            <rect x="247" y="48" width="12" height="12" rx="3" fill="rgba(85,170,102,0.9)" stroke="rgba(120,200,140,0.7)" stroke-width="0.7"/>
            <polyline points="250,54 252.5,56.5 257,51" fill="none" stroke="white" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
            <rect x="228" y="48" width="12" height="12" rx="3" fill="rgba(204,68,51,0.9)" stroke="rgba(230,100,80,0.7)" stroke-width="0.7"/>
            <line x1="231" y1="51" x2="237" y2="57" stroke="white" stroke-width="1.3" stroke-linecap="round"/>
            <line x1="237" y1="51" x2="231" y2="57" stroke="white" stroke-width="1.3" stroke-linecap="round"/>
            <!-- Hint -->
            <text x="140" y="145" text-anchor="middle" fill="#8a836e" font-size="4.5" font-family="monospace">click to select, then click to place waypoints</text>
          </svg>
        </div>
        <div class="tut-text">
          <h3 class="tut-slide-title">Plan the Route</h3>
          <p>Click a deployed operator to <b>select</b> them. Click again to open the radial menu and choose <b>Route</b>, then click on the map to place waypoints. Hit the <b>checkmark</b> to confirm or <b>X</b> to cancel.</p>
        </div>
      </div>

      <!-- Slide 3: Radial Menu -->
      <div class="tut-slide">
        <div class="tut-visual">
          <svg viewBox="0 0 280 160" class="tut-svg">
            <rect x="0" y="0" width="280" height="160" rx="6" fill="#0c1525"/>
            <!-- Operator radial menu (left side) -->
            <text x="70" y="14" text-anchor="middle" fill="#e8dfc6" font-size="6" font-family="monospace" font-weight="bold">OPERATOR MENU</text>
            <!-- Center op -->
            <g transform="translate(70,72)"><polygon points="9,0 -6,-6 -1.7,0 -6,6" fill="#c8bb96" stroke="#5588cc" stroke-width="1.5"/></g>
            <!-- Dashed ring -->
            <circle cx="70" cy="72" r="28" fill="none" stroke="#5588cc" stroke-width="1" stroke-dasharray="4 3" opacity=".2"/>
            <!-- Direction (top) -->
            <g transform="translate(70,44)"><circle r="10" fill="rgba(17,29,51,0.92)" stroke="#274166" stroke-width="1"/><line x1="-4" y1="0" x2="4" y2="0" stroke="#e8dfc6" stroke-width="1.5" stroke-linecap="round"/><polyline points="1,-3 4,0 1,3" fill="none" stroke="#e8dfc6" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></g>
            <text x="70" y="30" text-anchor="middle" fill="#8a836e" font-size="4" font-family="monospace">DIRECTION</text>
            <!-- Pie (right) -->
            <g transform="translate(98,72)"><circle r="10" fill="rgba(17,29,51,0.92)" stroke="#274166" stroke-width="1"/><path d="M0,0 L4.2,-4.2 A6,6,0,0,1,4.2,4.2 Z" fill="#c8a83a" stroke="#a0822a" stroke-width="0.8"/><circle cx="0" cy="-2.7" r="1.2" fill="#cc4433"/></g>
            <text x="98" y="87" text-anchor="middle" fill="#8a836e" font-size="4" font-family="monospace">PIE</text>
            <!-- Route (bottom) -->
            <g transform="translate(70,100)"><circle r="10" fill="rgba(17,29,51,0.92)" stroke="#274166" stroke-width="1"/><line x1="0" y1="-4" x2="0" y2="4" stroke="#e8dfc6" stroke-width="1.5" stroke-linecap="round"/><line x1="-4" y1="0" x2="4" y2="0" stroke="#e8dfc6" stroke-width="1.5" stroke-linecap="round"/></g>
            <text x="70" y="115" text-anchor="middle" fill="#8a836e" font-size="4" font-family="monospace">ROUTE</text>
            <!-- Speed (left) -->
            <g transform="translate(42,72)"><circle r="10" fill="rgba(17,29,51,0.92)" stroke="#274166" stroke-width="1"/><path d="M-3,-5 L3,-5 L0,-1 Z" fill="none" stroke="#e8dfc6" stroke-width="1.2"/><path d="M-3,5 L3,5 L0,1 Z" fill="none" stroke="#e8dfc6" stroke-width="1.2"/><line x1="-4" y1="-5" x2="4" y2="-5" stroke="#e8dfc6" stroke-width="1.2"/><line x1="-4" y1="5" x2="4" y2="5" stroke="#e8dfc6" stroke-width="1.2"/></g>
            <text x="42" y="87" text-anchor="middle" fill="#8a836e" font-size="4" font-family="monospace">SPEED</text>

            <!-- Divider -->
            <line x1="140" y1="20" x2="140" y2="140" stroke="#274166" stroke-width="0.5" opacity=".4"/>

            <!-- Node radial menu (right side) -->
            <text x="210" y="14" text-anchor="middle" fill="#e8dfc6" font-size="6" font-family="monospace" font-weight="bold">NODE MENU</text>
            <!-- Center node -->
            <circle cx="210" cy="72" r="5" fill="#cc7744" stroke="#e8dfc6" stroke-width="1.5"/>
            <circle cx="210" cy="72" r="28" fill="none" stroke="#cc7744" stroke-width="1" stroke-dasharray="4 3" opacity=".2"/>
            <!-- Direction (top, 0deg) -->
            <g transform="translate(210,44)"><circle r="10" fill="rgba(17,29,51,0.92)" stroke="#274166" stroke-width="1"/><line x1="-4" y1="0" x2="4" y2="0" stroke="#e8dfc6" stroke-width="1.5" stroke-linecap="round"/><polyline points="1,-3 4,0 1,3" fill="none" stroke="#e8dfc6" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></g>
            <!-- Add Route (72deg ~ upper-right) -->
            <g transform="translate(237,59)"><circle r="10" fill="rgba(17,29,51,0.92)" stroke="#274166" stroke-width="1"/><line x1="0" y1="-4" x2="0" y2="4" stroke="#e8dfc6" stroke-width="1.5" stroke-linecap="round"/><line x1="-4" y1="0" x2="4" y2="0" stroke="#e8dfc6" stroke-width="1.5" stroke-linecap="round"/></g>
            <!-- Delete (144deg ~ lower-right) -->
            <g transform="translate(230,94)"><circle r="10" fill="rgba(17,29,51,0.92)" stroke="#274166" stroke-width="1"/><line x1="-3" y1="-3" x2="3" y2="3" stroke="#cc6655" stroke-width="1.5" stroke-linecap="round"/><line x1="3" y1="-3" x2="-3" y2="3" stroke="#cc6655" stroke-width="1.5" stroke-linecap="round"/></g>
            <!-- Speed (216deg ~ lower-left) -->
            <g transform="translate(190,94)"><circle r="10" fill="rgba(17,29,51,0.92)" stroke="#274166" stroke-width="1"/><path d="M-3,-5 L3,-5 L0,-1 Z" fill="none" stroke="#e8dfc6" stroke-width="1.2"/><path d="M-3,5 L3,5 L0,1 Z" fill="none" stroke="#e8dfc6" stroke-width="1.2"/></g>
            <!-- Hold (288deg ~ upper-left) -->
            <g transform="translate(183,59)"><circle r="10" fill="rgba(17,29,51,0.92)" stroke="#274166" stroke-width="1"/><rect x="-3" y="-3" width="2.5" height="6" rx="0.5" fill="#cc7744"/><rect x="1" y="-3" width="2.5" height="6" rx="0.5" fill="#cc7744"/></g>
            <!-- Labels -->
            <text x="210" y="30" text-anchor="middle" fill="#8a836e" font-size="3.5" font-family="monospace">DIR</text>
            <text x="243" y="54" text-anchor="middle" fill="#8a836e" font-size="3.5" font-family="monospace">ROUTE</text>
            <text x="237" y="109" text-anchor="middle" fill="#8a836e" font-size="3.5" font-family="monospace">DELETE</text>
            <text x="183" y="109" text-anchor="middle" fill="#8a836e" font-size="3.5" font-family="monospace">SPEED</text>
            <text x="177" y="54" text-anchor="middle" fill="#8a836e" font-size="3.5" font-family="monospace">HOLD</text>
          </svg>
        </div>
        <div class="tut-text">
          <h3 class="tut-slide-title">Radial Menu</h3>
          <p>Click an <b>operator</b> to get Direction, Pie target, Route, and Speed options. Click a <b>waypoint node</b> for Direction, Add Route, Delete, Speed, and Hold. Menus appear around the selected element.</p>
        </div>
      </div>

      <!-- Slide 4: Nodes & Direction -->
      <div class="tut-slide">
        <div class="tut-visual">
          <svg viewBox="0 0 280 160" class="tut-svg">
            <rect x="0" y="0" width="280" height="160" rx="6" fill="#0c1525"/>
            <!-- Room background -->
            <rect x="15" y="8" width="250" height="130" rx="2" fill="#d4c9a8" opacity=".08"/>
            <rect x="15" y="8" width="250" height="130" rx="2" fill="none" stroke="#1e3352" stroke-width="2.5"/>
            <!-- Operator bottom-left -->
            <g transform="translate(40,115) rotate(-50)"><polygon points="10,0 -7,-7 -2,0 -7,7" fill="#c8bb96" stroke="#5588cc" stroke-width="1.8"/></g>
            <!-- Path curving up across the room -->
            <path d="M40,115 C60,90 90,60 130,50 S175,45 210,55 S240,60 250,50" fill="none" stroke="#5588cc" stroke-width="1.8" stroke-dasharray="7 4" opacity=".55" stroke-linecap="round"/>

            <!-- Node 1: normal -->
            <circle cx="90" cy="63" r="4.5" fill="#5588cc" stroke="#e8dfc6" stroke-width="1.2"/>

            <!-- Node 2: with look-at target -->
            <circle cx="130" cy="50" r="4.5" fill="#5588cc" stroke="#e8dfc6" stroke-width="1.2"/>
            <line x1="130" y1="50" x2="130" y2="20" stroke="#6699bb" stroke-width="0.8" stroke-dasharray="4 3" opacity=".6"/>
            <circle cx="130" cy="20" r="4" fill="none" stroke="#6699bb" stroke-width="0.8"/>
            <line x1="127.5" y1="20" x2="132.5" y2="20" stroke="#6699bb" stroke-width="0.8"/>
            <line x1="130" y1="17.5" x2="130" y2="22.5" stroke="#6699bb" stroke-width="0.8"/>
            <text x="140" y="18" fill="#6699bb" font-size="4" font-family="monospace">look-at</text>

            <!-- Node 3: with facing arrow -->
            <circle cx="175" cy="45" r="4.5" fill="#5588cc" stroke="#e8dfc6" stroke-width="1.2"/>
            <line x1="175" y1="45" x2="192" y2="35" stroke="#5588cc" stroke-width="1.3"/>
            <polygon points="194,34 189,37 190,32" fill="#5588cc"/>
            <text x="195" y="30" fill="#8a836e" font-size="4" font-family="monospace">facing</text>

            <!-- Node 4: hold with ring -->
            <circle cx="210" cy="55" r="4.5" fill="#cc7744" stroke="#e8dfc6" stroke-width="1.2"/>
            <circle cx="210" cy="55" r="8.5" fill="none" stroke="#cc7744" stroke-width="1.2"/>
            <text x="210" y="70" text-anchor="middle" fill="#cc7744" font-size="4" font-family="monospace">hold</text>

            <!-- Node 5: end with speed label -->
            <circle cx="250" cy="50" r="4.5" fill="#5588cc" stroke="#e8dfc6" stroke-width="1.2"/>
            <text x="250" y="42" text-anchor="middle" fill="#cc5544" font-size="5" font-family="monospace" font-weight="bold">2x</text>
            <text x="250" y="62" text-anchor="middle" fill="#8a836e" font-size="4" font-family="monospace">speed</text>

            <!-- Hint at bottom -->
            <text x="140" y="148" text-anchor="middle" fill="#8a836e" font-size="4.5" font-family="monospace">drag nodes to reposition, right-click to set facing</text>
          </svg>
        </div>
        <div class="tut-text">
          <h3 class="tut-slide-title">Nodes & Direction</h3>
          <p><b>Drag</b> nodes to reposition them. <b>Right-click + drag</b> to set facing direction. Use the node menu for <b>Hold</b> (pauses until triggered), <b>Look-At</b> (locks gaze on a point), and <b>Speed</b> (0.2x - 3x).</p>
        </div>
      </div>

      <!-- Slide 5: Execute -->
      <div class="tut-slide">
        <div class="tut-visual">
          <svg viewBox="0 0 280 160" class="tut-svg">
            <rect x="0" y="0" width="280" height="160" rx="6" fill="#0c1525"/>
            <!-- Room -->
            <rect x="15" y="8" width="250" height="114" rx="2" fill="#d4c9a8" opacity=".1"/>
            <rect x="15" y="8" width="250" height="114" rx="2" fill="none" stroke="#1e3352" stroke-width="3"/>
            <!-- Faded path showing completed route -->
            <path d="M50,105 C70,80 100,50 145,42 S195,40 225,55" fill="none" stroke="#5588cc" stroke-width="1.2" opacity=".15" stroke-dasharray="5 3"/>
            <!-- Second op faded path -->
            <path d="M60,85 C85,65 120,40 165,35 S210,30 240,38" fill="none" stroke="#cc7744" stroke-width="1.2" opacity=".15" stroke-dasharray="5 3"/>
            <!-- FOV cone for operator A -->
            <path d="M155,48 L210,22 L205,72 Z" fill="#5588cc" opacity=".08"/>
            <line x1="155" y1="48" x2="210" y2="22" stroke="#5588cc" stroke-width="0.6" opacity=".15"/>
            <line x1="155" y1="48" x2="205" y2="72" stroke="#5588cc" stroke-width="0.6" opacity=".15"/>
            <!-- Operator A mid-route -->
            <g transform="translate(155,48) rotate(-15)"><polygon points="10,0 -7,-7 -2,0 -7,7" fill="#c8bb96" stroke="#5588cc" stroke-width="1.8"/></g>
            <!-- FOV cone for operator B -->
            <path d="M130,38 L175,15 L178,58 Z" fill="#cc7744" opacity=".06"/>
            <!-- Operator B mid-route -->
            <g transform="translate(130,38) rotate(-10)"><polygon points="10,0 -7,-7 -2,0 -7,7" fill="#c8bb96" stroke="#cc7744" stroke-width="1.8"/></g>
            <!-- Threat (active) -->
            <g transform="translate(200,35)">
              <circle r="10" fill="rgba(200,60,50,0.15)"/>
              <line x1="-5" y1="-5" x2="5" y2="5" stroke="#cc4433" stroke-width="2.5" stroke-linecap="round"/>
              <line x1="5" y1="-5" x2="-5" y2="5" stroke="#cc4433" stroke-width="2.5" stroke-linecap="round"/>
            </g>
            <!-- Threat (neutralized) -->
            <g transform="translate(90,28)" opacity=".3">
              <line x1="-4" y1="-4" x2="4" y2="4" stroke="#3a3a44" stroke-width="2" stroke-linecap="round"/>
              <line x1="4" y1="-4" x2="-4" y2="4" stroke="#3a3a44" stroke-width="2" stroke-linecap="round"/>
            </g>
            <!-- Another neutralized -->
            <g transform="translate(240,70)" opacity=".3">
              <line x1="-4" y1="-4" x2="4" y2="4" stroke="#3a3a44" stroke-width="2" stroke-linecap="round"/>
              <line x1="4" y1="-4" x2="-4" y2="4" stroke="#3a3a44" stroke-width="2" stroke-linecap="round"/>
            </g>
            <!-- HUD bar at bottom of scene -->
            <rect x="15" y="122" width="250" height="26" rx="0 0 2 2" fill="rgba(12,21,37,0.92)"/>
            <line x1="15" y1="122" x2="265" y2="122" stroke="#1e3352" stroke-width="0.8"/>
            <!-- GO button -->
            <rect x="110" y="127" width="40" height="16" rx="4" fill="rgba(18,30,48,0.85)" stroke="#e8dfc6" stroke-width="0.8"/>
            <text x="130" y="138" text-anchor="middle" fill="#e8dfc6" font-size="7" font-weight="bold" font-family="monospace">GO!</text>
            <!-- PAUSE -->
            <rect x="155" y="127" width="42" height="16" rx="4" fill="rgba(18,30,48,0.85)" stroke="#1e3352" stroke-width="0.8"/>
            <text x="176" y="138" text-anchor="middle" fill="#8a836e" font-size="6" font-weight="bold" font-family="monospace">RESET</text>
            <!-- Room name -->
            <text x="25" y="137" fill="#e8dfc6" font-size="5" font-weight="bold" font-family="monospace">CORNER FED</text>
            <!-- SPACE keycap hint below -->
            <rect x="116" y="147" width="28" height="10" rx="2.5" fill="#274166"/>
            <text x="130" y="154.5" text-anchor="middle" fill="#e8dfc6" font-size="4.5" font-family="monospace">SPACE</text>
          </svg>
        </div>
        <div class="tut-text">
          <h3 class="tut-slide-title">Execute the Plan</h3>
          <p>Press <b>Space</b> or click <b>GO</b> to run the simulation. Operators follow their paths and <b>clear threats</b> within their field of view. Press Space again to pause, <b>R</b> to reset.</p>
        </div>
      </div>

      <!-- Slide 6: Stages -->
      <div class="tut-slide">
        <div class="tut-visual">
          <svg viewBox="0 0 280 160" class="tut-svg">
            <rect x="0" y="0" width="280" height="160" rx="6" fill="#0c1525"/>
            <!-- Stage 1 -->
            <rect x="10" y="18" width="125" height="95" rx="4" fill="#1e3352" opacity=".5" stroke="#274166" stroke-width="1"/>
            <text x="72" y="12" text-anchor="middle" fill="#e8dfc6" font-size="6" font-family="monospace" font-weight="bold">STAGE 1</text>
            <!-- Op A start -->
            <g transform="translate(35,85) rotate(-45)"><polygon points="9,0 -6,-6 -1.7,0 -6,6" fill="#c8bb96" stroke="#5588cc" stroke-width="1.5"/></g>
            <path d="M35,85 C50,65 70,45 95,40" fill="none" stroke="#5588cc" stroke-width="1.5" stroke-dasharray="6 4" opacity=".5"/>
            <circle cx="95" cy="40" r="4" fill="#5588cc" stroke="#e8dfc6" stroke-width="1"/>
            <!-- Op B -->
            <g transform="translate(40,55) rotate(0)"><polygon points="9,0 -6,-6 -1.7,0 -6,6" fill="#c8bb96" stroke="#cc7744" stroke-width="1.5"/></g>
            <path d="M40,55 C60,50 80,38 110,35" fill="none" stroke="#cc7744" stroke-width="1.5" stroke-dasharray="6 4" opacity=".5"/>
            <circle cx="110" cy="35" r="4" fill="#cc7744" stroke="#e8dfc6" stroke-width="1"/>

            <!-- Arrow -->
            <line x1="140" y1="65" x2="150" y2="65" stroke="#e8dfc6" stroke-width="1.5"/>
            <polygon points="153,65 148,61 148,69" fill="#e8dfc6"/>

            <!-- Stage 2 -->
            <rect x="158" y="18" width="112" height="95" rx="4" fill="#1e3352" opacity=".5" stroke="#274166" stroke-width="1"/>
            <text x="214" y="12" text-anchor="middle" fill="#e8dfc6" font-size="6" font-family="monospace" font-weight="bold">STAGE 2</text>
            <!-- Ops continue from stage 1 end positions -->
            <g transform="translate(175,42) rotate(20)"><polygon points="9,0 -6,-6 -1.7,0 -6,6" fill="#c8bb96" stroke="#5588cc" stroke-width="1.5"/></g>
            <path d="M175,42 C190,55 210,70 240,80" fill="none" stroke="#5588cc" stroke-width="1.5" stroke-dasharray="6 4" opacity=".5"/>
            <circle cx="240" cy="80" r="4" fill="#5588cc" stroke="#e8dfc6" stroke-width="1"/>
            <g transform="translate(185,37) rotate(30)"><polygon points="9,0 -6,-6 -1.7,0 -6,6" fill="#c8bb96" stroke="#cc7744" stroke-width="1.5"/></g>
            <path d="M185,37 C210,50 230,65 250,58" fill="none" stroke="#cc7744" stroke-width="1.5" stroke-dasharray="6 4" opacity=".5"/>

            <!-- HUD bar with Save Stage -->
            <rect x="0" y="126" width="280" height="34" fill="rgba(12,21,37,0.92)"/>
            <line x1="0" y1="126" x2="280" y2="126" stroke="#1e3352" stroke-width="1"/>
            <!-- Stage dots -->
            <circle cx="118" cy="143" r="4.5" fill="#e8dfc6"/>
            <text x="118" y="145.5" text-anchor="middle" fill="#0c1525" font-size="6" font-weight="bold" font-family="monospace">1</text>
            <circle cx="136" cy="143" r="4.5" fill="none" stroke="#e8dfc6" stroke-width="1"/>
            <text x="136" y="145.5" text-anchor="middle" fill="#e8dfc6" font-size="6" font-family="monospace">2</text>
            <circle cx="154" cy="143" r="3.5" fill="none" stroke="#8a836e" stroke-width="0.8" stroke-dasharray="2 2"/>
            <!-- Save Stage button -->
            <rect x="170" y="133" width="74" height="20" rx="5" fill="rgba(18,30,48,0.85)" stroke="#e8dfc6" stroke-width="1"/>
            <text x="207" y="146" text-anchor="middle" fill="#e8dfc6" font-size="6.5" font-weight="bold" font-family="monospace">SAVE STAGE</text>
          </svg>
        </div>
        <div class="tut-text">
          <h3 class="tut-slide-title">Stages</h3>
          <p>Break complex plans into <b>stages</b>. Set up your operators, draw their routes, then hit <b>Save Stage</b>. Operators stay at their end positions so you can plan the next move from there. All stages play back in sequence.</p>
        </div>
      </div>

    </div>

    <!-- Navigation -->
    <div class="tut-nav">
      <button id="tut-prev" class="tut-nav-btn">&larr;</button>
      <div id="tut-dots" class="tut-dots"></div>
      <button id="tut-next" class="tut-nav-btn">&rarr;</button>
    </div>
    <button id="btn-tut-back" class="menu-start-btn tut-back-btn">GOT IT</button>
  </div>
</div>

<div id="build-screen" style="display:none">
  <div class="build-layout">
    <div class="build-canvas-area">
      <canvas id="build-cv"></canvas>
    </div>
    <div class="build-sidebar">
      <h2 class="build-title">BUILD YOUR OWN</h2>
      <div class="build-tools-section">
        <label class="menu-label">TOOLS</label>
        <div class="build-tools-grid">
          <button class="build-tool active" data-tool="line"><div class="build-tool-icon"><svg width="20" height="20" viewBox="0 0 20 20"><line x1="3" y1="17" x2="17" y2="3" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg></div><span>Line</span><kbd>1</kbd></button>
          <button class="build-tool" data-tool="square"><div class="build-tool-icon"><svg width="20" height="20" viewBox="0 0 20 20"><rect x="3" y="3" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg></div><span>Square</span><kbd>2</kbd></button>
          <button class="build-tool" data-tool="delete"><div class="build-tool-icon"><svg width="20" height="20" viewBox="0 0 20 20"><line x1="5" y1="5" x2="15" y2="15" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/><line x1="15" y1="5" x2="5" y2="15" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg></div><span>Delete</span><kbd>3</kbd></button>
          <button class="build-tool" data-tool="door"><div class="build-tool-icon"><svg width="20" height="20" viewBox="0 0 20 20"><rect x="5" y="2" width="10" height="16" fill="none" stroke="currentColor" stroke-width="1.8" rx="1.5"/><circle cx="13" cy="11" r="1.5" fill="currentColor"/></svg></div><span>Door</span><kbd>4</kbd></button>
        </div>
      </div>
      <div class="build-tools-section">
        <label class="menu-label">MORE</label>
        <div class="build-tools-grid">
          <button class="build-tool" data-tool="object"><div class="build-tool-icon"><svg width="20" height="20" viewBox="0 0 20 20"><rect x="3" y="3" width="14" height="14" fill="currentColor" opacity=".3" stroke="currentColor" stroke-width="1.5"/></svg></div><span>Object</span><kbd>5</kbd></button>
          <button class="build-tool" data-tool="stairs"><div class="build-tool-icon"><svg width="20" height="20" viewBox="0 0 20 20"><path d="M3 17h4v-4h4v-4h4v-4h2" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg></div><span>Stairs</span><kbd>6</kbd></button>
          <button class="build-tool" data-tool="threat"><div class="build-tool-icon"><svg width="20" height="20" viewBox="0 0 20 20"><circle cx="10" cy="10" r="7" fill="none" stroke="currentColor" stroke-width="1.5"/><line x1="10" y1="4.5" x2="10" y2="9" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="10" cy="13" r="1.2" fill="currentColor"/></svg></div><span>Threat</span><kbd>7</kbd></button>
          <button class="build-tool" data-tool="label"><div class="build-tool-icon"><svg width="20" height="20" viewBox="0 0 20 20"><text x="10" y="14" text-anchor="middle" fill="currentColor" font-size="12" font-weight="bold" font-family="monospace">T</text></svg></div><span>Label</span><kbd>9</kbd></button>
          <button class="build-tool" data-tool="eraser"><div class="build-tool-icon"><svg width="20" height="20" viewBox="0 0 20 20"><rect x="4" y="4" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-dasharray="3 2"/><line x1="4" y1="4" x2="16" y2="16" stroke="currentColor" stroke-width="1.5"/></svg></div><span>Eraser</span><kbd>8</kbd></button>
        </div>
      </div>
      <div class="build-tools-section">
        <label class="menu-label">FLOORS</label>
        <div class="build-floor-tabs" id="build-floor-tabs"></div>
        <div class="build-tools-grid">
          <button class="build-tool" data-tool="addfloor"><div class="build-tool-icon"><svg width="20" height="20" viewBox="0 0 20 20"><rect x="3" y="8" width="14" height="9" fill="none" stroke="currentColor" stroke-width="1.5" stroke-dasharray="3 2"/><line x1="10" y1="2" x2="10" y2="8" stroke="currentColor" stroke-width="1.5"/><polyline points="7,5 10,2 13,5" fill="none" stroke="currentColor" stroke-width="1.5"/></svg></div><span>Add Floor</span><kbd>9</kbd></button>
        </div>
      </div>
      <div class="build-tools-section">
        <label class="menu-label">ROOM STAMPS</label>
        <div class="build-stamps-grid" id="build-stamps"></div>
      </div>
      <div class="build-divider"></div>
      <div class="build-tools-section">
        <label class="menu-label">ACTIONS</label>
        <div class="build-actions-row">
          <button id="build-undo" class="build-action-btn">Undo</button>
          <button id="build-clear" class="build-action-btn build-action-danger">Clear All</button>
        </div>
      </div>
      <div class="build-tools-section">
        <label class="menu-label">SHARE CODE</label>
        <textarea id="build-code" class="build-textarea" rows="2" placeholder="Paste room code..."></textarea>
        <div class="build-actions-row">
          <button id="build-export" class="build-action-btn">Copy Code</button>
          <button id="build-import" class="build-action-btn">Load Code</button>
        </div>
      </div>
      <button id="build-save" class="menu-start-btn build-play-btn">SAVE THIS MAP</button>
      <button id="build-back" class="menu-link-btn" style="width:100%;justify-content:center;">Back to Menu</button>
    </div>
  </div>
</div>

<div id="lobby-screen" style="display:none">
  <div class="menu-content" style="max-width:400px;">
    <h2 class="menu-title" style="font-size:1.2em;margin-bottom:8px;">
      <span class="menu-title-flow">Multiplayer</span>
      <span class="menu-title-kickers">Lobby</span>
    </h2>
    <div class="menu-section">
      <label class="menu-label">Room Code</label>
      <div id="lobby-room-code" style="font-family:var(--mono);font-size:1.8em;letter-spacing:0.15em;color:var(--cream);text-align:center;padding:8px 0;user-select:all;cursor:pointer;" title="Click to copy">----</div>
      <p style="text-align:center;font-size:0.7em;color:var(--muted);margin-top:2px;">Share this code with friends</p>
    </div>
    <div class="menu-section">
      <label class="menu-label">Players</label>
      <div id="lobby-players" style="display:flex;flex-direction:column;gap:6px;"></div>
    </div>
    <div id="lobby-status" style="text-align:center;font-size:0.75em;color:var(--muted);margin:8px 0;">Waiting for players...</div>
    <button id="btn-lobby-start" class="menu-start-btn" style="display:none;">START MISSION</button>
    <div style="display:flex;gap:8px;margin-top:8px;">
      <button id="btn-lobby-leave" class="menu-link-btn" style="flex:1;justify-content:center;">Leave Lobby</button>
    </div>
  </div>
</div>

<div id="save-modal" class="save-modal-overlay" style="display:none">
  <div class="save-modal">
    <h3 class="save-modal-title">Save Map</h3>
    <label class="menu-label" style="width:100%">MAP NAME</label>
    <input id="save-name-input" class="save-name-input" type="text" placeholder="Enter map name..." maxlength="32" autocomplete="off" />
    <div class="save-modal-btns">
      <button id="save-cancel" class="menu-link-btn">Cancel</button>
      <button id="save-confirm" class="menu-start-btn" style="flex:1;">SAVE</button>
    </div>
  </div>
</div>

<div id="game-screen" style="display:none">
  <canvas id="cv"></canvas>
</div>
`;

// ---- Music Widget (global, persists across all screens) ----
const musicBtn = document.createElement('button');
musicBtn.id = 'music-toggle';
musicBtn.className = 'music-toggle-btn';
musicBtn.setAttribute('aria-label', 'Toggle music');
musicBtn.innerHTML = isMuted()
  ? `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>`
  : `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>`;
app.appendChild(musicBtn);

function updateMusicIcon() {
  musicBtn.innerHTML = isMuted()
    ? `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>`
    : `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>`;
}

musicBtn.addEventListener('click', () => {
  toggleMute();
  updateMusicIcon();
});

// Start background music
initMusic();

const canvas = document.getElementById('cv') as HTMLCanvasElement;

function sizeCanvas() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
sizeCanvas();
// resize handled below with buildCv
initInput(canvas);

// Build canvas
const buildCv = document.getElementById('build-cv') as HTMLCanvasElement;
function sizeBuildCanvas() {
  const area = document.querySelector('.build-canvas-area');
  if (!area) return;
  const rect = area.getBoundingClientRect();
  if (rect.width < 1 || rect.height < 1) return;
  buildCv.width = Math.round(rect.width);
  buildCv.height = Math.round(rect.height);
}
sizeBuildCanvas();
window.addEventListener('resize', () => { sizeCanvas(); sizeBuildCanvas(); });

// ---- Multiplayer ----
let netSync: NetworkSync | null = null;

function refreshLobbyUI() {
  const mp = state.multiplayer;
  if (!mp) return;

  // Room code
  const codeEl = document.getElementById('lobby-room-code');
  if (codeEl) {
    codeEl.textContent = mp.roomCode;
    codeEl.onclick = () => {
      navigator.clipboard.writeText(mp.roomCode).catch(() => {});
      codeEl.textContent = 'COPIED!';
      setTimeout(() => { codeEl.textContent = mp.roomCode; }, 1500);
    };
  }

  // Players list
  const playersEl = document.getElementById('lobby-players');
  if (playersEl) {
    playersEl.innerHTML = '';
    for (const p of mp.players) {
      const div = document.createElement('div');
      div.style.cssText = `display:flex;align-items:center;gap:8px;padding:6px 10px;background:rgba(255,255,255,0.04);border-radius:6px;border-left:3px solid ${PLAYER_COLORS[p.colorIndex]};`;
      div.innerHTML = `
        <span style="font-weight:bold;color:${PLAYER_COLORS[p.colorIndex]};">${p.name}</span>
        ${p.id === mp.localPlayerId ? '<span style="font-size:0.7em;color:var(--muted);">(you)</span>' : ''}
        ${!p.connected ? '<span style="font-size:0.7em;color:#cc4433;">(disconnected)</span>' : ''}
      `;
      playersEl.appendChild(div);
    }
    // Empty slots
    for (let i = mp.players.length; i < 4; i++) {
      const div = document.createElement('div');
      div.style.cssText = `display:flex;align-items:center;gap:8px;padding:6px 10px;background:rgba(255,255,255,0.02);border-radius:6px;border-left:3px solid rgba(255,255,255,0.1);opacity:0.4;`;
      div.innerHTML = `<span style="color:var(--muted);font-style:italic;">Waiting for player...</span>`;
      playersEl.appendChild(div);
    }
  }

  // Status text
  const statusEl = document.getElementById('lobby-status');
  if (statusEl) {
    const connected = mp.players.filter(p => p.connected).length;
    if (mp.status === 'connecting') statusEl.textContent = 'Connecting...';
    else if (mp.status === 'error') statusEl.textContent = mp.errorMessage || 'Error';
    else statusEl.textContent = `${connected}/4 players connected`;
    statusEl.style.color = mp.status === 'error' ? '#cc4433' : '';
  }

  // Start button (host only, 2+ players)
  const startBtn = document.getElementById('btn-lobby-start') as HTMLButtonElement;
  if (startBtn) {
    const connected = mp.players.filter(p => p.connected).length;
    if (mp.isHost && connected >= 2) {
      startBtn.style.display = '';
      startBtn.textContent = `START MISSION (${connected} players)`;
    } else {
      startBtn.style.display = 'none';
    }
  }
}

// Multiplayer button handlers (wired after HTML is ready)
document.getElementById('btn-mp-host')!.onclick = async () => {
  sfxClick();
  const nameInput = prompt('Enter your name:', 'Player 1');
  if (!nameInput) return;
  const errorEl = document.getElementById('mp-error')!;
  errorEl.textContent = '';

  try {
    netSync = new NetworkSync(state, nameInput, refreshLobbyUI, () => show('game'));
    setNetSync(netSync);
    const code = await netSync.hostRoom();
    show('lobby');
  } catch (err: any) {
    errorEl.textContent = err.message || 'Failed to host';
  }
};

document.getElementById('btn-mp-join')!.onclick = () => {
  sfxClick();
  const row = document.getElementById('mp-join-row')!;
  row.style.display = row.style.display === 'none' ? 'flex' : 'none';
};

document.getElementById('btn-mp-join-go')!.onclick = async () => {
  sfxConfirm();
  const codeInput = (document.getElementById('mp-join-input') as HTMLInputElement).value.trim().toUpperCase();
  const errorEl = document.getElementById('mp-error')!;
  errorEl.textContent = '';

  if (!codeInput || codeInput.length < 4) { errorEl.textContent = 'Enter a valid room code'; return; }

  const nameInput = prompt('Enter your name:', 'Player');
  if (!nameInput) return;

  try {
    netSync = new NetworkSync(state, nameInput, refreshLobbyUI, () => show('game'));
    setNetSync(netSync);
    await netSync.joinRoom(codeInput);
    show('lobby');
  } catch (err: any) {
    errorEl.textContent = err.message || 'Failed to join';
    if (netSync) { netSync.disconnect(); netSync = null; setNetSync(null); }
  }
};

document.getElementById('mp-join-input')!.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('btn-mp-join-go')!.click();
});

document.getElementById('btn-lobby-start')!.onclick = () => {
  sfxConfirm();
  if (!netSync) return;
  startMission();
  netSync.startGame(selRoom, selOpCount);
};

document.getElementById('btn-lobby-leave')!.onclick = () => {
  sfxBack();
  if (netSync) { netSync.disconnect(); netSync = null; }
  show('menu');
};

document.getElementById('lobby-room-code')!.onclick = () => {
  const mp = state.multiplayer;
  if (mp) {
    navigator.clipboard.writeText(mp.roomCode).catch(() => {});
  }
};

// ---- State ----
let selRoom: RoomTemplateName = 'Corner Fed';
let selOpCount = 7;

const state: GameState = {
  screen: 'menu', mode: 'planning',
  room: cornerFedRoom(),
  operators: [], goCodesTriggered: { A: false, B: false, C: false },
  elapsedTime: 0, selectedOpId: null, playbackSpeed: 1, roomCleared: false,
  interaction: { type: 'idle' }, popup: null,
  camera: { x: 0, y: 0, zoom: 1 },
  isPanning: false, panStart: { x: 0, y: 0 }, panCamStart: { x: 0, y: 0 },
  hoveredHudBtn: null,
  sharePanel: { open: false, exporting: false, exportProgress: 0, gifBlob: null, copiedRoomCode: false },
  hoveredShareBtn: null,
  pendingNode: null,
  speedSlider: null,
  exportingGif: false,
  radialMenu: null,
  stages: [],
  currentStageIndex: 0,
  executingStageIndex: -1,
  isReplaying: false,
  stageJustCompleted: false,
  preGoSnapshot: null,
  viewingStageIndex: -1,
  activeFloor: 0,
  multiplayer: null,
};

// ---- Build state ----
let customRoom: Room = createEmptyRoom();
type BuildToolType = 'line' | 'square' | 'delete' | 'door' | 'threat' | 'object' | 'stairs' | 'eraser' | 'label' | 'room' | 'addfloor';
let buildTool: BuildToolType = 'line';
let buildSelectedStamp: StampName = 'Simple Box';
let buildDragStart: Vec2 | null = null;
let buildDragEnd: Vec2 | null = null;
let buildMousePos: Vec2 = { x: 0, y: 0 };
let buildMouseDown = false;
let buildHoveredWall = -1;
let buildHoveredObject = -1;
let buildHistory: string[] = [];
let buildAnimT = 0;
let buildLastTime = performance.now();
/** Currently active floor level in build mode (0 = ground) */
let buildActiveFloor = 0;

/** Get the data arrays for the currently active build floor */
function getBuildFloorData() {
  if (buildActiveFloor === 0) {
    return { walls: customRoom.walls, threats: customRoom.threats, objects: customRoom.objects, floor: customRoom.floor, floorCut: customRoom.floorCut };
  }
  let fl = customRoom.floors.find(f => f.level === buildActiveFloor);
  if (!fl) {
    // Create floor layer on the fly if somehow missing
    fl = { level: buildActiveFloor, bounds: { x: 0, y: 0, w: 0, h: 0 }, walls: [], threats: [], objects: [], floor: [], floorCut: [] };
    customRoom.floors.push(fl);
  }
  return { walls: fl.walls, threats: fl.threats, objects: fl.objects, floor: fl.floor, floorCut: fl.floorCut };
}

/** Refresh the floor tab UI in build sidebar */
function refreshBuildFloorTabs() {
  const container = document.getElementById('build-floor-tabs');
  if (!container) return;
  container.innerHTML = '';
  const maxLevel = customRoom.floors.length > 0 ? Math.max(...customRoom.floors.map(f => f.level)) : 0;
  for (let i = 0; i <= maxLevel; i++) {
    const tab = document.createElement('button');
    tab.className = 'build-floor-tab' + (i === buildActiveFloor ? ' active' : '');
    tab.textContent = `F${i + 1}`;
    tab.onclick = () => {
      buildActiveFloor = i;
      refreshBuildFloorTabs();
    };
    // Right-click to delete upper floors
    if (i > 0) {
      tab.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        if (confirm(`Delete floor F${i + 1}? This removes all walls, objects, and threats on that floor.`)) {
          pushHistory();
          customRoom.floors = customRoom.floors.filter(f => f.level !== i);
          // Also remove stair connections to this floor
          for (const obj of customRoom.objects) {
            if (obj.type === 'stairs' && obj.connectsFloors) {
              if (obj.connectsFloors[0] === i || obj.connectsFloors[1] === i) {
                obj.connectsFloors = undefined;
              }
            }
          }
          if (buildActiveFloor >= i) buildActiveFloor = Math.max(0, buildActiveFloor - 1);
          refreshBuildFloorTabs();
        }
      });
    }
    container.appendChild(tab);
  }
  // Always show at least F1 even if no upper floors
  if (maxLevel === 0 && container.children.length === 0) {
    const tab = document.createElement('button');
    tab.className = 'build-floor-tab active';
    tab.textContent = 'F1';
    tab.onclick = () => { buildActiveFloor = 0; refreshBuildFloorTabs(); };
    container.appendChild(tab);
  }
}

// Build camera
let buildCam = { x: 400, y: 300, zoom: 1 };
let buildPanning = false;
let buildPanStart: Vec2 = { x: 0, y: 0 };
let buildPanCamStart: Vec2 = { x: 0, y: 0 };

function buildScreenToWorld(sx: number, sy: number): Vec2 {
  const w = buildCv.width, h = buildCv.height;
  return {
    x: (sx - w / 2) / buildCam.zoom + buildCam.x,
    y: (sy - h / 2) / buildCam.zoom + buildCam.y,
  };
}

function pushHistory() {
  buildHistory.push(JSON.stringify({
    w: customRoom.walls, t: customRoom.threats,
    e: customRoom.entryPoints, f: customRoom.floor,
    o: customRoom.objects, fc: customRoom.floorCut, lb: customRoom.labels,
    floors: customRoom.floors,
  }));
  if (buildHistory.length > 50) buildHistory.shift();
}
function undoHistory() {
  if (!buildHistory.length) return;
  const d = JSON.parse(buildHistory.pop()!);
  customRoom.walls = d.w; customRoom.threats = d.t;
  customRoom.entryPoints = d.e; customRoom.floor = d.f;
  customRoom.objects = d.o || []; customRoom.floorCut = d.fc || []; customRoom.labels = d.lb || [];
  customRoom.floors = d.floors || [];
  refreshBuildFloorTabs();
}

// ---- Saved Maps (localStorage) - delegated to game/persistence.ts ----
function saveCurrentMap(name: string) {
  _saveCurrentMap(name, customRoom, refreshCustomMapsUI);
}

function deleteSavedMap(index: number) {
  _deleteSavedMap(index);
  refreshCustomMapsUI();
}

function startSavedMapMission(mapData: SavedMap['data']) {
  state.room = roomFromSavedMap(mapData);
  state.room.floor = computeFloorCells(state.room.walls);
  // Apply floor cuts
  state.room.floor = state.room.floor.filter(c => !state.room.floorCut.some(fc => fc.x === c.x && fc.y === c.y));
  if (!state.room.floors) state.room.floors = [];
  // Recompute upper floor cells
  for (const fl of state.room.floors) {
    if (fl.walls.length >= 3) {
      fl.floor = computeFloorCells(fl.walls).filter(c => !fl.floorCut.some(fc => fc.x === c.x && fc.y === c.y));
    } else if (fl.bounds.w > 0 && fl.bounds.h > 0) {
      const cells: Vec2[] = [];
      for (let cx = fl.bounds.x; cx < fl.bounds.x + fl.bounds.w; cx += GRID) {
        for (let cy = fl.bounds.y; cy < fl.bounds.y + fl.bounds.h; cy += GRID) {
          if (!fl.floorCut.some(fc => fc.x === cx && fc.y === cy)) cells.push({ x: cx, y: cy });
        }
      }
      fl.floor = cells;
    }
  }
  // Doors start closed - operators must open them via waypoint actions
  state.operators = [];
  state.selectedOpId = null;
  state.mode = 'planning';
  state.activeFloor = 0;
  state.elapsedTime = 0;
  state.roomCleared = false;
  state.goCodesTriggered = { A: false, B: false, C: false };
  state.interaction = { type: 'idle' };
  state.popup = null;
  state.radialMenu = null;
  state.pendingNode = null;
  state.speedSlider = null;
  state.stages = [];
  state.currentStageIndex = 0;
  state.executingStageIndex = -1;
  state.isReplaying = false;
  resetOperatorId();
  for (let i = 0; i < selOpCount; i++) {
    state.operators.push(createOperator(i));
  }
  // Center camera on room
  if (state.room.walls.length > 0) {
    let cx = 0, cy = 0, count = 0;
    for (const w of state.room.walls) { cx += w.a.x + w.b.x; cy += w.a.y + w.b.y; count += 2; }
    cx /= count; cy /= count;
    state.camera = { x: cx, y: cy, zoom: 1 };
  } else {
    state.camera = { x: 500, y: 350, zoom: 1 };
  }
  show('game');
}

function refreshCustomMapsUI() {
  const maps = loadSavedMaps();
  const container = document.getElementById('custom-map-btns')!;
  const section = document.getElementById('custom-maps-section')!;
  container.innerHTML = '';

  if (maps.length === 0) {
    section.style.display = 'none';
    return;
  }

  section.style.display = '';
  for (let i = 0; i < maps.length; i++) {
    const map = maps[i];
    const card = document.createElement('div');
    card.className = 'room-card custom-map-card';
    card.innerHTML = `
      <div class="room-card-preview"><svg viewBox="0 0 60 48"><rect x="8" y="6" width="44" height="34" fill="none" stroke="var(--cream)" stroke-width="1.5" opacity=".35"/><text x="30" y="28" text-anchor="middle" fill="var(--cream)" font-size="10" opacity=".4" font-family="var(--mono)">MAP</text></svg></div>
      <span class="room-card-name">${map.name}</span>
      <button class="custom-map-delete" title="Delete map">&times;</button>
    `;
    const playBtn = card;
    playBtn.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).classList.contains('custom-map-delete')) return;
      sfxConfirm();
      startSavedMapMission(map.data);
    });
    card.querySelector('.custom-map-delete')!.addEventListener('click', (e) => {
      e.stopPropagation();
      sfxDelete();
      if (confirm(`Delete "${map.name}"?`)) {
        deleteSavedMap(i);
      }
    });
    container.appendChild(card);
  }
}

// Save modal logic
function openSaveModal() {
  if (customRoom.walls.length < 3) {
    alert('Add some walls before saving!');
    return;
  }
  const modal = document.getElementById('save-modal')!;
  const input = document.getElementById('save-name-input') as HTMLInputElement;
  modal.style.display = 'flex';
  input.value = '';
  input.focus();
}

function closeSaveModal() {
  document.getElementById('save-modal')!.style.display = 'none';
}

function confirmSave() {
  const input = document.getElementById('save-name-input') as HTMLInputElement;
  const name = input.value.trim();
  if (!name) {
    input.classList.add('shake');
    setTimeout(() => input.classList.remove('shake'), 400);
    return;
  }
  saveCurrentMap(name);
  closeSaveModal();
  show('menu');
}

document.getElementById('save-cancel')!.onclick = () => { sfxBack(); closeSaveModal(); };
document.getElementById('save-confirm')!.onclick = () => { sfxConfirm(); confirmSave(); };
document.getElementById('save-name-input')!.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') confirmSave();
  if (e.key === 'Escape') closeSaveModal();
});

// Initialize custom maps UI on load
refreshCustomMapsUI();

// ---- Session Persistence (delegated to game/persistence.ts) ----

function restoreSession(data: SerializedSession) {
  const result = restoreSessionData(state, data);
  selRoom = result.selRoom as RoomTemplateName;
  selOpCount = result.selOpCount;
}

// Auto-save session before page unload (refresh/close)
window.addEventListener('beforeunload', () => {
  saveSessionToStorage(state, selRoom, selOpCount);
});

function resumeInProgressSession(data: SerializedSession) {
  restoreSession(data);
  show('game');
}

function deleteInProgressSession(index: number) {
  _deleteInProgressSession(index);
  refreshInProgressUI();
}

function refreshInProgressUI() {
  const sessions = loadInProgressSessions();
  const container = document.getElementById('in-progress-btns')!;
  const section = document.getElementById('in-progress-section')!;
  container.innerHTML = '';

  if (sessions.length === 0) {
    section.style.display = 'none';
    return;
  }

  section.style.display = '';
  for (let i = 0; i < sessions.length; i++) {
    const session = sessions[i];
    const card = document.createElement('div');
    card.className = 'room-card in-progress-card';
    const timeStr = new Date(session.savedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    card.innerHTML = `
      <div class="room-card-preview"><svg viewBox="0 0 60 48"><rect x="8" y="6" width="44" height="34" fill="none" stroke="#55aa66" stroke-width="1.5" opacity=".5"/><text x="30" y="25" text-anchor="middle" fill="#55aa66" font-size="7" opacity=".6" font-family="var(--mono)">WIP</text><text x="30" y="40" text-anchor="middle" fill="var(--cream)" font-size="5" opacity=".3" font-family="var(--mono)">${timeStr}</text></svg></div>
      <span class="room-card-name">${session.name}</span>
      <button class="custom-map-delete in-progress-delete" title="Delete save">&times;</button>
    `;
    card.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).classList.contains('in-progress-delete')) return;
      sfxConfirm();
      resumeInProgressSession(session.data);
    });
    card.querySelector('.in-progress-delete')!.addEventListener('click', (e) => {
      e.stopPropagation();
      sfxDelete();
      if (confirm(`Delete this save?`)) {
        deleteInProgressSession(i);
      }
    });
    container.appendChild(card);
  }
}

// Initialize in-progress UI on load
refreshInProgressUI();

function snapGrid(v: number) { return Math.round(v / GRID) * GRID; }
function snapVec(p: Vec2): Vec2 { return { x: snapGrid(p.x), y: snapGrid(p.y) }; }

function snapAngle(start: Vec2, end: Vec2): Vec2 {
  const dx = end.x - start.x, dy = end.y - start.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 5) return end;
  const ang = Math.atan2(dy, dx);
  const SNAP = Math.PI / 12; // 15 degrees
  const snapped = Math.round(ang / SNAP) * SNAP;
  return { x: start.x + Math.cos(snapped) * len, y: start.y + Math.sin(snapped) * len };
}

function updateFloor() {
  if (buildActiveFloor === 0) {
    const raw = computeFloorCells(customRoom.walls);
    customRoom.floor = raw.filter(c2 => !customRoom.floorCut.some(fc => fc.x === c2.x && fc.y === c2.y));
  } else {
    const fl = customRoom.floors.find(f => f.level === buildActiveFloor);
    if (fl) {
      // For upper floors, compute floor from the floor layer's own walls
      // If no walls yet, fill the bounds area as floor
      if (fl.walls.length >= 3) {
        const raw = computeFloorCells(fl.walls);
        fl.floor = raw.filter(c2 => !fl.floorCut.some(fc => fc.x === c2.x && fc.y === c2.y));
      } else if (fl.bounds.w > 0 && fl.bounds.h > 0) {
        // No walls yet: fill entire bounds as walkable floor
        const cells: Vec2[] = [];
        for (let cx = fl.bounds.x; cx < fl.bounds.x + fl.bounds.w; cx += GRID) {
          for (let cy = fl.bounds.y; cy < fl.bounds.y + fl.bounds.h; cy += GRID) {
            if (!fl.floorCut.some(fc => fc.x === cx && fc.y === cy)) {
              cells.push({ x: cx, y: cy });
            }
          }
        }
        fl.floor = cells;
      }
    }
  }
}

// computeFloorCells and rayHitsWall moved to game/helpers.ts

// ---- Wall merging: merge collinear overlapping walls into one ----
function mergeWalls() {
  const fd = getBuildFloorData();
  const EPS = 2;
  let merged = true;
  while (merged) {
    merged = false;
    for (let i = 0; i < fd.walls.length && !merged; i++) {
      for (let j = i + 1; j < fd.walls.length && !merged; j++) {
        const a = fd.walls[i], b = fd.walls[j];
        if (a.doors.length > 0 || b.doors.length > 0) continue;
        const m = tryMerge(a, b, EPS);
        if (m) {
          fd.walls[i] = m;
          fd.walls.splice(j, 1);
          merged = true;
        }
      }
    }
  }
}

function tryMerge(
  w1: { a: Vec2; b: Vec2 },
  w2: { a: Vec2; b: Vec2 },
  eps: number,
): ReturnType<typeof makeWall> | null {
  const dx1 = w1.b.x - w1.a.x, dy1 = w1.b.y - w1.a.y;
  const len1 = Math.sqrt(dx1 * dx1 + dy1 * dy1);
  if (len1 < 1) return null;
  const nx = -dy1 / len1, ny = dx1 / len1;
  const d2a = Math.abs((w2.a.x - w1.a.x) * nx + (w2.a.y - w1.a.y) * ny);
  const d2b = Math.abs((w2.b.x - w1.a.x) * nx + (w2.b.y - w1.a.y) * ny);
  if (d2a > eps || d2b > eps) return null;
  const ux = dx1 / len1, uy = dy1 / len1;
  const p = (v: Vec2) => (v.x - w1.a.x) * ux + (v.y - w1.a.y) * uy;
  const t1a = p(w1.a), t1b = p(w1.b);
  const t2a = p(w2.a), t2b = p(w2.b);
  const min1 = Math.min(t1a, t1b), max1 = Math.max(t1a, t1b);
  const min2 = Math.min(t2a, t2b), max2 = Math.max(t2a, t2b);
  if (max1 < min2 - eps || max2 < min1 - eps) return null;
  const minT = Math.min(min1, min2), maxT = Math.max(max1, max2);
  const ax = w1.a.x + ux * minT, ay = w1.a.y + uy * minT;
  const bx = w1.a.x + ux * maxT, by = w1.a.y + uy * maxT;
  return makeWall(Math.round(ax), Math.round(ay), Math.round(bx), Math.round(by));
}

// ---- Door slot helpers ----
const DOOR_SLOT_SPACING = 20;

function getDoorSlots(w: { a: Vec2; b: Vec2 }): number[] {
  const dx = w.b.x - w.a.x, dy = w.b.y - w.a.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < DOOR_W + 10) return [];
  const margin = (DOOR_W / 2 + 4) / len;
  const usable = 1 - 2 * margin;
  if (usable <= 0) return [];
  const count = Math.max(1, Math.floor((usable * len) / DOOR_SLOT_SPACING) + 1);
  const slots: number[] = [];
  if (count === 1) { slots.push(0.5); }
  else { for (let i = 0; i < count; i++) slots.push(margin + (usable * i) / (count - 1)); }
  return slots;
}

let buildHoveredDoorSlot: { wallIdx: number; slotFrac: number } | null = null;

// ---- Menu ----
const ROOM_PREVIEWS: Record<string, string> = {
  'Corner Fed': '<svg viewBox="0 0 60 48"><rect x="6" y="4" width="48" height="36" fill="none" stroke="var(--cream)" stroke-width="1.5" opacity=".45"/><line x1="6" y1="40" x2="22" y2="40" stroke="var(--cream)" stroke-width="1.5" opacity=".2"/><line x1="34" y1="40" x2="54" y2="40" stroke="var(--cream)" stroke-width="1.5" opacity=".2"/><rect x="22" y="38" width="12" height="4" rx="1" fill="var(--cream)" opacity=".5"/></svg>',
  'Center Fed': '<svg viewBox="0 0 60 48"><rect x="4" y="4" width="52" height="36" fill="none" stroke="var(--cream)" stroke-width="1.5" opacity=".45"/><line x1="4" y1="40" x2="24" y2="40" stroke="var(--cream)" stroke-width="1.5" opacity=".2"/><line x1="36" y1="40" x2="56" y2="40" stroke="var(--cream)" stroke-width="1.5" opacity=".2"/><rect x="24" y="38" width="12" height="4" rx="1" fill="var(--cream)" opacity=".5"/></svg>',
  'L-Shape': '<svg viewBox="0 0 60 48"><path d="M4 4h52v20H28v20H4V4z" fill="none" stroke="var(--cream)" stroke-width="1.5" opacity=".45"/><rect x="10" y="42" width="10" height="3" rx="1" fill="var(--cream)" opacity=".5"/></svg>',
  'T-Shape': '<svg viewBox="0 0 60 48"><path d="M4 4h52v16H38v24H22V20H4V4z" fill="none" stroke="var(--cream)" stroke-width="1.5" opacity=".45"/><rect x="26" y="42" width="8" height="3" rx="1" fill="var(--cream)" opacity=".5"/></svg>',
  'Simple Box': '<svg viewBox="0 0 60 48"><rect x="10" y="6" width="40" height="34" fill="none" stroke="var(--cream)" stroke-width="1.5" opacity=".45"/><rect x="24" y="38" width="12" height="3" rx="1" fill="var(--cream)" opacity=".5"/></svg>',
};

const roomBtns = document.getElementById('room-btns')!;
for (const name of Object.keys(ROOM_TEMPLATES)) {
  const b = document.createElement('button');
  b.className = 'room-card';
  b.innerHTML = `<div class="room-card-preview">${ROOM_PREVIEWS[name] || ''}</div><span class="room-card-name">${name}</span>`;
  if (name === selRoom) b.classList.add('sel');
  b.onclick = () => { sfxSelect(); selRoom = name as RoomTemplateName; roomBtns.querySelectorAll('.room-card').forEach(x => x.classList.remove('sel')); b.classList.add('sel'); };
  roomBtns.appendChild(b);
}
// Operator count is always 7 - no selector needed

// Operator count is always 7 for build screen too - no selector needed

document.getElementById('btn-start')!.onclick = () => { sfxConfirm(); startMission(); };
document.getElementById('btn-tut')!.onclick = () => { sfxClick(); tutSlideIdx = 0; updateTutSlides(); show('tut'); };
document.getElementById('btn-tut-back')!.onclick = () => { sfxBack(); show('menu'); };

// ---- Tutorial Slide Deck ----
let tutSlideIdx = 0;
const tutSlidesEl = document.getElementById('tut-slides')!;
const tutSlides = tutSlidesEl.querySelectorAll('.tut-slide');
const tutDotsEl = document.getElementById('tut-dots')!;
const tutTotal = tutSlides.length;

for (let i = 0; i < tutTotal; i++) {
  const dot = document.createElement('button');
  dot.className = 'tut-dot';
  if (i === 0) dot.classList.add('active');
  dot.onclick = () => { sfxTick(); tutSlideIdx = i; updateTutSlides(); };
  tutDotsEl.appendChild(dot);
}

function updateTutSlides() {
  tutSlidesEl.style.transform = `translateX(-${tutSlideIdx * 100}%)`;
  tutDotsEl.querySelectorAll('.tut-dot').forEach((d, i) => {
    d.classList.toggle('active', i === tutSlideIdx);
  });
  (document.getElementById('tut-prev') as HTMLButtonElement).disabled = tutSlideIdx === 0;
  (document.getElementById('tut-next') as HTMLButtonElement).disabled = tutSlideIdx === tutTotal - 1;
}

document.getElementById('tut-prev')!.onclick = () => { if (tutSlideIdx > 0) { sfxTick(); tutSlideIdx--; updateTutSlides(); } };
document.getElementById('tut-next')!.onclick = () => { if (tutSlideIdx < tutTotal - 1) { sfxTick(); tutSlideIdx++; updateTutSlides(); } };

// Swipe support
let tutTouchX = 0;
document.getElementById('tut-screen')!.addEventListener('touchstart', (e) => { tutTouchX = e.touches[0].clientX; }, { passive: true });
document.getElementById('tut-screen')!.addEventListener('touchend', (e) => {
  const dx = e.changedTouches[0].clientX - tutTouchX;
  if (dx > 50 && tutSlideIdx > 0) { tutSlideIdx--; updateTutSlides(); }
  else if (dx < -50 && tutSlideIdx < tutTotal - 1) { tutSlideIdx++; updateTutSlides(); }
}, { passive: true });

// Arrow keys on tutorial screen
window.addEventListener('keydown', (e) => {
  if (document.getElementById('tut-screen')!.style.display === 'none') return;
  if (e.key === 'ArrowLeft' && tutSlideIdx > 0) { tutSlideIdx--; updateTutSlides(); }
  if (e.key === 'ArrowRight' && tutSlideIdx < tutTotal - 1) { tutSlideIdx++; updateTutSlides(); }
  if (e.key === 'Escape') show('menu');
});

updateTutSlides();

// Load room from code input on menu
document.getElementById('btn-load-code')!.onclick = () => {
  const input = document.getElementById('menu-code-input') as HTMLInputElement;
  const errorEl = document.getElementById('menu-code-error')!;
  const code = input.value.trim();
  errorEl.textContent = '';
  if (!code) { errorEl.textContent = 'Paste a room code first'; return; }
  try {
    const d = decodeRoomCode(code);
    sfxConfirm();
    // Auto-save as a custom map so it appears under "Your Custom Maps"
    saveImportedMap(d);
    startSavedMapMission(d);
    input.value = '';
  } catch {
    errorEl.textContent = 'Invalid room code';
  }
};
// Also allow Enter key in the code input
document.getElementById('menu-code-input')!.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('btn-load-code')!.click();
});
document.getElementById('btn-build')!.onclick = () => {
  sfxClick();
  customRoom = createEmptyRoom();
  buildHistory = [];
  show('build');
};
document.getElementById('build-back')!.onclick = () => { sfxBack(); show('menu'); };
document.getElementById('build-save')!.onclick = () => { sfxClick(); openSaveModal(); };
document.getElementById('build-undo')!.onclick = () => { sfxClick(); undoHistory(); };
document.getElementById('build-clear')!.onclick = () => { sfxDelete(); pushHistory(); customRoom = createEmptyRoom(); };

// Build tools
document.querySelectorAll('.build-tool').forEach(btn => {
  btn.addEventListener('click', () => {
    sfxSelect();
    buildTool = (btn as HTMLElement).dataset.tool as BuildToolType;
    document.querySelectorAll('.build-tool').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.build-stamp-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  });
});

// Stamp template buttons
const stampsEl = document.getElementById('build-stamps')!;
const STAMP_SVG: Record<string, string> = {
  'Simple Box': '<svg viewBox="0 0 32 24"><rect x="2" y="2" width="28" height="20" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>',
  'Corner Fed': '<svg viewBox="0 0 32 24"><rect x="2" y="2" width="28" height="20" fill="none" stroke="currentColor" stroke-width="1.5" opacity=".5"/><line x1="2" y1="22" x2="9" y2="22" stroke="currentColor" stroke-width="1.5"/><line x1="15" y1="22" x2="30" y2="22" stroke="currentColor" stroke-width="1.5"/></svg>',
  'Center Fed': '<svg viewBox="0 0 32 24"><rect x="2" y="2" width="28" height="20" fill="none" stroke="currentColor" stroke-width="1.5" opacity=".5"/><line x1="2" y1="22" x2="12" y2="22" stroke="currentColor" stroke-width="1.5"/><line x1="20" y1="22" x2="30" y2="22" stroke="currentColor" stroke-width="1.5"/></svg>',
  'L-Shape': '<svg viewBox="0 0 32 24"><path d="M2 2h28v10H18v10H2V2z" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>',
  'T-Shape': '<svg viewBox="0 0 32 24"><path d="M2 2h28v8H22v12H10V10H2V2z" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>',
};
for (const name of STAMP_NAMES) {
  const btn = document.createElement('button');
  btn.className = 'build-stamp-btn';
  btn.innerHTML = `<div class="build-stamp-icon">${STAMP_SVG[name] || ''}</div><span>${name}</span>`;
  btn.onclick = () => {
    sfxSelect();
    buildTool = 'room';
    buildSelectedStamp = name;
    document.querySelectorAll('.build-tool').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.build-stamp-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  };
  stampsEl.appendChild(btn);
}

// Initialize floor tabs
refreshBuildFloorTabs();

// Share codes
document.getElementById('build-export')!.onclick = () => {
  sfxConfirm();
  const code = encodeRoomCode(customRoom);
  (document.getElementById('build-code') as HTMLTextAreaElement).value = code;
  navigator.clipboard.writeText(code).catch(() => {});
};
document.getElementById('build-import')!.onclick = () => {
  sfxClick();
  try {
    const d = decodeRoomCode((document.getElementById('build-code') as HTMLTextAreaElement).value);
    pushHistory();
    customRoom.walls = (d.w || []).map((w: any[]) => {
      const wall = makeWall(w[0], w[1], w[2], w[3]);
      if (Array.isArray(w[4])) {
        wall.doors = w[4].map((dd: any) => ({ pos: dd[0], open: dd[1] === 1 }));
      } else if (w[4] > 0) {
        wall.doors = [{ pos: w[5] ?? 0.5, open: w[4] === 1 }];
      }
      return wall;
    });
    customRoom.threats = (d.t || []).map((t: number[]) => makeThreat(t[0], t[1]));
    customRoom.entryPoints = (d.e || []).map((e: number[]) => ({ x: e[0], y: e[1] }));
    customRoom.floor = (d.f || []).map((p: number[]) => ({ x: p[0], y: p[1] }));
    customRoom.objects = ((d as any).o || []).map((o: any) => {
      const obj: import('./types').RoomObject = { x: o[0] ?? o.x, y: o[1] ?? o.y, w: o[2] ?? o.w, h: o[3] ?? o.h, type: o[4] ?? o.type ?? 'block' };
      if (o[5]) obj.connectsFloors = o[5];
      return obj;
    });
    customRoom.floorCut = ((d as any).fc || []).map((p: any) => ({ x: p[0] ?? p.x, y: p[1] ?? p.y }));
    // Import floor layers
    customRoom.floors = ((d as any).floors || []).map((fl: any) => ({
      level: fl.level,
      bounds: fl.bounds,
      walls: (fl.w || []).map((w: any[]) => {
        const wall = makeWall(w[0], w[1], w[2], w[3]);
        if (Array.isArray(w[4])) wall.doors = w[4].map((dd: any) => ({ pos: dd[0], open: dd[1] === 1 }));
        return wall;
      }),
      threats: (fl.t || []).map((t: number[]) => makeThreat(t[0], t[1])),
      objects: (fl.o || []).map((o: any) => {
        const obj: import('./types').RoomObject = { x: o[0] ?? o.x, y: o[1] ?? o.y, w: o[2] ?? o.w, h: o[3] ?? o.h, type: o[4] ?? o.type ?? 'block' };
        if (o[5]) obj.connectsFloors = o[5];
        return obj;
      }),
      floor: [],
      floorCut: (fl.fc || []).map((p: any) => ({ x: p[0] ?? p.x, y: p[1] ?? p.y })),
    }));
    buildActiveFloor = 0;
    refreshBuildFloorTabs();
  } catch { alert('Invalid room code'); }
};

function show(s: 'menu' | 'tut' | 'build' | 'game' | 'lobby') {
  const screens: Record<string, HTMLElement> = {
    menu: document.getElementById('menu-screen')!,
    tut: document.getElementById('tut-screen')!,
    build: document.getElementById('build-screen')!,
    game: document.getElementById('game-screen')!,
    lobby: document.getElementById('lobby-screen')!,
  };

  // For each screen: if it's the target, make sure it's visible first then fade in
  // If it's not the target, fade out then hide
  for (const [key, el] of Object.entries(screens)) {
    if (key === s) {
      // Show this screen
      el.style.display = 'flex';
      // Force reflow before removing hidden class for transition
      el.offsetHeight;
      el.classList.remove('screen-hidden');
      el.style.opacity = '1';
      el.style.transform = 'none';
    } else {
      // Hide this screen instantly (no lingering)
      el.style.display = 'none';
      el.classList.add('screen-hidden');
    }
  }

  state.screen = s === 'game' ? 'game' : 'menu';
  if (s === 'game') {
    requestAnimationFrame(() => sizeCanvas());
  }
  if (s === 'build') {
    requestAnimationFrame(() => sizeBuildCanvas());
  }
  if (s === 'lobby') {
    refreshLobbyUI();
  }
  // Clear session storage when intentionally going back to menu
  if (s === 'menu') {
    clearSessionStorage();
    refreshInProgressUI();
    // Disconnect from any multiplayer session
    if (netSync) { netSync.disconnect(); netSync = null; setNetSync(null); }
  }
  // Re-trigger entrance animation for menu-content when coming back to menu
  if (s === 'menu' || s === 'tut') {
    const content = screens[s].querySelector('.menu-content');
    if (content) {
      content.classList.remove('animate-enter');
      void (content as HTMLElement).offsetHeight;
      content.classList.add('animate-enter');
    }
  }
}

function startMission() {
  state.room = (ROOM_TEMPLATES as Record<string, () => Room>)[selRoom]();
  state.room.floor = computeFloorCells(state.room.walls);
  if (!state.room.floors) state.room.floors = [];
  // Doors start closed - operators must open them via waypoint actions
  state.operators = [];
  state.selectedOpId = null;
  state.mode = 'planning';
  state.activeFloor = 0;
  state.elapsedTime = 0;
  state.roomCleared = false;
  state.goCodesTriggered = { A: false, B: false, C: false };
  state.interaction = { type: 'idle' };
  state.popup = null;
  state.radialMenu = null;
  state.pendingNode = null;
  state.speedSlider = null;
  state.stages = [];
  state.currentStageIndex = 0;
  state.executingStageIndex = -1;
  state.isReplaying = false;
  resetOperatorId();
  for (let i = 0; i < selOpCount; i++) {
    state.operators.push(createOperator(i));
  }
  // Center camera on room
  if (state.room.walls.length > 0) {
    let cx = 0, cy = 0, count = 0;
    for (const w of state.room.walls) { cx += w.a.x + w.b.x; cy += w.a.y + w.b.y; count += 2; }
    cx /= count; cy /= count;
    state.camera = { x: cx, y: cy, zoom: 1 };
  } else {
    state.camera = { x: 500, y: 350, zoom: 1 };
  }
  show('game');
}

// startCustomMission removed - saved maps now launch through menu via startSavedMapMission

// ---- Keyboard ----
window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLTextAreaElement) return;

  // Build screen shortcuts
  if (document.getElementById('build-screen')!.style.display !== 'none') {
    if (e.key === 'z' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); undoHistory(); return; }
    const toolKeys: Record<string, BuildToolType> = { '1': 'line', '2': 'square', '3': 'delete', '4': 'door', '5': 'object', '6': 'stairs', '7': 'threat', '8': 'eraser', '9': 'addfloor' };
    if (toolKeys[e.key]) {
      buildTool = toolKeys[e.key];
      document.querySelectorAll('.build-tool').forEach(b => b.classList.remove('active'));
      document.querySelector(`.build-tool[data-tool="${buildTool}"]`)?.classList.add('active');
      return;
    }
    if (e.key === 'Escape') { show('menu'); return; }
    return;
  }

  if (state.screen !== 'game') return;

  // Delegate to extracted game keyboard handler (has multiplayer sync)
  const result = handleGameKeydown(e, state);
  if (result === 'menu') show('menu');
});

/** Edit a previously saved stage: reset to its start, delete it and all future stages */
function editStage() {
  const idx = state.viewingStageIndex;
  if (idx < 0 || idx >= state.stages.length) return;
  if (state.mode !== 'planning') return;

  const targetStage = state.stages[idx];

  // Restore operators to the START positions of the selected stage
  for (const snap of targetStage.operatorStates) {
    const op = state.operators.find(o => o.id === snap.opId);
    if (!op) continue;
    op.position = { x: snap.startPosition.x, y: snap.startPosition.y };
    op.startPosition = { x: snap.startPosition.x, y: snap.startPosition.y };
    op.angle = snap.startAngle;
    op.startAngle = snap.startAngle;
    op.path.waypoints = [];
    op.path.splineLUT = null;
    op.pieTarget = null;
    op.distanceTraveled = 0;
    op.currentWaypointIndex = 0;
    op.isHolding = false;
    op.isMoving = false;
    op.reachedEnd = false;
    if (op.smoothPosition) op.smoothPosition = { x: op.position.x, y: op.position.y };
  }

  // Delete this stage and all future stages
  state.stages.splice(idx);
  state.currentStageIndex = state.stages.length;
  state.viewingStageIndex = -1;
  state.preGoSnapshot = null;
  state.executingStageIndex = -1;
  state.isReplaying = false;
  state.stageJustCompleted = false;

  // Clean up UI
  state.popup = null;
  state.radialMenu = null;
  state.pendingNode = null;
  state.speedSlider = null;
  state.selectedOpId = null;
  state.interaction = { type: 'idle' };
}

/** Save current paths as a stage, then prepare for next stage planning */
function saveStage() {
  // Case 1: After execution just completed (stageJustCompleted glow prompt)
  // The stage was already auto-saved by doGo. Just transition to planning
  // with operators at their current (end-of-route) positions, paths cleared.
  if (state.stageJustCompleted) {
    state.stageJustCompleted = false;
    state.preGoSnapshot = null; // can't undo past this point
    state.mode = 'planning';
    state.currentStageIndex = state.stages.length;
    state.executingStageIndex = -1;
    // Operators are already at end positions from execution.
    // Clear their paths, pie widgets, and reset movement state for next stage planning.
    for (const op of state.operators) {
      if (!op.deployed) continue;
      op.startPosition = { x: op.position.x, y: op.position.y };
      op.startAngle = op.angle;
      op.path.waypoints = [];
      op.path.splineLUT = null;
      op.pieTarget = null;
      op.distanceTraveled = 0;
      op.currentWaypointIndex = 0;
      op.isHolding = false;
      op.isMoving = false;
      op.reachedEnd = false;
    }
    state.popup = null;
    state.radialMenu = null;
    state.pendingNode = null;
    state.speedSlider = null;
    state.selectedOpId = null;
    state.interaction = { type: 'idle' };
    return;
  }

  // Case 2: Normal save during planning - snapshot current paths as a stage
  if (state.mode !== 'planning') return;
  const deployed = state.operators.filter(o => o.deployed);
  if (deployed.length === 0) return;
  if (!deployed.some(o => o.path.waypoints.length >= 2)) return;

  // Bake pie directions into waypoints before snapshotting
  for (const op of deployed) bakePieDirection(op);

  const stage: import('./types').Stage = {
    operatorStates: deployed.map(op => ({
      opId: op.id,
      startPosition: { x: op.position.x, y: op.position.y },
      startAngle: op.angle,
      waypoints: JSON.parse(JSON.stringify(op.path.waypoints)),
      tempo: op.tempo,
      pieTarget: op.pieTarget ? { x: op.pieTarget.x, y: op.pieTarget.y } : null,
      startFloor: op.currentFloor,
    })),
  };
  state.stages.push(stage);
  state.currentStageIndex = state.stages.length;

  // Move operators to where their paths end (start of next stage)
  for (const op of deployed) {
    if (op.path.waypoints.length >= 2) {
      const lastWp = op.path.waypoints[op.path.waypoints.length - 1];
      const endPos = { x: lastWp.position.x, y: lastWp.position.y };
      op.position = { x: endPos.x, y: endPos.y };
      op.startPosition = { x: endPos.x, y: endPos.y };
      // Update floor to last waypoint's floor
      op.currentFloor = lastWp.floorLevel;
      op.startFloor = lastWp.floorLevel;
      // Compute end angle: explicit facingOverride > pie target > keep current
      if (lastWp.facingOverride !== null) {
        op.angle = lastWp.facingOverride;
      } else if (op.pieTarget) {
        const dx = op.pieTarget.x - endPos.x, dy = op.pieTarget.y - endPos.y;
        if (dx * dx + dy * dy > 1) op.angle = Math.atan2(dy, dx);
      }
      op.startAngle = op.angle;
    }
    // Clear paths and pie for next stage planning
    op.path.waypoints = [];
    op.path.splineLUT = null;
    op.pieTarget = null;
  }

  state.popup = null;
  state.radialMenu = null;
  state.pendingNode = null;
  state.speedSlider = null;
  state.selectedOpId = null;
  state.interaction = { type: 'idle' };
}

/** Execute: save current paths as a temporary stage, snapshot pre-GO state, then run all stages */
function doGo() {
  if (state.mode !== 'planning') return;
  const deployed = state.operators.filter(o => o.deployed);
  if (deployed.length === 0) return;
  if (!deployed.some(o => o.path.waypoints.length >= 2) && state.stages.length === 0) return;

  // Bake pie directions into waypoints before snapshotting
  for (const op of deployed) bakePieDirection(op);

  // Save pre-GO snapshot so RESET can return to this exact state
  state.preGoSnapshot = {
    operatorStates: deployed.map(op => ({
      opId: op.id,
      startPosition: { x: op.position.x, y: op.position.y },
      startAngle: op.angle,
      waypoints: JSON.parse(JSON.stringify(op.path.waypoints)),
      tempo: op.tempo,
      pieTarget: op.pieTarget ? { x: op.pieTarget.x, y: op.pieTarget.y } : null,
      startFloor: op.currentFloor,
    })),
  };

  // Auto-save current paths as a stage if there are any
  if (deployed.some(o => o.path.waypoints.length >= 2)) {
    const stage: import('./types').Stage = {
      operatorStates: deployed.map(op => ({
        opId: op.id,
        startPosition: { x: op.position.x, y: op.position.y },
        startAngle: op.angle,
        waypoints: JSON.parse(JSON.stringify(op.path.waypoints)),
        tempo: op.tempo,
        pieTarget: op.pieTarget ? { x: op.pieTarget.x, y: op.pieTarget.y } : null,
        startFloor: op.currentFloor,
      })),
    };
    state.stages.push(stage);
  }

  if (state.stages.length === 0) return;

  state.popup = null;
  state.radialMenu = null;
  state.pendingNode = null;
  state.speedSlider = null;
  state.interaction = { type: 'idle' };
  state.stageJustCompleted = false;
  state.viewingStageIndex = -1;

  // Start executing from stage 0
  state.executingStageIndex = 0;
  state.isReplaying = false;
  loadAndExecuteStage(0);
}

/** Load a stage's paths onto operators and start executing */
function loadAndExecuteStage(stageIdx: number) {
  const stage = state.stages[stageIdx];
  if (!stage) return;

  state.executingStageIndex = stageIdx;
  state.elapsedTime = 0;
  state.goCodesTriggered = { A: false, B: false, C: false };

  // Restore operator positions, paths, and pieTarget from this stage
  for (const op of state.operators) {
    if (!op.deployed) continue;
    const snap = stage.operatorStates.find(s => s.opId === op.id);
    if (snap) {
      op.position = { x: snap.startPosition.x, y: snap.startPosition.y };
      op.startPosition = { x: snap.startPosition.x, y: snap.startPosition.y };
      op.angle = snap.startAngle;
      op.startAngle = snap.startAngle;
      op.path.waypoints = JSON.parse(JSON.stringify(snap.waypoints));
      op.tempo = snap.tempo;
      op.pieTarget = snap.pieTarget ? { x: snap.pieTarget.x, y: snap.pieTarget.y } : null;
      op.currentFloor = snap.startFloor ?? 0;
      op.startFloor = snap.startFloor ?? 0;
    } else {
      // Operator not in this stage - clear its path but keep position
      op.path.waypoints = [];
      op.path.splineLUT = null;
      op.pieTarget = null;
    }
    op.distanceTraveled = 0;
    op.currentWaypointIndex = 0;
    op.isHolding = false;
    op.isMoving = false;
    op.reachedEnd = false;
    if (op.smoothPosition) op.smoothPosition = { x: op.position.x, y: op.position.y };
    rebuildPathLUT(op);
  }

  state.mode = 'executing';
  state.goCodesTriggered.A = true;
}

/** Check if current stage is done and advance to next */
function checkStageCompletion() {
  if (state.mode !== 'executing' || state.executingStageIndex < 0) return;
  const allDone = state.operators.every(
    o => !o.deployed || o.reachedEnd || o.path.waypoints.length === 0
  );
  if (!allDone) return;

  const nextStage = state.executingStageIndex + 1;
  if (nextStage < state.stages.length) {
    // Capture current angles before loading next stage (for smooth transitions)
    const endAngles: Record<number, number> = {};
    for (const op of state.operators) {
      if (op.deployed) endAngles[op.id] = op.angle;
    }
    // Advance to next stage
    loadAndExecuteStage(nextStage);
    // Use execution end-angles for operators so transitions are seamless
    for (const op of state.operators) {
      if (op.deployed && endAngles[op.id] !== undefined) {
        op.angle = endAngles[op.id];
      }
    }
  } else {
    // All stages done - pause and prompt to save stage
    state.mode = 'paused';
    state.stageJustCompleted = true;
  }
}

/** Reset all threats across all floors */
function resetAllThreats() {
  for (const t of state.room.threats) { t.neutralized = false; t.neutralizeTimer = 0; }
  if (state.room.floors) {
    for (const fl of state.room.floors) {
      for (const t of fl.threats) { t.neutralized = false; t.neutralizeTimer = 0; }
    }
  }
}

/** Replay all stages from the beginning */
function doReplay() {
  if (state.stages.length === 0) return;
  state.isReplaying = true;
  state.roomCleared = false;
  resetAllThreats();
  loadAndExecuteStage(0);
}

/** Reset returns to pre-GO state with routes intact (if GO was pressed),
 *  or to initial state if no GO snapshot exists */
function doReset() {
  state.mode = 'planning';
  state.elapsedTime = 0;
  state.roomCleared = false;
  state.goCodesTriggered = { A: false, B: false, C: false };
  state.popup = null;
  state.radialMenu = null;
  state.pendingNode = null;
  state.speedSlider = null;
  state.interaction = { type: 'idle' };
  state.executingStageIndex = -1;
  state.isReplaying = false;
  state.stageJustCompleted = false;

  if (state.preGoSnapshot) {
    // Pop the auto-saved stage that doGo added
    state.stages.pop();
    state.currentStageIndex = state.stages.length;

    // Restore operator positions, paths, and pieTarget from pre-GO snapshot
    for (const snap of state.preGoSnapshot.operatorStates) {
      const op = state.operators.find(o => o.id === snap.opId);
      if (!op) continue;
      op.position = { x: snap.startPosition.x, y: snap.startPosition.y };
      op.startPosition = { x: snap.startPosition.x, y: snap.startPosition.y };
      op.angle = snap.startAngle;
      op.startAngle = snap.startAngle;
      op.path.waypoints = JSON.parse(JSON.stringify(snap.waypoints));
      op.tempo = snap.tempo;
      op.pieTarget = snap.pieTarget ? { x: snap.pieTarget.x, y: snap.pieTarget.y } : null;
      op.currentFloor = snap.startFloor ?? 0;
      op.startFloor = snap.startFloor ?? 0;
      op.distanceTraveled = 0;
      op.currentWaypointIndex = 0;
      op.isHolding = false;
      op.isMoving = false;
      op.reachedEnd = false;
      if (op.smoothPosition) op.smoothPosition = { x: op.position.x, y: op.position.y };
      rebuildPathLUT(op);
    }
    state.preGoSnapshot = null;
  } else {
    // No snapshot - full reset
    for (const op of state.operators) {
      if (op.deployed) resetOperator(op);
      op.pieTarget = null;
      op.path.waypoints = [];
      op.path.splineLUT = null;
      op.distanceTraveled = 0;
      op.currentWaypointIndex = 0;
      op.isHolding = false;
      op.isMoving = false;
      op.reachedEnd = false;
    }
    state.stages = [];
    state.currentStageIndex = 0;
  }
  resetAllThreats();
}

/** Clear everything - operators, paths, stages, back to fresh deployment */
function doClearLevel() {
  state.mode = 'planning';
  state.elapsedTime = 0;
  state.roomCleared = false;
  state.goCodesTriggered = { A: false, B: false, C: false };
  state.popup = null;
  state.radialMenu = null;
  state.pendingNode = null;
  state.speedSlider = null;
  state.interaction = { type: 'idle' };
  state.executingStageIndex = -1;
  state.isReplaying = false;
  state.stageJustCompleted = false;
  state.preGoSnapshot = null;
  state.viewingStageIndex = -1;
  state.stages = [];
  state.currentStageIndex = 0;
  state.selectedOpId = null;
  // Undeploy all operators
  for (const op of state.operators) {
    op.deployed = false;
    op.position = { x: 0, y: 0 };
    op.startPosition = { x: 0, y: 0 };
    op.angle = 0;
    op.startAngle = 0;
    op.path.waypoints = [];
    op.path.splineLUT = null;
    op.pieTarget = null;
    op.distanceTraveled = 0;
    op.currentWaypointIndex = 0;
    op.isHolding = false;
    op.isMoving = false;
    op.reachedEnd = false;
  }
  resetAllThreats();
}

function deleteSelected() {
  if (!state.popup || state.popup.wpIdx < 0) return;
  const op = state.operators.find(o => o.id === state.popup!.opId);
  if (!op || op.path.waypoints.length <= 2) return;
  op.path.waypoints.splice(state.popup.wpIdx, 1);
  rebuildPathLUT(op);
  state.popup = null;
}

function openSharePanel() {
  state.sharePanel = { open: true, exporting: false, exportProgress: 0, gifBlob: null, copiedRoomCode: false };
  state.hoveredShareBtn = null;
  if (state.mode === 'executing') state.mode = 'paused';
  // Reset share panel animation (renderer reads this)
  resetSharePanelAnim();
}

function closeSharePanel() {
  state.sharePanel.open = false;
  state.hoveredShareBtn = null;
}

// Visual confirmation overlay for save progress
let saveConfirmTimer = 0;
function showSaveConfirmation() {
  saveConfirmTimer = 90; // ~1.5 seconds at 60fps
}

async function doExportGif() {
  if (state.stages.length === 0) return;
  state.sharePanel.exporting = true;
  state.sharePanel.exportProgress = 0;
  state.sharePanel.gifBlob = null;
  try {
    const blob = await exportGIF(state, (p) => { state.sharePanel.exportProgress = p; });
    state.sharePanel.gifBlob = blob;
  } catch (err) {
    console.error(err);
    state.exportingGif = false;
  }
  state.sharePanel.exporting = false;
  doReset();
}

function downloadShareGif() {
  if (state.sharePanel.gifBlob) {
    downloadBlob(state.sharePanel.gifBlob, `flow-kickers-${Date.now()}.gif`);
  }
}

function getRoomShareCode(): string {
  return encodeRoomCode(state.room);
}

function copyRoomCode() {
  const code = getRoomShareCode();
  navigator.clipboard.writeText(code).then(() => {
    state.sharePanel.copiedRoomCode = true;
    setTimeout(() => { state.sharePanel.copiedRoomCode = false; }, 2000);
  }).catch(() => {});
}

// ---- Camera ----
/** Convert screen-space mouse pos to world-space (accounting for camera pan/zoom) */
function screenToWorld(screenPos: Vec2): Vec2 {
  const cam = state.camera;
  return {
    x: (screenPos.x - canvas.width / 2) / cam.zoom + cam.x,
    y: (screenPos.y - canvas.height / 2) / cam.zoom + cam.y,
  };
}

function handleCamera() {
  const input = getInput();

  // Scroll wheel zoom
  if (input.scrollDelta !== 0) {
    const zoomFactor = 1 + input.scrollDelta * 0.001;
    const oldZoom = state.camera.zoom;
    state.camera.zoom = Math.max(0.3, Math.min(3, oldZoom * zoomFactor));
    // Zoom toward mouse position
    const mouseWorld = screenToWorld(input.mousePos);
    state.camera.x += (mouseWorld.x - state.camera.x) * (1 - oldZoom / state.camera.zoom) * 0.3;
    state.camera.y += (mouseWorld.y - state.camera.y) * (1 - oldZoom / state.camera.zoom) * 0.3;
  }

  // Right-click pan (when not doing anything else)
  if (state.isPanning && input.rightMouseDown) {
    const dx = (input.mousePos.x - state.panStart.x) / state.camera.zoom;
    const dy = (input.mousePos.y - state.panStart.y) / state.camera.zoom;
    state.camera.x = state.panCamStart.x - dx;
    state.camera.y = state.panCamStart.y - dy;
  }
  if (state.isPanning && input.rightJustReleased) {
    state.isPanning = false;
  }
  // Also support middle-click pan as fallback
  if (input.middleJustPressed) {
    state.isPanning = true;
    state.panStart = { x: input.mousePos.x, y: input.mousePos.y };
    state.panCamStart = { x: state.camera.x, y: state.camera.y };
  }
  if (state.isPanning && input.middleMouseDown) {
    const dx = (input.mousePos.x - state.panStart.x) / state.camera.zoom;
    const dy = (input.mousePos.y - state.panStart.y) / state.camera.zoom;
    state.camera.x = state.panCamStart.x - dx;
    state.camera.y = state.panCamStart.y - dy;
  }
  if (input.middleJustReleased) {
    state.isPanning = false;
  }
}

function hitBtn(mouse: Vec2, x: number, y: number, w: number, h: number): boolean {
  return mouse.x >= x && mouse.x <= x + w && mouse.y >= y && mouse.y <= y + h;
}

// bakePieDirection moved to game/radialMenu.ts

// ---- Radial Menu Definitions ----
const RADIAL_R = 28; // radius of icon ring around center (world-space)
const RADIAL_ICON_R = 10; // radius of each icon hit area (world-space)

const OP_RADIAL_ITEMS: RadialMenuItem[] = [
  { id: 'direction', icon: 'direction', label: 'Direction' },
  { id: 'pie',       icon: 'pie',       label: 'Pie' },
  { id: 'route',     icon: 'route',     label: 'Route' },
  { id: 'speed',     icon: 'speed',     label: 'Speed' },
];

const NODE_RADIAL_ITEMS: RadialMenuItem[] = [
  { id: 'direction', icon: 'direction', label: 'Direction' },
  { id: 'route',     icon: 'route',     label: 'Add Route' },
  { id: 'delete',    icon: 'delete',    label: 'Delete' },
  { id: 'speed',     icon: 'speed',     label: 'Speed' },
  { id: 'hold',      icon: 'hold',      label: 'Hold' },
];

function getRadialItems(wpIdx: number, opId?: number): RadialMenuItem[] {
  if (wpIdx < 0) return OP_RADIAL_ITEMS;
  // Check if this waypoint is near any closed door
  const op = state.operators.find(o => o.id === opId);
  if (op && wpIdx < op.path.waypoints.length) {
    const wp = op.path.waypoints[wpIdx];
    const nearDoors = findDoorsNear(wp.position, DOOR_W * 2);
    if (nearDoors.length > 0) {
      const hasDoorAction = wp.openDoors && wp.openDoors.length > 0;
      return [
        ...NODE_RADIAL_ITEMS,
        { id: 'door', icon: 'door', label: hasDoorAction ? 'Cancel Door' : 'Open Door' },
      ];
    }
  }
  return NODE_RADIAL_ITEMS;
}

/** Find all doors within radius of a world position */
function findDoorsNear(pos: { x: number; y: number }, radius: number): { wallIdx: number; doorIdx: number; dist: number }[] {
  const results: { wallIdx: number; doorIdx: number; dist: number }[] = [];
  for (let wi = 0; wi < state.room.walls.length; wi++) {
    const w = state.room.walls[wi];
    const dx = w.b.x - w.a.x, dy = w.b.y - w.a.y;
    for (let di = 0; di < w.doors.length; di++) {
      const d = w.doors[di];
      const doorX = w.a.x + dx * d.pos;
      const doorY = w.a.y + dy * d.pos;
      const dist = Math.sqrt((pos.x - doorX) ** 2 + (pos.y - doorY) ** 2);
      if (dist < radius) results.push({ wallIdx: wi, doorIdx: di, dist });
    }
  }
  results.sort((a, b) => a.dist - b.dist);
  return results;
}

/** Get world-space position of a radial menu icon */
function getRadialIconPos(center: Vec2, idx: number, total: number): Vec2 {
  const a = -Math.PI / 2 + (idx / total) * Math.PI * 2;
  return { x: center.x + Math.cos(a) * RADIAL_R, y: center.y + Math.sin(a) * RADIAL_R };
}

/** Hit-test radial menu icons in world-space, return index or -1 */
function hitTestRadialMenu(worldMouse: Vec2, menu: RadialMenu): number {
  const items = getRadialItems(menu.wpIdx, menu.opId);
  for (let i = 0; i < items.length; i++) {
    const p = getRadialIconPos(menu.center, i, items.length);
    if (distance(worldMouse, p) < RADIAL_ICON_R + 2) return i;
  }
  return -1;
}

// ---- Input ----
function handleInput() {
  const input = getInput();
  if (state.screen !== 'game') return;

  // Camera always updates (even during execution)
  handleCamera();

  // Get world-space mouse position for all game interactions
  const worldMouse = screenToWorld(input.mousePos);

  // Share panel interaction (blocks all other input when open)
  if (state.sharePanel.open) {
    const W = canvas.width, H = canvas.height;
    const sp = state.sharePanel;
    const panelW = 340, panelH = sp.gifBlob ? 330 : 300;
    const px = W / 2 - panelW / 2, py = H / 2 - panelH / 2;
    const mx = input.mousePos.x, my = input.mousePos.y;

    // Button layout constants (must match renderer exactly)
    const btnW = panelW - 40, btnH = 36, btnX = px + 20;
    const startY = py + 58;
    const gap = 10;
    const gifSectionY = startY + btnH + gap + 26;

    state.hoveredShareBtn = null;
    canvas.style.cursor = 'default';

    if (mx >= px && mx <= px + panelW && my >= py && my <= py + panelH) {
      // Close button (top-right)
      if (hitBtn(input.mousePos, px + panelW - 32, py + 8, 24, 24)) {
        state.hoveredShareBtn = 'close';
        canvas.style.cursor = 'pointer';
      }
      // Copy Room Code button
      else if (hitBtn(input.mousePos, btnX, startY, btnW, btnH)) {
        state.hoveredShareBtn = 'copy_code';
        canvas.style.cursor = 'pointer';
      }
      // GIF section buttons
      else if (!sp.exporting) {
        if (sp.gifBlob) {
          // Download GIF button
          if (hitBtn(input.mousePos, btnX, gifSectionY, btnW, btnH)) {
            state.hoveredShareBtn = 'download_gif';
            canvas.style.cursor = 'pointer';
          }
          // Re-export button (below download)
          else if (hitBtn(input.mousePos, btnX, gifSectionY + btnH + gap + 18, btnW, 30)) {
            state.hoveredShareBtn = 'export_gif';
            canvas.style.cursor = 'pointer';
          }
        } else {
          // Export GIF button
          if (hitBtn(input.mousePos, btnX, gifSectionY, btnW, btnH)) {
            state.hoveredShareBtn = 'export_gif';
            canvas.style.cursor = 'pointer';
          }
        }
      }
    }

    if (input.justPressed) {
      if (state.hoveredShareBtn === 'close') { sfxBack(); closeSharePanel(); }
      else if (state.hoveredShareBtn === 'copy_code') { sfxConfirm(); copyRoomCode(); }
      else if (state.hoveredShareBtn === 'export_gif') { sfxClick(); doExportGif(); }
      else if (state.hoveredShareBtn === 'download_gif') { sfxConfirm(); downloadShareGif(); }
      // Click outside panel closes it (but not during export)
      else if (!sp.exporting && !(mx >= px && mx <= px + panelW && my >= py && my <= py + panelH)) {
        sfxBack(); closeSharePanel();
      }
    }
    return; // block all other input while share panel is open
  }

  // ---- Top-right SHARE button hover/click (always active) ----
  const W = canvas.width;
  const shareBx = getShareBtnX(W);
  const shareHit = hitBtn(input.mousePos, shareBx, SHARE_BTN.y, SHARE_BTN.w, SHARE_BTN.h);
  if (shareHit) {
    state.hoveredHudBtn = 'share';
    canvas.style.cursor = 'pointer';
    if (input.justPressed) { sfxClick(); openSharePanel(); return; }
  }

  // ---- Bottom HUD bar hover detection (must match renderer drawHUD positions) ----
  const hudBarY = canvas.height - 44;
  const btnY = hudBarY + 9;
  const btnH = 26;
  const rightBlockX = W / 2 + 20;
  const hudBtns: Record<string, { x: number; y: number; w: number; h: number }> = {
    clear_level: { x: 10, y: btnY, w: 54, h: btnH },
    menu: { x: 77, y: btnY, w: 50, h: btnH },
    save_progress: { x: 140, y: btnY, w: 48, h: btnH },
    save_stage: { x: rightBlockX, y: btnY, w: 100, h: btnH },
    go: { x: rightBlockX + 113, y: btnY - 1, w: 68, h: btnH + 2 },
    reset: { x: rightBlockX + 194, y: btnY, w: 54, h: btnH },
    replay: { x: rightBlockX + 254, y: btnY, w: 60, h: btnH },
  };
  // Dynamic stage pill buttons (must match renderer layout)
  const totalStages = state.stages.length;
  if (totalStages > 0) {
    const pillW = 28, pillH = 22, pillGap = 5;
    const editBtnW = 48;
    const viewIdx = state.viewingStageIndex;
    const hasSelection = viewIdx >= 0 && viewIdx < totalStages && state.mode === 'planning';
    const totalPills = totalStages + (state.mode === 'planning' ? 1 : 0);
    const totalW = totalPills * (pillW + pillGap) - pillGap + (hasSelection ? editBtnW + pillGap + 6 : 0);
    const startX = W / 2 - totalW / 2;
    const pillY = btnY + (btnH - pillH) / 2;
    for (let i = 0; i < totalStages; i++) {
      hudBtns[`stage_${i}`] = { x: startX + i * (pillW + pillGap), y: pillY, w: pillW, h: pillH };
    }
    if (hasSelection) {
      const editX = startX + totalPills * (pillW + pillGap) + 6;
      hudBtns['edit_stage'] = { x: editX, y: pillY, w: editBtnW, h: pillH };
    }
  }
  if (input.mousePos.y > hudBarY) {
    canvas.style.cursor = 'default';
    if (!shareHit) state.hoveredHudBtn = null;
    for (const [key, b] of Object.entries(hudBtns)) {
      if (hitBtn(input.mousePos, b.x, b.y, b.w, b.h)) { state.hoveredHudBtn = key as HudBtn; break; }
    }
    if (state.hoveredHudBtn) canvas.style.cursor = 'pointer';
  } else if (!shareHit) {
    state.hoveredHudBtn = null;
    canvas.style.cursor = 'crosshair';
    // Floor indicator pill hover (top-right)
    const maxFloor = state.room.floors ? Math.max(0, ...state.room.floors.map(f => f.level)) : 0;
    if (maxFloor > 0) {
      const pillW = 36, pillH = 22, gap = 4, margin = 10;
      const totalW = (maxFloor + 1) * (pillW + gap) - gap;
      const startX = canvas.width - margin - totalW;
      const fy = margin;
      for (let level = 0; level <= maxFloor; level++) {
        const px = startX + level * (pillW + gap);
        if (hitBtn(input.mousePos, px, fy, pillW, pillH)) {
          state.hoveredHudBtn = `floor_${level}` as import('./types').HudBtn;
          canvas.style.cursor = 'pointer';
          break;
        }
      }
    }
  }

  // Floor pill clicks (work in all modes)
  if (input.justPressed && state.hoveredHudBtn && (state.hoveredHudBtn as string).startsWith('floor_')) {
    const level = parseInt((state.hoveredHudBtn as string).split('_')[1]);
    state.activeFloor = level;
    sfxTick();
    return;
  }

  // HUD bar button clicks work in ALL modes (including executing)
  if (input.justPressed && input.mousePos.y > hudBarY) {
    const h = state.hoveredHudBtn;
    if (h === 'go') {
      sfxConfirm();
      if (state.mode === 'planning') doGo();
      else if (state.mode === 'executing') { state.mode = 'paused'; }
      else if (state.mode === 'paused') { state.mode = 'executing'; }
    }
    else if (h === 'save_stage') { sfxConfirm(); saveStage(); state.stageJustCompleted = false; }
    else if (h === 'reset') { sfxBack(); doReset(); }
    else if (h === 'clear_level') { sfxDelete(); doClearLevel(); }
    else if (h === 'menu') { sfxBack(); show('menu'); }
    else if (h === 'replay') { sfxClick(); doReplay(); }
    else if (h === 'save_progress') { sfxConfirm(); _saveProgress(state, selRoom, selOpCount); refreshInProgressUI(); showSaveConfirmation(); }
    else if (h === 'edit_stage') { sfxClick(); editStage(); }
    else if (h && h.startsWith('stage_')) {
      sfxTick();
      const idx = parseInt(h.split('_')[1]);
      if (state.mode === 'planning') {
        // Toggle selection: click again to deselect
        state.viewingStageIndex = state.viewingStageIndex === idx ? -1 : idx;
      }
    }
    return;
  }

  if (state.mode === 'executing') return;
  const inter = state.interaction;

  // Speed slider interaction (takes priority when open)
  if (state.speedSlider && state.interaction.type === 'speed_slider') {
    const slider = state.speedSlider;
    const inter = state.interaction;
    const sliderX = slider.screenPos.x;
    const sliderY = slider.screenPos.y;
    const sliderW = 120, sliderH = 30;
    const trackX = sliderX + 10, trackW = sliderW - 20;
    const trackY = sliderY + sliderH / 2;

    // Check if mouse is near the slider track for dragging
    if (input.justPressed) {
      if (input.mousePos.x >= sliderX && input.mousePos.x <= sliderX + sliderW &&
          input.mousePos.y >= sliderY - 5 && input.mousePos.y <= sliderY + sliderH + 5) {
        slider.dragging = true;
      } else {
        // Click outside slider - close it and apply
        state.speedSlider = null;
        state.interaction = { type: 'idle' };
        state.popup = null;
        return;
      }
    }
    if (slider.dragging && input.mouseDown) {
      const frac = Math.max(0, Math.min(1, (input.mousePos.x - trackX) / trackW));
      const newTempo = Math.round((0.2 + frac * 2.8) * 10) / 10;
      slider.value = newTempo;
      const op = state.operators.find(o => o.id === inter.opId);
      if (op) {
        if (inter.wpIdx !== null) {
          op.path.waypoints[inter.wpIdx].tempo = newTempo;
        } else {
          op.tempo = newTempo;
        }
      }
    }
    if (input.justReleased) {
      slider.dragging = false;
    }
    return;
  }

  // Radial menu interaction (takes priority when open)
  if (state.radialMenu) {
    const menu = state.radialMenu;
    // Update hover state every frame
    menu.hoveredIdx = hitTestRadialMenu(worldMouse, menu);
    // Animate open
    if (menu.animT < 1) menu.animT = Math.min(1, menu.animT + 0.15);

    if (input.justPressed) {
      const items = getRadialItems(menu.wpIdx, menu.opId);
      if (menu.hoveredIdx >= 0) {
        sfxSelect();
        const item = items[menu.hoveredIdx];
        const op = state.operators.find(o => o.id === menu.opId);
        if (op) {
          if (menu.wpIdx < 0) {
            // Operator radial menu actions
            if (item.id === 'direction') {
              state.interaction = { type: 'spinning_direction', opId: op.id };
            } else if (item.id === 'pie') {
              if (op.pieTarget) {
                // Already has pie - bake direction into waypoints, then remove icon
                bakePieDirection(op);
                op.pieTarget = null;
                state.interaction = { type: 'idle' };
              } else {
                state.interaction = { type: 'placing_pie', opId: op.id };
              }
            } else if (item.id === 'route') {
              if (op.path.waypoints.length === 0) {
                op.path.waypoints = [makeWaypoint(op.position, op.currentFloor)];
                op.path.splineLUT = null;
              }
              state.interaction = { type: 'placing_waypoints', opId: op.id };
            } else if (item.id === 'speed') {
              const cam2 = state.camera;
              const sp2 = { x: (op.position.x - cam2.x) * cam2.zoom + canvas.width / 2, y: (op.position.y - cam2.y) * cam2.zoom + canvas.height / 2 };
              state.speedSlider = { screenPos: { x: sp2.x + 20, y: sp2.y + 20 }, value: op.tempo, dragging: false };
              state.interaction = { type: 'speed_slider', opId: op.id, wpIdx: null, sliderValue: op.tempo };
            }
          } else {
            // Node radial menu actions
            const wp = op.path.waypoints[menu.wpIdx];
            if (item.id === 'direction') {
              state.interaction = { type: 'setting_facing', opId: op.id, wpIdx: menu.wpIdx };
            } else if (item.id === 'route') {
              state.interaction = { type: 'placing_waypoints', opId: op.id };
            } else if (item.id === 'delete') {
              if (op.path.waypoints.length > 2) {
                op.path.waypoints.splice(menu.wpIdx, 1);
                rebuildPathLUT(op);
              }
            } else if (item.id === 'speed') {
              const cam2 = state.camera;
              const sp2 = { x: (wp.position.x - cam2.x) * cam2.zoom + canvas.width / 2, y: (wp.position.y - cam2.y) * cam2.zoom + canvas.height / 2 };
              state.speedSlider = { screenPos: { x: sp2.x + 20, y: sp2.y + 20 }, value: wp.tempo, dragging: false };
              state.interaction = { type: 'speed_slider', opId: op.id, wpIdx: menu.wpIdx, sliderValue: wp.tempo };
            } else if (item.id === 'hold') {
              wp.hold = !wp.hold;
              if (wp.hold && !wp.goCode) wp.goCode = 'A';
            } else if (item.id === 'door') {
              if (wp.openDoors && wp.openDoors.length > 0) {
                // Cancel door action
                wp.openDoors = [];
              } else {
                // Assign nearest doors to this waypoint
                const nearDoors = findDoorsNear(wp.position, DOOR_W * 2);
                wp.openDoors = nearDoors.map(nd => ({ wallIdx: nd.wallIdx, doorIdx: nd.doorIdx }));
              }
            }
          }
        }
      }
      // Always close radial menu on click (whether item was hit or not)
      state.radialMenu = null;
      return;
    }
    if (input.rightJustPressed) {
      state.radialMenu = null;
      return;
    }
    return; // block other input while radial menu is open
  }

  // Legacy popup fallback (kept for compatibility)
  if (state.popup && input.justPressed) {
    state.popup = null;
    return;
  }

  if (inter.type === 'deploying_op') {
    const op = state.operators.find(o => o.id === inter.opId);
    if (op && input.mouseDown) op.position = copy(worldMouse);
    if (input.justReleased && op) {
      op.deployed = true;
      op.startPosition = copy(op.position);
      op.smoothPosition = copy(op.position);
      op.angle = 0; // face right when placed
      op.startAngle = 0;
      op.currentFloor = state.activeFloor;
      op.startFloor = state.activeFloor;
      state.interaction = { type: 'idle' };
    }
    return;
  }

  if (inter.type === 'moving_op') {
    const op = state.operators.find(o => o.id === inter.opId);
    if (op && input.mouseDown && input.isDragging) {
      op.position = copy(worldMouse);
      op.startPosition = copy(op.position);
      // Keep waypoint 0 synced with operator position
      if (op.path.waypoints.length > 0) {
        op.path.waypoints[0].position = copy(worldMouse);
        rebuildPathLUT(op);
      }
    }
    if (input.justReleased) {
      if (!input.isDragging && op) {
        // Short click on already-selected op = open radial menu
        state.radialMenu = { center: copy(op.position), opId: op.id, wpIdx: -1, hoveredIdx: -1, animT: 0 };
      }
      state.interaction = { type: 'idle' };
    }
    return;
  }

  // Handle pending node confirm/cancel buttons (only while in placing_waypoints mode)
  if (state.pendingNode && inter.type === 'placing_waypoints' && input.justPressed) {
    const pn = state.pendingNode;
    const op = state.operators.find(o => o.id === pn.opId);
    if (op && pn.wpIdx < op.path.waypoints.length) {
      const wp = op.path.waypoints[pn.wpIdx];
      const cam2 = state.camera;
      const sp2 = {
        x: (wp.position.x - cam2.x) * cam2.zoom + canvas.width / 2,
        y: (wp.position.y - cam2.y) * cam2.zoom + canvas.height / 2,
      };
      // Check mark button (right side of node)
      const checkX = sp2.x + 14, checkY = sp2.y - 8, btnSize = 16;
      if (hitBtn(input.mousePos, checkX, checkY, btnSize, btnSize)) {
        // Confirm: keep the node, exit placing mode back to idle (selection mode)
        // Operator stays selected so user can drag nodes, set directions, etc.
        state.pendingNode = null;
        state.interaction = { type: 'idle' };
        return;
      }
      // X button (left side of node)
      const cancelX = sp2.x - 14 - btnSize, cancelY = sp2.y - 8;
      if (hitBtn(input.mousePos, cancelX, cancelY, btnSize, btnSize)) {
        // Cancel: remove the node, exit placing mode
        op.path.waypoints.splice(pn.wpIdx, 1);
        rebuildPathLUT(op);
        state.pendingNode = null;
        state.interaction = { type: 'idle' };
        return;
      }
    }
  }

  if (inter.type === 'placing_waypoints') {
    const op = state.operators.find(o => o.id === inter.opId);
    if (input.justPressed && op) {
      // check if clicking in deploy bar area - cancel waypoint placing
      const hudBarY = canvas.height - 44;
      const deployBarY = hudBarY - DEPLOY_PANEL_H - 6;
      if (input.mousePos.y > deployBarY) { state.interaction = { type: 'idle' }; state.pendingNode = null; return; }
      // Check if clicking on the current operator itself - open radial menu
      if (distance(worldMouse, op.position) < OP_R + 8) {
        state.interaction = { type: 'idle' };
        state.pendingNode = null;
        state.radialMenu = { center: copy(op.position), opId: op.id, wpIdx: -1, hoveredIdx: -1, animT: 0 };
        return;
      }
      // Determine floor level for this waypoint
      const wpFloor = state.activeFloor;
      // Check if placing on stairs — switch view to destination floor.
      // Only transition once per stair: if the last waypoint was ALSO placed on
      // this same stair, don't transition again (prevents toggling).
      const stair = getStairAtPoint(state.room, worldMouse.x, worldMouse.y, state.activeFloor);
      if (stair && stair.connectsFloors) {
        const prevWp = op.path.waypoints.length > 0 ? op.path.waypoints[op.path.waypoints.length - 1] : null;
        const prevOnSameStair = prevWp &&
          prevWp.position.x >= stair.x && prevWp.position.x <= stair.x + stair.w &&
          prevWp.position.y >= stair.y && prevWp.position.y <= stair.y + stair.h;
        if (!prevOnSameStair) {
          const destFloor = getStairDestFloor(stair, state.activeFloor);
          state.activeFloor = destFloor;
        }
      }
      op.path.waypoints.push(makeWaypoint(worldMouse, wpFloor));
      rebuildPathLUT(op);
      // Set this as pending node needing confirm/cancel
      state.pendingNode = { opId: op.id, wpIdx: op.path.waypoints.length - 1 };
    }
    if (input.rightJustPressed && op) { state.interaction = { type: 'idle' }; state.pendingNode = null; }
    return;
  }

  if (inter.type === 'setting_facing') {
    const op = state.operators.find(o => o.id === inter.opId);
    if (op) {
      const target = inter.wpIdx !== null ? op.path.waypoints[inter.wpIdx] : null;
      const origin = target ? target.position : op.position;
      // Continuously preview facing direction toward mouse
      const dx = worldMouse.x - origin.x, dy = worldMouse.y - origin.y;
      if (dx * dx + dy * dy > 64) {
        const a = Math.atan2(dy, dx);
        if (input.rightMouseDown || input.mouseDown) {
          if (target) { target.facingOverride = a; target.lookTarget = null; }
          else { op.angle = a; op.startAngle = a; }
        }
      }
    }
    // Left-click or right-click release confirms
    if (input.justReleased || input.rightJustReleased) state.interaction = { type: 'idle' };
    return;
  }

  if (inter.type === 'dragging_node') {
    const op = state.operators.find(o => o.id === inter.opId);
    if (op && input.mouseDown) {
      if (inter.wpIdx === 0) {
        // Node 0 IS the operator - move operator + sync node 0
        op.position = copy(worldMouse);
        op.startPosition = copy(worldMouse);
        op.path.waypoints[0].position = copy(worldMouse);
      } else {
        op.path.waypoints[inter.wpIdx].position = copy(worldMouse);
      }
      rebuildPathLUT(op);
    }
    if (input.justReleased) {
      if (!input.isDragging && op) {
        // Short click on node = open node radial menu (but not for node 0 - that's the operator)
        if (inter.wpIdx > 0) {
          state.radialMenu = { center: copy(op.path.waypoints[inter.wpIdx].position), opId: op.id, wpIdx: inter.wpIdx, hoveredIdx: -1, animT: 0 };
        }
      }
      state.interaction = { type: 'idle' };
    }
    return;
  }

  if (inter.type === 'setting_look_target') {
    if (input.justPressed) {
      const op = state.operators.find(o => o.id === inter.opId);
      if (op) { op.path.waypoints[inter.wpIdx].lookTarget = copy(worldMouse); op.path.waypoints[inter.wpIdx].facingOverride = null; }
      state.interaction = { type: 'idle' };
    }
    return;
  }

  if (inter.type === 'tempo_ring') {
    if (input.mouseDown) {
      const op = state.operators.find(o => o.id === inter.opId);
      if (op) {
        const target = inter.wpIdx !== null ? op.path.waypoints[inter.wpIdx] : null;
        const origin = target ? target.position : op.position;
        const a = Math.atan2(worldMouse.y - origin.y, worldMouse.x - origin.x);
        const norm = (a + Math.PI) / (2 * Math.PI);
        const tempo = Math.round((0.2 + norm * 2.8) * 10) / 10;
        if (target) target.tempo = tempo; else op.tempo = tempo;
      }
    }
    if (input.justReleased) state.interaction = { type: 'idle' };
    return;
  }

  if (inter.type === 'spinning_direction') {
    const op = state.operators.find(o => o.id === inter.opId);
    if (op) {
      // Continuously set facing toward mouse (tracks without clicking)
      const dx = worldMouse.x - op.position.x;
      const dy = worldMouse.y - op.position.y;
      if (dx * dx + dy * dy > 16) {
        op.angle = Math.atan2(dy, dx);
        op.startAngle = op.angle;
      }
    }
    // Click to confirm and exit direction mode
    if (input.justPressed) {
      state.interaction = { type: 'idle' };
      return;
    }
    // Right-click also exits
    if (input.rightJustPressed) {
      state.interaction = { type: 'idle' };
      return;
    }
    return;
  }

  if (inter.type === 'placing_pie') {
    const op = state.operators.find(o => o.id === inter.opId);
    if (input.justPressed && op) {
      op.pieTarget = copy(worldMouse);
      // Set initial facing toward pie target
      const dx = worldMouse.x - op.position.x;
      const dy = worldMouse.y - op.position.y;
      if (dx * dx + dy * dy > 16) {
        op.angle = Math.atan2(dy, dx);
        op.startAngle = op.angle;
      }
      state.interaction = { type: 'idle' };
      return;
    }
    if (input.rightJustPressed) {
      // Right-click cancels - bake direction then clear pie
      if (op) { bakePieDirection(op); op.pieTarget = null; }
      state.interaction = { type: 'idle' };
      return;
    }
    return;
  }

  // IDLE: right-click
  if (input.rightJustPressed) {
    const selOp = state.operators.find(o => o.id === state.selectedOpId && o.deployed);
    if (selOp) {
      // Check if right-clicking near a waypoint node first
      for (let i = 1; i < selOp.path.waypoints.length; i++) {
        if (distance(worldMouse, selOp.path.waypoints[i].position) < NODE_R + 6) {
          state.interaction = { type: 'setting_facing', opId: selOp.id, wpIdx: i };
          return;
        }
      }
      // Otherwise: right-click anywhere with an operator selected = set that operator's direction
      state.interaction = { type: 'setting_facing', opId: selOp.id, wpIdx: null };
      return;
    }
    // No operator selected - start panning
    state.isPanning = true;
    state.panStart = { x: input.mousePos.x, y: input.mousePos.y };
    state.panCamStart = { x: state.camera.x, y: state.camera.y };
    return;
  }

  if (input.justPressed) {
    // Deploy bar hit test (screen-space) - horizontal row at bottom-left
    {
      const hudBarY2 = canvas.height - 44;
      const deployY = hudBarY2 - DEPLOY_PANEL_H / 2 - 3;
      const undeployed = state.operators.filter(o => !o.deployed);
      if (undeployed.length > 0 && input.mousePos.y > hudBarY2 - DEPLOY_PANEL_H - 10 && input.mousePos.y < hudBarY2) {
        for (let i = 0; i < undeployed.length; i++) {
          const opX = 30 + i * DEPLOY_OP_SPACING;
          if (Math.abs(input.mousePos.x - opX) < 16 && Math.abs(input.mousePos.y - deployY) < 18) {
            const op = undeployed[i];
            op.position = copy(worldMouse);
            state.interaction = { type: 'deploying_op', opId: op.id };
            state.selectedOpId = op.id;
            return;
          }
        }
      }
    }
    
    // HUD bar clicks already handled above

    // All game-world hit tests use worldMouse
    // Priority: selected operator's body/nodes/path FIRST, then other operators

    const selOp = state.operators.find(o => o.id === state.selectedOpId && o.deployed);
    if (selOp) {
      // 1. Selected operator body
      if (distance(worldMouse, selOp.position) < OP_R + 8) {
        state.interaction = { type: 'moving_op', opId: selOp.id };
        return;
      }
      // 2. Selected operator's path nodes
      for (let i = 1; i < selOp.path.waypoints.length; i++) {
        if (distance(worldMouse, selOp.path.waypoints[i].position) < NODE_R + 4) {
          state.interaction = { type: 'dragging_node', opId: selOp.id, wpIdx: i }; return;
        }
      }
      // 3. Selected operator's path spline (click to insert node)
      const lut = selOp.path.splineLUT;
      if (lut && lut.samples.length > 1) {
        let bestD = Infinity, bestI = -1;
        for (let i = 0; i < lut.samples.length - 1; i++) {
          const d = distToSegment(worldMouse, lut.samples[i], lut.samples[i + 1]);
          if (d < bestD) { bestD = d; bestI = i; }
        }
        if (bestD < 12) {
          const cp = closestPointOnSegment(worldMouse, lut.samples[bestI], lut.samples[bestI + 1]);
          const wc = selOp.path.waypoints.length;
          const frac = bestI / (lut.samples.length - 1);
          const insertAfter = Math.min(Math.floor(frac * (wc - 1)), wc - 2);
          selOp.path.waypoints.splice(insertAfter + 1, 0, makeWaypoint(cp, state.activeFloor));
          rebuildPathLUT(selOp);
          state.interaction = { type: 'dragging_node', opId: selOp.id, wpIdx: insertAfter + 1 };
          return;
        }
      }
    }

    // 4. Other operators (swap selection)
    for (const op of state.operators) {
      if (!op.deployed) continue;
      if (op.id === state.selectedOpId) continue; // already handled above
      if (distance(worldMouse, op.position) < OP_R + 8) {
        state.selectedOpId = op.id;
        state.activeFloor = op.currentFloor; // Follow operator's floor
        state.popup = null;
        state.radialMenu = null;
        state.pendingNode = null;
        state.interaction = { type: 'idle' };
        return;
      }
    }

    if (state.interaction.type === 'idle') {
      state.selectedOpId = null; state.popup = null; state.radialMenu = null;
      state.activeFloor = 0; // Snap back to ground floor when deselecting
    }
  }
}

// ========== BUILD SCREEN INPUT ==========
function buildPos(e: MouseEvent): Vec2 {
  const r = buildCv.getBoundingClientRect();
  const sx = (e.clientX - r.left) * (buildCv.width / r.width);
  const sy = (e.clientY - r.top) * (buildCv.height / r.height);
  return buildScreenToWorld(sx, sy);
}
function buildScreenPos(e: MouseEvent): Vec2 {
  const r = buildCv.getBoundingClientRect();
  return { x: (e.clientX - r.left) * (buildCv.width / r.width), y: (e.clientY - r.top) * (buildCv.height / r.height) };
}

buildCv.addEventListener('mousemove', (e) => {
  buildMousePos = buildPos(e);
  const fd = getBuildFloorData();
  if (buildTool === 'delete') {
    buildHoveredWall = -1;
    buildHoveredObject = -1;
    let best = 15;
    for (let i = 0; i < fd.walls.length; i++) {
      const d = distToSegment(buildMousePos, fd.walls[i].a, fd.walls[i].b);
      if (d < best) { best = d; buildHoveredWall = i; }
    }
    for (let i = 0; i < fd.objects.length; i++) {
      const o = fd.objects[i];
      if (buildMousePos.x >= o.x && buildMousePos.x <= o.x + o.w &&
          buildMousePos.y >= o.y && buildMousePos.y <= o.y + o.h) {
        buildHoveredObject = i;
      }
    }
  }
  if (buildTool === 'door') {
    buildHoveredWall = -1;
    buildHoveredDoorSlot = null;
    let bestDist = 20;
    for (let i = 0; i < fd.walls.length; i++) {
      const w = fd.walls[i];
      const slots = getDoorSlots(w);
      const dx = w.b.x - w.a.x, dy = w.b.y - w.a.y;
      for (const frac of slots) {
        const sx = w.a.x + dx * frac, sy = w.a.y + dy * frac;
        const d = distance(buildMousePos, { x: sx, y: sy });
        if (d < bestDist) {
          bestDist = d;
          buildHoveredWall = i;
          buildHoveredDoorSlot = { wallIdx: i, slotFrac: frac };
        }
      }
    }
  }
  if (buildMouseDown && buildDragStart) {
    if (buildTool === 'line') buildDragEnd = snapAngle(buildDragStart, snapVec(buildMousePos));
    else if (buildTool === 'square' || buildTool === 'room' || buildTool === 'object' || buildTool === 'stairs' || buildTool === 'eraser' || buildTool === 'addfloor') buildDragEnd = snapVec(buildMousePos);
  }
});

buildCv.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  const p = buildPos(e);
  buildMouseDown = true;
  const fd = getBuildFloorData();

  if (buildTool === 'line' || buildTool === 'square' || buildTool === 'room' || buildTool === 'object' || buildTool === 'stairs' || buildTool === 'eraser' || buildTool === 'addfloor') {
    buildDragStart = snapVec(p); buildDragEnd = null;
  } else if (buildTool === 'delete') {
    if (buildHoveredObject >= 0) {
      pushHistory(); fd.objects.splice(buildHoveredObject, 1); buildHoveredObject = -1;
    } else if (buildHoveredWall >= 0) {
      pushHistory(); fd.walls.splice(buildHoveredWall, 1); buildHoveredWall = -1; updateFloor();
    }
  } else if (buildTool === 'door') {
    if (buildHoveredDoorSlot) {
      const w = fd.walls[buildHoveredDoorSlot.wallIdx];
      const clickedFrac = buildHoveredDoorSlot.slotFrac;
      pushHistory();
      const existIdx = w.doors.findIndex(d => Math.abs(d.pos - clickedFrac) < 0.05);
      if (existIdx >= 0) {
        if (w.doors[existIdx].open) { w.doors[existIdx].open = false; }
        else { w.doors.splice(existIdx, 1); }
      } else {
        w.doors.push({ pos: clickedFrac, open: true });
      }
    }
  } else if (buildTool === 'threat') {
    pushHistory(); fd.threats.push(makeThreat(snapGrid(p.x), snapGrid(p.y)));
  }
});

buildCv.addEventListener('mouseup', () => {
  if (!buildMouseDown) return;
  buildMouseDown = false;
  const fd = getBuildFloorData();

  if (buildTool === 'line' && buildDragStart && buildDragEnd) {
    const s = buildDragStart, e = { x: snapGrid(buildDragEnd.x), y: snapGrid(buildDragEnd.y) };
    if (distance(s, e) > GRID * 0.5) { pushHistory(); fd.walls.push(makeWall(s.x, s.y, e.x, e.y)); mergeWalls(); updateFloor(); }
  } else if (buildTool === 'square' && buildDragStart && buildDragEnd) {
    const s = buildDragStart, e = buildDragEnd;
    const x0 = Math.min(s.x, e.x), y0 = Math.min(s.y, e.y), x1 = Math.max(s.x, e.x), y1 = Math.max(s.y, e.y);
    if (x1 - x0 > GRID * 0.5 && y1 - y0 > GRID * 0.5) {
      pushHistory();
      fd.walls.push(makeWall(x0, y0, x1, y0));
      fd.walls.push(makeWall(x1, y0, x1, y1));
      fd.walls.push(makeWall(x1, y1, x0, y1));
      fd.walls.push(makeWall(x0, y1, x0, y0));
      mergeWalls(); updateFloor();
    }
  } else if (buildTool === 'room' && buildDragStart && buildDragEnd) {
    const s = buildDragStart, e = buildDragEnd;
    const x0 = Math.min(s.x, e.x), y0 = Math.min(s.y, e.y), x1 = Math.max(s.x, e.x), y1 = Math.max(s.y, e.y);
    const rw = x1 - x0, rh = y1 - y0;
    if (rw > GRID * 1.5 && rh > GRID * 1.5) {
      pushHistory();
      const stampFn = STAMP_TEMPLATES[buildSelectedStamp];
      const newWalls = stampFn(x0, y0, rw, rh);
      fd.walls.push(...newWalls);
      mergeWalls(); updateFloor();
    }
  } else if ((buildTool === 'object' || buildTool === 'stairs') && buildDragStart && buildDragEnd) {
    const s = buildDragStart, e = buildDragEnd;
    const x0 = Math.min(s.x, e.x), y0 = Math.min(s.y, e.y), x1 = Math.max(s.x, e.x), y1 = Math.max(s.y, e.y);
    const rw = x1 - x0, rh = y1 - y0;
    if (rw > GRID * 0.5 && rh > GRID * 0.5) {
      pushHistory();
      fd.objects.push({ x: x0, y: y0, w: rw, h: rh, type: buildTool === 'stairs' ? 'stairs' : 'block' });
    }
  } else if (buildTool === 'eraser' && buildDragStart && buildDragEnd) {
    const s = buildDragStart, e = buildDragEnd;
    const x0 = Math.min(s.x, e.x), y0 = Math.min(s.y, e.y), x1 = Math.max(s.x, e.x), y1 = Math.max(s.y, e.y);
    if (x1 - x0 > 2 || y1 - y0 > 2) {
      pushHistory();
      for (let cx = snapGrid(x0); cx < x1; cx += GRID) {
        for (let cy = snapGrid(y0); cy < y1; cy += GRID) {
          if (!fd.floorCut.some(c2 => c2.x === cx && c2.y === cy)) {
            fd.floorCut.push({ x: cx, y: cy });
          }
        }
      }
      updateFloor();
    }
  } else if (buildTool === 'addfloor' && buildDragStart && buildDragEnd) {
    const s = buildDragStart, e = buildDragEnd;
    const x0 = Math.min(s.x, e.x), y0 = Math.min(s.y, e.y), x1 = Math.max(s.x, e.x), y1 = Math.max(s.y, e.y);
    const rw = x1 - x0, rh = y1 - y0;
    if (rw > GRID * 2 && rh > GRID * 2) {
      // Check if any stairs overlap this area (on ground floor)
      const allObjs = [...customRoom.objects];
      for (const fl of customRoom.floors) allObjs.push(...fl.objects);
      const overlappingStairs = allObjs.filter(obj =>
        obj.type === 'stairs' &&
        obj.x < x1 && obj.x + obj.w > x0 &&
        obj.y < y1 && obj.y + obj.h > y0
      );
      if (overlappingStairs.length === 0) {
        alert('The floor area must overlap at least one staircase. Place stairs first, then create a floor over them.');
      } else {
        pushHistory();
        const newLevel = (customRoom.floors.length > 0 ? Math.max(...customRoom.floors.map(f => f.level)) : 0) + 1;
        const newFloor: import('./types').FloorLayer = {
          level: newLevel,
          bounds: { x: x0, y: y0, w: rw, h: rh },
          walls: [],
          threats: [],
          objects: [],
          floor: [],
          floorCut: [],
        };
        // Fill floor cells for the new floor bounds
        for (let cx = x0; cx < x1; cx += GRID) {
          for (let cy = y0; cy < y1; cy += GRID) {
            newFloor.floor.push({ x: cx, y: cy });
          }
        }
        customRoom.floors.push(newFloor);
        // Auto-connect overlapping stairs
        for (const stair of overlappingStairs) {
          stair.connectsFloors = [newLevel - 1, newLevel];
        }
        buildActiveFloor = newLevel;
        refreshBuildFloorTabs();
        sfxConfirm();
      }
    }
  }
  buildDragStart = null; buildDragEnd = null;
});

buildCv.addEventListener('contextmenu', (e) => e.preventDefault());

// Build canvas zoom + pan
buildCv.addEventListener('wheel', (e) => {
  e.preventDefault();
  const factor = 1 - e.deltaY * 0.001;
  buildCam.zoom = Math.max(0.2, Math.min(4, buildCam.zoom * factor));
}, { passive: false });

buildCv.addEventListener('mousedown', (e2) => {
  if (e2.button === 2 || e2.button === 1) { // right click or middle click = pan
    e2.preventDefault();
    buildPanning = true;
    buildPanStart = buildScreenPos(e2);
    buildPanCamStart = { x: buildCam.x, y: buildCam.y };
  }
});
window.addEventListener('mousemove', (e2) => {
  if (buildPanning) {
    const sp = buildScreenPos(e2);
    buildCam.x = buildPanCamStart.x - (sp.x - buildPanStart.x) / buildCam.zoom;
    buildCam.y = buildPanCamStart.y - (sp.y - buildPanStart.y) / buildCam.zoom;
  }
});
window.addEventListener('mouseup', (e2) => {
  if (e2.button === 2 || e2.button === 1) buildPanning = false;
});

// ---- Game Loop ----
/** Track previous floor of each operator for auto-switch detection */
let prevOpFloors: Record<number, number> = {};

function update(dt: number) {
  if (state.screen !== 'game') return;
  const inputResult = _handleGameInput(state, canvas, selRoom, selOpCount);
  if (inputResult === 'menu') { show('menu'); return; }
  if (state.mode === 'executing') {
    // Snapshot floors before simulation step
    for (const op of state.operators) {
      if (op.deployed) prevOpFloors[op.id] = op.currentFloor;
    }
    updateSimulation(state, dt * state.playbackSpeed);
    // Auto-switch active floor when an operator transitions floors
    // Prefer selected operator, otherwise follow the first one that transitions
    let transitioned = false;
    if (state.selectedOpId !== null) {
      const selOp = state.operators.find(o => o.id === state.selectedOpId);
      if (selOp && selOp.deployed && prevOpFloors[selOp.id] !== undefined && prevOpFloors[selOp.id] !== selOp.currentFloor) {
        state.activeFloor = selOp.currentFloor;
        transitioned = true;
      }
    }
    if (!transitioned) {
      for (const op of state.operators) {
        if (op.deployed && prevOpFloors[op.id] !== undefined && prevOpFloors[op.id] !== op.currentFloor) {
          state.activeFloor = op.currentFloor;
          break;
        }
      }
    }
    checkStageCompletion();
  }
  clearFrameInput();
}

function renderFrame() {
  if (state.screen === 'game') {
    renderGame(canvas, state);
    // Draw save confirmation overlay
    if (saveConfirmTimer > 0) {
      saveConfirmTimer--;
      const ctx = canvas.getContext('2d')!;
      const alpha = Math.min(1, saveConfirmTimer / 20); // fade out in last 20 frames
      ctx.save();
      ctx.globalAlpha = alpha * 0.92;
      const msg = 'PROGRESS SAVED';
      ctx.font = 'bold 14px monospace';
      const tw = ctx.measureText(msg).width;
      const px = canvas.width / 2 - tw / 2 - 20;
      const py = 70;
      const pw = tw + 40, ph = 36;
      ctx.fillStyle = 'rgba(30,60,40,0.95)';
      ctx.beginPath(); ctx.roundRect(px, py, pw, ph, 6); ctx.fill();
      ctx.strokeStyle = '#55aa66';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.roundRect(px, py, pw, ph, 6); ctx.stroke();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = '#88dd88';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(msg, canvas.width / 2, py + ph / 2);
      ctx.restore();
    }
  }
  if (document.getElementById('build-screen')!.style.display !== 'none') renderBuild();
}

// ========== BUILD CANVAS RENDERING ==========
function renderBuild() {
  const ctx = buildCv.getContext('2d')!;
  const W = buildCv.width, H = buildCv.height;
  const now = performance.now();
  const buildDt = Math.min((now - buildLastTime) / 1000, 0.05);
  buildLastTime = now;
  buildAnimT += buildDt;

  // Background
  ctx.fillStyle = '#080e12';
  ctx.fillRect(0, 0, W, H);

  // Apply build camera
  ctx.save();
  ctx.translate(W / 2, H / 2);
  ctx.scale(buildCam.zoom, buildCam.zoom);
  ctx.translate(-buildCam.x, -buildCam.y);

  // ---- Render inactive floors as ghosts first ----
  const allFloorLevels = [0, ...customRoom.floors.map(f => f.level)];
  for (const level of allFloorLevels) {
    if (level === buildActiveFloor) continue; // skip active floor, render it fully later
    const flData = level === 0
      ? { walls: customRoom.walls, threats: customRoom.threats, objects: customRoom.objects, floor: customRoom.floor }
      : (() => { const fl = customRoom.floors.find(f => f.level === level); return fl ? { walls: fl.walls, threats: fl.threats, objects: fl.objects, floor: fl.floor } : null; })();
    if (!flData) continue;
    ctx.save();
    ctx.globalAlpha = 0.2;
    // Ghost floor cells
    if (flData.floor.length > 0) {
      ctx.fillStyle = level < buildActiveFloor ? '#0e0c08' : '#101824';
      for (const cell of flData.floor) ctx.fillRect(cell.x, cell.y, GRID, GRID);
    }
    // Ghost walls
    for (const w of flData.walls) drawBuildWall(ctx, w, false);
    // Ghost objects
    for (const obj of flData.objects) {
      ctx.fillStyle = 'rgba(80,80,80,0.3)';
      ctx.fillRect(obj.x, obj.y, obj.w, obj.h);
    }
    ctx.restore();
  }

  // ---- Active floor data ----
  const afd = getBuildFloorData();

  // Floor cells (active floor)
  if (afd.floor.length > 0) {
    ctx.fillStyle = buildActiveFloor === 0 ? '#1a1814' : '#141a20';
    for (const cell of afd.floor) {
      ctx.fillRect(cell.x, cell.y, GRID, GRID);
    }
  }

  // Grid dots (world space, only visible area)
  ctx.fillStyle = 'rgba(68,187,170,0.06)';
  {
    const vl = buildCam.x - W / 2 / buildCam.zoom, vt = buildCam.y - H / 2 / buildCam.zoom;
    const vr = buildCam.x + W / 2 / buildCam.zoom, vb = buildCam.y + H / 2 / buildCam.zoom;
    const gx0 = Math.floor(vl / GRID) * GRID, gy0 = Math.floor(vt / GRID) * GRID;
    for (let x = gx0; x <= vr; x += GRID) for (let y = gy0; y <= vb; y += GRID) {
      ctx.beginPath(); ctx.arc(x, y, 1 / buildCam.zoom, 0, Math.PI * 2); ctx.fill();
    }
  }

  // Crosshair guide lines
  if (buildTool !== 'delete' && buildTool !== 'door') {
    const sx = snapGrid(buildMousePos.x), sy = snapGrid(buildMousePos.y);
    const vl = buildCam.x - W / 2 / buildCam.zoom, vt = buildCam.y - H / 2 / buildCam.zoom;
    const vr = buildCam.x + W / 2 / buildCam.zoom, vb = buildCam.y + H / 2 / buildCam.zoom;
    ctx.strokeStyle = 'rgba(68,187,170,0.08)';
    ctx.lineWidth = 1 / buildCam.zoom; ctx.setLineDash([4 / buildCam.zoom, 10 / buildCam.zoom]);
    ctx.beginPath(); ctx.moveTo(sx, vt); ctx.lineTo(sx, vb); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(vl, sy); ctx.lineTo(vr, sy); ctx.stroke();
    ctx.setLineDash([]);
  }

  // ---- Walls (active floor) ----
  for (let i = 0; i < afd.walls.length; i++) {
    const w = afd.walls[i];
    const hover = i === buildHoveredWall && (buildTool === 'delete' || buildTool === 'door');
    drawBuildWall(ctx, w, hover);
  }

  // ---- Preview: Line ----
  if (buildTool === 'line' && buildDragStart && buildDragEnd) {
    const s = buildDragStart, e = { x: snapGrid(buildDragEnd.x), y: snapGrid(buildDragEnd.y) };
    ctx.lineCap = 'round'; ctx.strokeStyle = 'rgba(68,187,170,0.45)'; ctx.lineWidth = 8;
    ctx.setLineDash([10, 6]);
    ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(e.x, e.y); ctx.stroke();
    ctx.setLineDash([]);
    // Endpoints
    ctx.fillStyle = '#44bbaa';
    ctx.beginPath(); ctx.arc(s.x, s.y, 5, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(e.x, e.y, 5, 0, Math.PI * 2); ctx.fill();
    // Angle + length label
    const dx = e.x - s.x, dy = e.y - s.y;
    const deg = Math.round(Math.atan2(-dy, dx) * 180 / Math.PI);
    const len = Math.round(distance(s, e));
    ctx.fillStyle = 'rgba(68,187,170,0.8)'; ctx.font = 'bold 10px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    ctx.fillText(`${deg}\u00B0  ${len}px`, (s.x + e.x) / 2, (s.y + e.y) / 2 - 14);
  }

  // ---- Preview: Square ----
  if (buildTool === 'square' && buildDragStart && buildDragEnd) {
    const s = buildDragStart, e = buildDragEnd;
    const x0 = Math.min(s.x, e.x), y0 = Math.min(s.y, e.y), x1 = Math.max(s.x, e.x), y1 = Math.max(s.y, e.y);
    ctx.strokeStyle = 'rgba(68,187,170,0.45)'; ctx.lineWidth = 8; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.setLineDash([10, 6]);
    ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
    ctx.setLineDash([]);
    // Corner dots
    ctx.fillStyle = '#44bbaa';
    for (const p of [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }]) {
      ctx.beginPath(); ctx.arc(p.x, p.y, 5, 0, Math.PI * 2); ctx.fill();
    }
    // Size label
    ctx.fillStyle = 'rgba(68,187,170,0.8)'; ctx.font = 'bold 10px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    ctx.fillText(`${x1 - x0} \u00D7 ${y1 - y0}`, (x0 + x1) / 2, y0 - 10);
  }

  // ---- Preview: Room Stamp ----
  if (buildTool === 'room' && buildDragStart && buildDragEnd) {
    const s = buildDragStart, e = buildDragEnd;
    const x0 = Math.min(s.x, e.x), y0 = Math.min(s.y, e.y), x1 = Math.max(s.x, e.x), y1 = Math.max(s.y, e.y);
    const rw = x1 - x0, rh = y1 - y0;
    if (rw > GRID && rh > GRID) {
      const stampFn = STAMP_TEMPLATES[buildSelectedStamp];
      const previewWalls = stampFn(x0, y0, rw, rh);
      ctx.globalAlpha = 0.45;
      for (const pw of previewWalls) {
        ctx.lineCap = 'round'; ctx.lineWidth = 8;
        ctx.strokeStyle = pw.doors.length > 0 ? 'rgba(192,160,96,0.5)' : 'rgba(68,187,170,0.5)';
        ctx.setLineDash([10, 6]);
        ctx.beginPath(); ctx.moveTo(pw.a.x, pw.a.y); ctx.lineTo(pw.b.x, pw.b.y); ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.globalAlpha = 1;
      // Corner dots
      ctx.fillStyle = '#44bbaa';
      for (const p of [{x:x0,y:y0},{x:x1,y:y0},{x:x1,y:y1},{x:x0,y:y1}]) {
        ctx.beginPath(); ctx.arc(p.x, p.y, 5, 0, Math.PI * 2); ctx.fill();
      }
      // Label
      ctx.fillStyle = 'rgba(68,187,170,0.8)'; ctx.font = 'bold 10px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
      ctx.fillText(buildSelectedStamp + ` ${rw}\u00D7${rh}`, (x0 + x1) / 2, y0 - 10);
    }
  }

  // ---- Threats (active floor) ----
  for (const t of afd.threats) {
    ctx.fillStyle = 'rgba(200,50,50,0.12)';
    ctx.beginPath(); ctx.arc(t.position.x, t.position.y, 16, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#cc3333'; ctx.lineWidth = 3; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(t.position.x - 6, t.position.y - 6); ctx.lineTo(t.position.x + 6, t.position.y + 6); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(t.position.x + 6, t.position.y - 6); ctx.lineTo(t.position.x - 6, t.position.y + 6); ctx.stroke();
    ctx.fillStyle = 'rgba(204,51,51,0.5)'; ctx.font = '8px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillText('THREAT', t.position.x, t.position.y + 10);
  }

  // ---- Objects (blocks/stairs, active floor) ----
  for (let oi = 0; oi < afd.objects.length; oi++) {
    const obj = afd.objects[oi];
    const objHover = oi === buildHoveredObject && buildTool === 'delete';
    if (obj.type === 'block') {
      ctx.fillStyle = objHover ? 'rgba(255,80,60,0.3)' : 'rgba(100,85,65,0.6)';
      ctx.fillRect(obj.x, obj.y, obj.w, obj.h);
      ctx.strokeStyle = objHover ? 'rgba(255,80,60,0.8)' : 'rgba(140,120,90,0.8)';
      ctx.lineWidth = objHover ? 2.5 : 1.5;
      ctx.strokeRect(obj.x, obj.y, obj.w, obj.h);
    } else if (obj.type === 'stairs') {
      ctx.fillStyle = objHover ? 'rgba(255,80,60,0.25)' : 'rgba(70,80,90,0.5)';
      ctx.fillRect(obj.x, obj.y, obj.w, obj.h);
      ctx.strokeStyle = objHover ? 'rgba(255,80,60,0.8)' : 'rgba(120,130,140,0.7)';
      ctx.lineWidth = objHover ? 2.5 : 1.5;
      ctx.strokeRect(obj.x, obj.y, obj.w, obj.h);
      const steps = Math.max(2, Math.round(Math.min(obj.w, obj.h) / 10));
      const isWide = obj.w > obj.h;
      ctx.strokeStyle = 'rgba(160,170,180,0.5)';
      ctx.lineWidth = 1;
      for (let si = 1; si < steps; si++) {
        const frac = si / steps;
        if (isWide) {
          const lx = obj.x + obj.w * frac;
          ctx.beginPath(); ctx.moveTo(lx, obj.y); ctx.lineTo(lx, obj.y + obj.h); ctx.stroke();
        } else {
          const ly = obj.y + obj.h * frac;
          ctx.beginPath(); ctx.moveTo(obj.x, ly); ctx.lineTo(obj.x + obj.w, ly); ctx.stroke();
        }
      }
    }
  }

  // ---- Connected stairs from other floors (visible on this floor too) ----
  if (buildActiveFloor > 0) {
    // Draw stairs from ground floor that connect to this floor
    for (const obj of customRoom.objects) {
      if (obj.type === 'stairs' && obj.connectsFloors &&
          (obj.connectsFloors[0] === buildActiveFloor || obj.connectsFloors[1] === buildActiveFloor) &&
          !afd.objects.includes(obj)) {
        ctx.fillStyle = 'rgba(70,80,90,0.5)';
        ctx.fillRect(obj.x, obj.y, obj.w, obj.h);
        ctx.strokeStyle = 'rgba(100,160,200,0.7)'; ctx.lineWidth = 1.5;
        ctx.strokeRect(obj.x, obj.y, obj.w, obj.h);
        const steps = Math.max(2, Math.round(Math.min(obj.w, obj.h) / 10));
        const isWide = obj.w > obj.h;
        ctx.strokeStyle = 'rgba(160,170,180,0.5)'; ctx.lineWidth = 1;
        for (let si = 1; si < steps; si++) {
          const frac = si / steps;
          if (isWide) { const lx = obj.x + obj.w * frac; ctx.beginPath(); ctx.moveTo(lx, obj.y); ctx.lineTo(lx, obj.y + obj.h); ctx.stroke(); }
          else { const ly = obj.y + obj.h * frac; ctx.beginPath(); ctx.moveTo(obj.x, ly); ctx.lineTo(obj.x + obj.w, ly); ctx.stroke(); }
        }
        const cx = obj.x + obj.w / 2, cy = obj.y + obj.h / 2;
        ctx.fillStyle = 'rgba(100,180,220,0.7)'; ctx.font = 'bold 9px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(`F${obj.connectsFloors[0] + 1}\u2194F${obj.connectsFloors[1] + 1}`, cx, cy);
      }
    }
  }

  // ---- Stair connection labels ----
  for (const obj of afd.objects) {
    if (obj.type === 'stairs' && obj.connectsFloors) {
      const cx = obj.x + obj.w / 2, cy = obj.y + obj.h / 2;
      ctx.fillStyle = 'rgba(100,180,220,0.7)'; ctx.font = 'bold 9px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(`F${obj.connectsFloors[0] + 1}\u2194F${obj.connectsFloors[1] + 1}`, cx, cy);
    }
  }

  // ---- Floor bounds for upper floors ----
  for (const fl of customRoom.floors) {
    const b = fl.bounds;
    if (b.w > 0 && b.h > 0) {
      const isActive = fl.level === buildActiveFloor;
      ctx.strokeStyle = isActive ? 'rgba(100,180,220,0.6)' : 'rgba(100,180,220,0.15)';
      ctx.lineWidth = isActive ? 2 : 1;
      ctx.setLineDash([6, 4]);
      ctx.strokeRect(b.x, b.y, b.w, b.h);
      ctx.setLineDash([]);
      // Label
      ctx.fillStyle = isActive ? 'rgba(100,180,220,0.8)' : 'rgba(100,180,220,0.25)';
      ctx.font = 'bold 10px monospace'; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
      ctx.fillText(`F${fl.level + 1}`, b.x + 4, b.y - 4);
    }
  }

  // ---- Preview: Add Floor drag ----
  if (buildTool === 'addfloor' && buildDragStart && buildDragEnd) {
    const s = buildDragStart, e = buildDragEnd;
    const x0 = Math.min(s.x, e.x), y0 = Math.min(s.y, e.y), x1 = Math.max(s.x, e.x), y1 = Math.max(s.y, e.y);
    ctx.fillStyle = 'rgba(100,180,220,0.1)';
    ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    ctx.strokeStyle = 'rgba(100,180,220,0.6)'; ctx.lineWidth = 2;
    ctx.setLineDash([8, 4]); ctx.strokeRect(x0, y0, x1 - x0, y1 - y0); ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(100,180,220,0.8)'; ctx.font = 'bold 10px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    const newLvl = (customRoom.floors.length > 0 ? Math.max(...customRoom.floors.map(f => f.level)) : 0) + 1;
    ctx.fillText(`New Floor F${newLvl + 1}  ${x1 - x0}\u00D7${y1 - y0}`, (x0 + x1) / 2, y0 - 6);
  }

  // ---- Labels ----
  for (const lbl of customRoom.labels) {
    ctx.fillStyle = 'rgba(200,195,180,0.85)';
    ctx.font = 'bold 11px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(lbl.text, lbl.position.x, lbl.position.y);
  }

    // ---- Entry Points ----
  for (let i = 0; i < customRoom.entryPoints.length; i++) {
    const ep = customRoom.entryPoints[i];
    const pulse = buildAnimT * 20;
    ctx.strokeStyle = '#44bbaa'; ctx.lineWidth = 2;
    ctx.setLineDash([5, 5]); ctx.lineDashOffset = pulse;
    ctx.beginPath(); ctx.arc(ep.x, ep.y, 12, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]); ctx.lineDashOffset = 0;
    ctx.fillStyle = '#44bbaa'; ctx.font = 'bold 13px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('\u2193', ep.x, ep.y);
    ctx.fillStyle = 'rgba(68,187,170,0.5)'; ctx.font = '8px monospace'; ctx.textBaseline = 'top';
    ctx.fillText(`ENTRY ${i + 1}`, ep.x, ep.y + 16);
  }

  // ---- Preview: Object/Stairs drag ----
  if ((buildTool === 'object' || buildTool === 'stairs') && buildDragStart && buildDragEnd) {
    const s = buildDragStart, e = buildDragEnd;
    const x0 = Math.min(s.x, e.x), y0 = Math.min(s.y, e.y), x1 = Math.max(s.x, e.x), y1 = Math.max(s.y, e.y);
    const rw = x1 - x0, rh = y1 - y0;
    if (buildTool === 'stairs') {
      ctx.fillStyle = 'rgba(70,80,90,0.35)';
      ctx.fillRect(x0, y0, rw, rh);
      ctx.strokeStyle = 'rgba(120,130,140,0.7)';
      ctx.lineWidth = 2;
      ctx.setLineDash([8, 4]); ctx.strokeRect(x0, y0, rw, rh); ctx.setLineDash([]);
      // Preview stair lines
      const steps = Math.max(2, Math.round(Math.min(rw, rh) / 10));
      const isWide = rw > rh;
      ctx.strokeStyle = 'rgba(160,170,180,0.4)';
      ctx.lineWidth = 1;
      for (let si = 1; si < steps; si++) {
        const frac = si / steps;
        if (isWide) {
          const lx = x0 + rw * frac;
          ctx.beginPath(); ctx.moveTo(lx, y0); ctx.lineTo(lx, y1); ctx.stroke();
        } else {
          const ly = y0 + rh * frac;
          ctx.beginPath(); ctx.moveTo(x0, ly); ctx.lineTo(x1, ly); ctx.stroke();
        }
      }
    } else {
      ctx.fillStyle = 'rgba(100,85,65,0.35)';
      ctx.fillRect(x0, y0, rw, rh);
      ctx.strokeStyle = 'rgba(140,120,90,0.7)';
      ctx.lineWidth = 2;
      ctx.setLineDash([8, 4]); ctx.strokeRect(x0, y0, rw, rh); ctx.setLineDash([]);
    }
    ctx.fillStyle = 'rgba(68,187,170,0.7)'; ctx.font = 'bold 10px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    ctx.fillText((buildTool === 'stairs' ? 'STAIRS' : 'OBJECT') + ` ${rw}\u00D7${rh}`, (x0+x1)/2, y0-8);
  }

  // ---- Preview: Eraser drag ----
  if (buildTool === 'eraser' && buildDragStart && buildDragEnd) {
    const s = buildDragStart, e = buildDragEnd;
    const x0 = Math.min(s.x, e.x), y0 = Math.min(s.y, e.y), x1 = Math.max(s.x, e.x), y1 = Math.max(s.y, e.y);
    // Highlight individual grid cells that will be erased
    const sx0 = snapGrid(x0), sy0 = snapGrid(y0);
    ctx.fillStyle = 'rgba(255,60,40,0.15)';
    for (let cx = sx0; cx < x1; cx += GRID) {
      for (let cy = sy0; cy < y1; cy += GRID) {
        ctx.fillRect(cx, cy, GRID, GRID);
      }
    }
    // Drag rectangle outline
    ctx.strokeStyle = 'rgba(255,80,60,0.6)';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
    ctx.setLineDash([]);
  }

  // ---- Floor cut cells visualization ----
  if (buildTool === 'eraser') {
    ctx.fillStyle = 'rgba(255,60,40,0.08)';
    for (const fc of afd.floorCut) {
      ctx.fillRect(fc.x, fc.y, GRID, GRID);
    }
  }

  // Snap cursor dot
  if (buildTool !== 'delete' && buildTool !== 'door') {
    const sx = snapGrid(buildMousePos.x), sy = snapGrid(buildMousePos.y);
    ctx.fillStyle = 'rgba(68,187,170,0.3)';
    ctx.beginPath(); ctx.arc(sx, sy, 4 / buildCam.zoom, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(68,187,170,0.5)'; ctx.lineWidth = 1 / buildCam.zoom;
    ctx.beginPath(); ctx.arc(sx, sy, 4 / buildCam.zoom, 0, Math.PI * 2); ctx.stroke();
  }

  // Delete cursor
  if (buildTool === 'delete' && buildHoveredWall < 0 && buildHoveredObject < 0) {
    ctx.strokeStyle = 'rgba(255,80,60,0.25)'; ctx.lineWidth = 2; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(buildMousePos.x - 6, buildMousePos.y - 6); ctx.lineTo(buildMousePos.x + 6, buildMousePos.y + 6); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(buildMousePos.x + 6, buildMousePos.y - 6); ctx.lineTo(buildMousePos.x - 6, buildMousePos.y + 6); ctx.stroke();
  }

  // Door tool: show all slots on all walls
  if (buildTool === 'door') {
    for (let i = 0; i < customRoom.walls.length; i++) {
      const w = customRoom.walls[i];
      const slots = getDoorSlots(w);
      const dx = w.b.x - w.a.x, dy = w.b.y - w.a.y;
      for (const frac of slots) {
        const sx = w.a.x + dx * frac, sy = w.a.y + dy * frac;
        const isHovered = buildHoveredDoorSlot?.wallIdx === i && Math.abs(buildHoveredDoorSlot.slotFrac - frac) < 0.01;
        const isExisting = w.doors.some(d => Math.abs(d.pos - frac) < 0.05);
        if (isExisting) continue; // don't draw slot dot over existing door
        const pulse = isHovered ? 0.5 + 0.5 * Math.sin(buildAnimT * 5) : 0;
        const alpha = isHovered ? 0.6 + pulse * 0.4 : 0.2;
        const r = isHovered ? 6 + pulse * 2 : 4;
        ctx.fillStyle = `rgba(192,160,96,${alpha})`;
        ctx.beginPath(); ctx.arc(sx, sy, r, 0, Math.PI * 2); ctx.fill();
        if (isHovered) {
          ctx.strokeStyle = `rgba(192,160,96,0.6)`; ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.arc(sx, sy, r + 3, 0, Math.PI * 2); ctx.stroke();
        }
      }
    }
  }

  // Restore camera for HUD (screen-space)
  ctx.restore();

  // Tool info HUD
  const toolLabel: Record<BuildToolType, string> = {
    line: 'LINE', square: 'SQUARE', delete: 'DELETE', door: 'DOOR', threat: 'THREAT', object: 'OBJECT', stairs: 'STAIRS', eraser: 'ERASER', label: 'LABEL', room: buildSelectedStamp.toUpperCase(), addfloor: 'ADD FLOOR',
  };
  const toolHint: Record<BuildToolType, string> = {
    line: 'Drag to draw a wall. Snaps to 15\u00B0 increments.',
    square: 'Drag to create a rectangle of 4 walls.',
    delete: 'Click on any wall to remove it.',
    door: 'Click a slot on any wall to place or toggle a door.',
    threat: 'Click to place a threat marker.',
    object: 'Drag to place a filled object/furniture.',
    stairs: 'Drag to place a staircase.',
    eraser: 'Drag to erase floor tiles.',
    label: 'Click to place a text label.',
    room: 'Drag to stamp a ' + buildSelectedStamp + ' room layout.',
    addfloor: 'Drag to select area for a new floor. Must overlap stairs.',
  };
  ctx.fillStyle = 'rgba(8,14,18,0.85)';
  ctx.fillRect(6, 6, 320, 32);
  ctx.strokeStyle = 'rgba(68,187,170,0.2)'; ctx.lineWidth = 1;
  ctx.strokeRect(6, 6, 320, 32);
  ctx.fillStyle = '#44bbaa'; ctx.font = 'bold 11px monospace'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  ctx.fillText(toolLabel[buildTool], 14, 11);
  ctx.fillStyle = 'rgba(138,170,153,0.6)'; ctx.font = '9px monospace';
  ctx.fillText(toolHint[buildTool], 14 + ctx.measureText(toolLabel[buildTool] + '  ').width + 8, 13);

  // Stats bar
  ctx.fillStyle = 'rgba(8,14,18,0.75)'; ctx.fillRect(0, H - 22, W, 22);
  ctx.strokeStyle = 'rgba(68,187,170,0.1)'; ctx.beginPath(); ctx.moveTo(0, H - 22); ctx.lineTo(W, H - 22); ctx.stroke();
  ctx.fillStyle = 'rgba(138,170,153,0.45)'; ctx.font = '9px monospace'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  const doors = afd.walls.reduce((s, w) => s + w.doors.length, 0);
  const objs = afd.objects.length;
  const floorLabel = buildActiveFloor === 0 ? 'F1 (Ground)' : `F${buildActiveFloor + 1}`;
  ctx.fillText(`Floor: ${floorLabel}  Walls: ${afd.walls.length}  Doors: ${doors}  Objects: ${objs}  Threats: ${afd.threats.length}`, 10, H - 11);
  ctx.textAlign = 'right';
  ctx.fillText('[1-9] Tools  [Ctrl+Z] Undo', W - 10, H - 11);
}

function drawBuildWall(ctx: CanvasRenderingContext2D, w: { a: Vec2; b: Vec2; doors: { pos: number; open: boolean }[] }, hover: boolean) {
  const { a, b } = w;
  const dx = b.x - a.x, dy = b.y - a.y, len = Math.sqrt(dx * dx + dy * dy);
  if (len < 1) return;

  if (w.doors.length > 0) {
    const sorted = [...w.doors].sort((a2, b2) => a2.pos - b2.pos);
    const gaps = sorted.map(d => {
      const f = Math.min(DOOR_W / len, 0.9);
      return { gs: d.pos - f / 2, ge: d.pos + f / 2, open: d.open };
    });
    // Draw solid wall segments between door gaps
    ctx.lineCap = 'round';
    ctx.strokeStyle = hover ? '#ff6655' : '#d8cbb0';
    ctx.lineWidth = hover ? 10 : WALL_W;
    let cursor = 0;
    for (const g of gaps) {
      if (g.gs > cursor + 0.02) {
        ctx.beginPath(); ctx.moveTo(a.x + dx * cursor, a.y + dy * cursor); ctx.lineTo(a.x + dx * g.gs, a.y + dy * g.gs); ctx.stroke();
      }
      cursor = g.ge;
    }
    if (cursor < 0.98) {
      ctx.beginPath(); ctx.moveTo(a.x + dx * cursor, a.y + dy * cursor); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
    // Door frames
    const nx = -dy / len, ny = dx / len;
    for (const g of gaps) {
      const dsx = a.x + dx * g.gs, dsy = a.y + dy * g.gs;
      const dex = a.x + dx * g.ge, dey = a.y + dy * g.ge;
      if (g.open) {
        ctx.strokeStyle = '#5a8a5a'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(dsx + nx * 6, dsy + ny * 6); ctx.lineTo(dsx - nx * 6, dsy - ny * 6); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(dex + nx * 6, dey + ny * 6); ctx.lineTo(dex - nx * 6, dey - ny * 6); ctx.stroke();
      } else {
        ctx.strokeStyle = '#8a6a3a'; ctx.lineWidth = 4;
        ctx.beginPath(); ctx.moveTo(dsx, dsy); ctx.lineTo(dex, dey); ctx.stroke();
        ctx.strokeStyle = '#8a6a3a'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(dsx + nx * 6, dsy + ny * 6); ctx.lineTo(dsx - nx * 6, dsy - ny * 6); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(dex + nx * 6, dey + ny * 6); ctx.lineTo(dex - nx * 6, dey - ny * 6); ctx.stroke();
        ctx.fillStyle = '#c0a060'; ctx.beginPath();
        ctx.arc((dsx + dex) / 2 + nx * 3, (dsy + dey) / 2 + ny * 3, 2.5, 0, Math.PI * 2); ctx.fill();
      }
    }
  } else {
    // Regular wall: outline + fill
    ctx.lineCap = 'round';
    ctx.strokeStyle = hover && buildTool === 'delete' ? 'rgba(255,80,60,0.25)' : 'rgba(0,0,0,0.4)';
    ctx.lineWidth = hover ? 12 : WALL_W + 2;
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    ctx.strokeStyle = hover && buildTool === 'delete' ? '#ff6655' : hover && buildTool === 'door' ? '#c0a060' : '#d8cbb0';
    ctx.lineWidth = WALL_W;
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    // Endpoint dots
    ctx.fillStyle = hover ? '#fff' : '#c8bca8';
    ctx.beginPath(); ctx.arc(a.x, a.y, 3, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(b.x, b.y, 3, 0, Math.PI * 2); ctx.fill();
  }
}

// ---- Restore session on page load (refresh protection) ----
const savedSession = loadSessionFromStorage();
if (savedSession) {
  try {
    restoreSession(savedSession);
    clearSessionStorage();
    show('game');
  } catch (e) {
    console.warn('Failed to restore session:', e);
    clearSessionStorage();
  }
}

// Auto-save session periodically while in game
setInterval(() => {
  if (state.screen === 'game' && state.mode !== 'executing') {
    saveSessionToStorage(state, selRoom, selOpCount);
  }
}, 5000);

startGameLoop(update, renderFrame);
