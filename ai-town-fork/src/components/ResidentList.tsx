import * as PIXI from 'pixi.js';
import type { MutableRefObject } from 'react';
import type { Viewport } from 'pixi-viewport';
import type { ServerGame } from '../hooks/serverGame';
import type { SelectElement } from './Player';

// Left sidebar listing every resident in the town. Clicking a name
// pans the viewport to that player's current tile and selects them
// (which makes PlayerDetails on the right render their info).
//
// Sort: pinyin via Intl collation. Mixed Chinese + Latin names sort
// reasonably without any extra dep.
export default function ResidentList({
  game,
  viewportRef,
  setSelectedElement,
}: {
  game: ServerGame;
  viewportRef: MutableRefObject<Viewport | undefined>;
  setSelectedElement: SelectElement;
}) {
  const tileDim = game.worldMap.tileDim;
  const entries = [...game.world.players.values()]
    .map((p) => ({ player: p, desc: game.playerDescriptions.get(p.id) }))
    .filter((e): e is { player: typeof e.player; desc: NonNullable<typeof e.desc> } => !!e.desc)
    .sort((a, b) => a.desc.name.localeCompare(b.desc.name, 'zh-CN'));

  return (
    <div className="flex flex-col overflow-y-auto bg-brown-800 text-brown-100 border-r-8 border-brown-900 p-3 text-sm">
      <h3 className="font-display text-base mb-2 text-center tracking-wider">
        居民 · {entries.length}
      </h3>
      <ul className="space-y-1">
        {entries.map(({ player, desc }) => (
          <li key={player.id}>
            <button
              className="w-full text-left rounded px-2 py-1 hover:bg-brown-700 truncate"
              title={desc.name}
              onClick={() => {
                const vp = viewportRef.current;
                if (vp) {
                  vp.animate({
                    position: new PIXI.Point(
                      player.position.x * tileDim,
                      player.position.y * tileDim,
                    ),
                    scale: 1.5,
                    time: 600,
                  });
                }
                setSelectedElement({ kind: 'player', id: player.id });
              }}
            >
              {desc.name}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
