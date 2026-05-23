// Based on https://codepen.io/inlet/pen/yLVmPWv.
// Copyright (c) 2018 Patrick Brouwer, distributed under the MIT license.

import { PixiComponent, useApp } from '@pixi/react';
import { Viewport } from 'pixi-viewport';
import { Application } from 'pixi.js';
import { MutableRefObject, ReactNode } from 'react';

export type ViewportProps = {
  app: Application;
  viewportRef?: MutableRefObject<Viewport | undefined>;

  screenWidth: number;
  screenHeight: number;
  worldWidth: number;
  worldHeight: number;
  children?: ReactNode;
};

// https://davidfig.github.io/pixi-viewport/jsdoc/Viewport.html
export default PixiComponent('Viewport', {
  create(props: ViewportProps) {
    const { app, children, viewportRef, ...viewportProps } = props;
    // `events` is a valid Pixi v7 prop but missing from pixi-viewport's
    // IViewportOptions typing — cast to bypass the type-only gap.
    const viewport = new Viewport({
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
      events: app.renderer.events,
      passiveWheel: false,
      ...viewportProps,
    } as ConstructorParameters<typeof Viewport>[0]);
    if (viewportRef) {
      viewportRef.current = viewport;
    }
    // Activate plugins
    // Zoom bounds:
    //   minScale = zoom-out floor; lets users see roughly the whole world
    //   maxScale = zoom-in ceiling; tuned for small-tile maps (16px) so a
    //              single tile can grow to ~96px on screen at full zoom.
    // The original formula `(1.04 * screenWidth) / (worldWidth / 2)` was
    // tuned for the 1440-px gentle map and produces minScale > maxScale on
    // smaller worlds (e.g. pokeworld at 720px) — which silently breaks
    // clampZoom and locks the camera at one fixed level.
    const minScale = Math.min(0.5, (props.screenWidth * 1.0) / props.worldWidth);
    // Default zoom: pick a scale that shows roughly the whole map with
    // some margin, then center on the map. Falls back to setZoom(2.0)
    // if the world dimensions look wrong.
    const fitScale = Math.min(
      props.screenWidth / props.worldWidth,
      props.screenHeight / props.worldHeight,
    );
    const initialScale = fitScale > 0
      ? Math.max(minScale, Math.min(2.0, fitScale * 0.95))
      : 2.0;

    viewport
      .drag()
      .pinch({})
      .wheel()
      .decelerate()
      .clamp({ direction: 'all', underflow: 'center' })
      .clampZoom({
        minScale,
        maxScale: 6.0,
      })
      .setZoom(initialScale)
      .moveCenter(props.worldWidth / 2, props.worldHeight / 2);
    return viewport;
  },
  applyProps(viewport, oldProps: any, newProps: any) {
    Object.keys(newProps).forEach((p) => {
      if (p !== 'app' && p !== 'viewportRef' && p !== 'children' && oldProps[p] !== newProps[p]) {
        // @ts-expect-error Ignoring TypeScript here
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        viewport[p] = newProps[p];
      }
    });
  },
});
