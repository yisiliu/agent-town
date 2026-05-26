import { useEffect, useRef, useState } from 'react';
import PixiGame from './PixiGame.tsx';

import { useElementSize } from 'usehooks-ts';
import { Stage } from '@pixi/react';
import { ConvexProvider, useConvex, useQuery } from 'convex/react';
import type { Viewport } from 'pixi-viewport';
import PlayerDetails from './PlayerDetails.tsx';
import ResidentList from './ResidentList.tsx';
import { api } from '../../convex/_generated/api';
import { useWorldHeartbeat } from '../hooks/useWorldHeartbeat.ts';
import { useHistoricalTime } from '../hooks/useHistoricalTime.ts';
import { DebugTimeManager } from './DebugTimeManager.tsx';
import { GameId } from '../../convex/aiTown/ids.ts';
import { useServerGame } from '../hooks/serverGame.ts';
import GangPanel from './GangPanel.tsx';

export const SHOW_DEBUG_UI = !!import.meta.env.VITE_SHOW_DEBUG_UI;

export default function Game() {
  const convex = useConvex();
  const [selectedElement, setSelectedElement] = useState<{
    kind: 'player';
    id: GameId<'players'>;
  }>();
  const [gameWrapperRef, { width, height }] = useElementSize();

  const worldStatus = useQuery(api.world.defaultWorldStatus);
  const worldId = worldStatus?.worldId;
  const engineId = worldStatus?.engineId;

  const game = useServerGame(worldId);

  // Get current human player ID for gang panel
  const humanTokenIdentifier = useQuery(api.world.userStatus, worldId ? { worldId } : 'skip');
  const players = game ? [...game.world.players.values()] : [];
  const humanPlayer = players.find((p) => p.human === humanTokenIdentifier);
  const currentPlayerId = humanPlayer?.id;

  // Send a periodic heartbeat to our world to keep it alive.
  useWorldHeartbeat();

  const worldState = useQuery(api.world.worldState, worldId ? { worldId } : 'skip');
  const { historicalTime, timeManager } = useHistoricalTime(worldState?.engine);

  const scrollViewRef = useRef<HTMLDivElement>(null);
  // Lifted from PixiGame so the ResidentList sibling can pan the
  // camera by calling viewportRef.current.animate(...).
  const viewportRef = useRef<Viewport | undefined>(undefined);

  // Map-fullscreen toggle. CSS-only: when on, the game area covers the
  // whole viewport (fixed inset-0 z-50) and the sidebars hide. Page
  // layout stays intact behind, so exiting just flips the state back.
  // Esc exits.
  const [isMapFullscreen, setIsMapFullscreen] = useState(false);
  useEffect(() => {
    if (!isMapFullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsMapFullscreen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isMapFullscreen]);

  // Gang panel toggle
  const [isGangPanelOpen, setIsGangPanelOpen] = useState(false);

  if (!worldId || !engineId || !game) {
    return null;
  }
  return (
    <>
      {SHOW_DEBUG_UI && <DebugTimeManager timeManager={timeManager} width={200} height={100} />}
      <div className={
        isMapFullscreen
          ? 'fixed inset-0 z-50 bg-brown-900'
          : 'mx-auto w-full max-w grid grid-rows-[200px_240px_1fr] lg:grid-rows-[1fr] lg:grid-cols-[180px_1fr_auto] lg:grow max-w-[1400px] min-h-[480px] game-frame'
      }>
        {/* Resident list — hidden in map-fullscreen */}
        {!isMapFullscreen && (
          <ResidentList
            game={game}
            viewportRef={viewportRef}
            setSelectedElement={setSelectedElement}
            worldId={worldId}
          />
        )}
        {/* Game area */}
        <div className="relative overflow-hidden bg-brown-900" ref={gameWrapperRef} onClick={() => isGangPanelOpen && setIsGangPanelOpen(false)}>
          <div className="absolute inset-0">
            <div className="container">
              <Stage width={width} height={height} options={{ backgroundColor: 0x7ab5ff }}>
                {/* Re-propagate context because contexts are not shared between renderers.
https://github.com/michalochman/react-pixi-fiber/issues/145#issuecomment-531549215 */}
                <ConvexProvider client={convex}>
                  <PixiGame
                    game={game}
                    worldId={worldId}
                    engineId={engineId}
                    width={width ?? 0}
                    height={height ?? 0}
                    historicalTime={historicalTime}
                    setSelectedElement={setSelectedElement}
                    viewportRef={viewportRef}
                  />
                </ConvexProvider>
              </Stage>
            </div>
          </div>
          {/* Map-fullscreen toggle. Absolute-positioned over the game. */}
          <button
            onClick={() => setIsMapFullscreen(!isMapFullscreen)}
            className="absolute top-2 right-2 z-10 rounded bg-brown-800/80 px-2 py-1 text-xs text-brown-100 hover:bg-brown-700 pointer-events-auto"
            title={isMapFullscreen ? '退出地图全屏 (Esc)' : '地图全屏'}
          >
            {isMapFullscreen ? '⛶ 退出' : '⛶ 全屏'}
          </button>
          {/* Gang Button - Pixel Art Style, bottom left */}
          {!isMapFullscreen && (
            <button
              onClick={() => setIsGangPanelOpen(true)}
              className="absolute bottom-4 left-4 z-20 pointer-events-auto"
              style={{
                width: '48px',
                height: '48px',
                backgroundColor: '#2d1810',
                border: '3px solid #8b6914',
                boxShadow: '4px 4px 0 #1d0800',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '24px',
                cursor: 'pointer',
                imageRendering: 'pixelated',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = '#3d2820';
                e.currentTarget.style.transform = 'translate(1px, 1px)';
                e.currentTarget.style.boxShadow = '3px 3px 0 #1d0800';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = '#2d1810';
                e.currentTarget.style.transform = 'translate(0, 0)';
                e.currentTarget.style.boxShadow = '4px 4px 0 #1d0800';
              }}
              onMouseDown={(e) => {
                e.currentTarget.style.transform = 'translate(2px, 2px)';
                e.currentTarget.style.boxShadow = '2px 2px 0 #1d0800';
              }}
              onMouseUp={(e) => {
                e.currentTarget.style.transform = 'translate(1px, 1px)';
                e.currentTarget.style.boxShadow = '3px 3px 0 #1d0800';
              }}
              title="帮派系统"
            >
              ☠️
            </button>
          )}
          {/* Gang Panel - Inside game area, left side with margin */}
          {isGangPanelOpen && (
            <div
              className="absolute z-30 overflow-hidden pointer-events-auto"
              style={{
                top: '16px',
                left: '16px',
                width: '265px',
                height: 'calc(100% - 32px)',
                backgroundColor: '#2d1810',
                border: '4px solid #8b6914',
                boxShadow: '4px 4px 0 #1d0800, 4px 4px 12px rgba(0,0,0,0.5)',
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <GangPanel worldId={worldId} playerId={currentPlayerId} onClose={() => setIsGangPanelOpen(false)} />
            </div>
          )}
        </div>
        {/* Right column — hidden in map-fullscreen */}
        {!isMapFullscreen && (
          <div
            className="flex flex-col overflow-y-auto shrink-0 px-4 py-6 sm:px-6 lg:w-96 xl:pr-6 border-t-8 sm:border-t-0 sm:border-l-8 border-brown-900  bg-brown-800 text-brown-100"
            ref={scrollViewRef}
          >
            <PlayerDetails
              worldId={worldId}
              engineId={engineId}
              game={game}
              playerId={selectedElement?.id}
              setSelectedElement={setSelectedElement}
              scrollViewRef={scrollViewRef}
            />
          </div>
        )}
      </div>
    </>
  );
}
