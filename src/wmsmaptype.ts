/**
 * Copyright 2019 Google LLC. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/// <reference types="@types/google.maps" />

/**
 * @ignore
 */
const DEFAULT_WMS_PARAMS = {
  request: "GetMap",
  service: "WMS",
  srs: "EPSG:3857",
};

/**
 * @ignore
 */
const EPSG_3857_EXTENT = 20037508.34789244;

/**
 * @ignore
 */
const ORIG_X = -EPSG_3857_EXTENT; // x starts from right

/**
 * @ignore
 */
const ORIG_Y = EPSG_3857_EXTENT; // y starts from top

/**
 * Convert xyz tile coordinates to mercator bounds.
 *
 * @param x
 * @param y
 * @param zoom
 * @returns {number[]} minx, miny, maxx, maxy
 */
function xyzToBounds(x: number, y: number, zoom: number, tileSize: number): number[] {
  const wmsTileSize = EPSG_3857_EXTENT * tileSize / (1 << zoom + 7);
  const minx = ORIG_X + x * wmsTileSize;
  const maxx = ORIG_X + (x + 1) * wmsTileSize;
  const miny = ORIG_Y - (y + 1) * wmsTileSize;
  const maxy = ORIG_Y - y * wmsTileSize;
  return [minx, miny, maxx, maxy];
}

interface WmsMapTypeOptions {
  url: string;
  layers: string;
  maxZoom: number;
  styles?: string;
  bgcolor?: string;
  version?: string;
  transparent?: boolean;
  format?: string;
  outline?: boolean;
  levelOfDetail?: number; // desired minZoom only for tile data
  maxOversample?: number; // max difference between zoom and LOD
  name?: string;
  alt?: string;
  minZoom?: number;
  opacity?: number;
  tileSize?: number;
}

interface TileParams {
  coord: google.maps.Point;
  zoom: number;
}

type TileContent = (HTMLCanvasElement | HTMLImageElement)[];

interface Point {
  x: number;
  y: number;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

// We expect most mipmaps to be very small, of size maxOversample or less.
function findNearestLod(mipmap: HTMLImageElement[], targetLod: number, betterThan?: number):
    [image: HTMLImageElement, difference: number] {
  let bestImage: HTMLImageElement, bestDifference = betterThan;
  // A comparison of alternatives:
  // for ... of entries() and similar doesn't skip empties in the sparse array
  // for ... in turns the LOD into strings
  // forEach skips empties, keeps the LOD as number, and gives us image as well.
  // Since the array is so small, we could also live with hitting the empties and if (!image) continue;
  mipmap.forEach((image, lod) => {
    const difference = Math.abs(lod as number - targetLod);
    if (!(difference >= bestDifference)) { // negated to be undefined-tolerant
      bestImage = image;
      bestDifference = difference;
    }
  });
  return [bestImage, bestDifference];
}

/**
 *
 * @param {WmsMapTypeOptions} params
 */
class WmsMapType implements google.maps.MapType {
  alt: string|null;
  maxZoom: number;
  minZoom: number;
  name: string|null;
  opacity: number|null;
  _tileSize: number;
  get tileSize(): google.maps.Size {
    return new google.maps.Size(this._tileSize, this._tileSize);
  }
  projection: null;
  radius: null;

  _url: string;
  get url() {
    return this._url;
  }
  set url(value) {
    if (value.slice(-1) !== "?") {
      value += "?";
    }
    this._url = value;
  }
  levelOfDetail: number;
  maxOversample: number;

  private readonly params: object;
  // Tile cache by zoom level, y, x, and LOD boost.
  // Only the images are cached. Images can only have one parent at a time; cloning does not work well for
  // image servers that do not permit caching. Composited and windowed tiles are canvases rendered on the fly.
  //
  // Another possible way of keeping this cache is a quadtree. This would facilitate creating proxy composites
  // from arbitrarily deep smaller tiles, but would make all other operations slower and probably use more memory.
  // Instead, it's probably better to cap the depth traversed for assembling proxy images, since that's not a
  // critical operation anyway.
  private readonly imageCache: HTMLImageElement[][][][] = [];
  private readonly activeTiles: Map<HTMLDivElement, TileParams> = new Map();

  constructor({
    url,
    layers,
    styles = "",
    bgcolor = "0xFFFFFF",
    version = "1.1.1",
    transparent = true,
    format = "image/png",
    outline = false,
    levelOfDetail = 0,
    maxOversample = 2,
    // google.maps.ImageMapTypeOptions interface
    name,
    alt,
    maxZoom,
    minZoom,
    opacity,
    tileSize = 256,
  }: WmsMapTypeOptions) {
    this.params = {
      layers,
      styles,
      version,
      transparent: String(transparent),
      bgcolor,
      format,
      outline: String(outline),
      ...DEFAULT_WMS_PARAMS,
    };

    this.name = name;
    this.alt = alt;
    this.opacity = opacity;
    this.maxZoom = maxZoom;
    this.minZoom = minZoom;
    this._tileSize = tileSize;
    
    this.url = url;
    this.levelOfDetail = levelOfDetail;
    this.maxOversample = maxOversample;
  }

  getTileUrl(coord: google.maps.Point, zoom: number, lod: number): string {
    // To cap the min LOD, we only need to adjust the tile size parameter passed to the tile server.
    // The zoom and tile size adjustments cancel out for xyzToBounds.
    const tileSizeParam = String(this._tileSize << lod);

    return (
      this.url +
      new URLSearchParams({
        bbox: xyzToBounds(coord.x, coord.y, zoom, this._tileSize).join(","),
        ...this.params,
        width: tileSizeParam,
        height: tileSizeParam,
      }).toString()
    );
  }

  // Windows a tile from a larger tile. This can also be used to generate proxies.
  private tileFromLarger(zoom: number, coord: Point, lod: number, ownerDocument: Document):
      [canvas: HTMLCanvasElement, difference: number] {
    let mipZoom: number;
    let bestDifference: number;
    let best: {
      image: HTMLImageElement
      x: number,
      y: number,
      levelsAbove: number
    };
    for (let levelsAbove = 0; (mipZoom = zoom - levelsAbove) >= 0; ++levelsAbove) {
      const mipCoord = {x: coord.x >> levelsAbove, y: coord.y >> levelsAbove};

      const mipmap = this.imageCache[mipZoom]?.[mipCoord.y]?.[mipCoord.x];
      if (!mipmap) continue;

      let candidate: HTMLImageElement;
      [candidate, bestDifference] = findNearestLod(mipmap, lod + levelsAbove, bestDifference);
      if (candidate) {
        best = {
          image: candidate,
          ...mipCoord,
          levelsAbove: levelsAbove
        };
      }
    }

    if (best) {
      const canvas = ownerDocument.createElement("canvas");
      canvas.width = canvas.height = this._tileSize;
      const ds = this._tileSize << best.levelsAbove;
      canvas.getContext("2d").drawImage(best.image,
        ((best.x << best.levelsAbove) - coord.x) * this._tileSize,
        ((best.y << best.levelsAbove) - coord.y) * this._tileSize,
        ds, ds);
      return [canvas, bestDifference];
    } else {
      return [null, undefined];
    }
  }

  private compositeFromSmaller(canvas: CanvasRenderingContext2D, coord: Point,
      drect: Rect, // These are passed in to mitigate rounding errors and simplify computation.
      zoom: number, lod: number, proxyBetterThan: number): boolean {
    if (lod + proxyBetterThan < 0) return false;

    let complete = true;

    for (let j = 0; j <= 1; ++j) {
      for (let i = 0; i <= 1; ++i) {
        const cc = {
          x: (coord.x << 1) + i,
          y: (coord.y << 1) + j
        };
        // Tile sizes need not be powers of 2, so take care of rounding.
        const cd = {
          x: i? drect.x + (drect.w >> 1) : drect.x,
          y: j? drect.y + (drect.h >> 1) : drect.y,
          w: i? drect.w - (drect.w >> 1) : drect.w >> 1,
          h: j? drect.h - (drect.h >> 1) : drect.h >> 1
        };

        const mipmap = this.imageCache[zoom]?.[cc.y]?.[cc.x]; 
        const child = mipmap?.[lod];
        if (child) {
          canvas.drawImage(child, cd.x, cd.y, cd.w, cd.h);
        } else {
          // Check other LODs for a proxy image to fill the background with
          let proxy: HTMLImageElement, nextBetterThan = proxyBetterThan;
          if (mipmap) {
            [proxy, nextBetterThan] = findNearestLod(mipmap, lod, proxyBetterThan);
            if (proxy) {
              canvas.drawImage(proxy, cd.x, cd.y, cd.w, cd.h);
            }
          }

          // To prevent short-circuit, don't just &&=
          if (!this.compositeFromSmaller(canvas, cc, cd, zoom + 1, lod - 1, nextBetterThan)) {
            complete = false;
          }
        }
      }
    }
    return complete;
  }

  // Assembles a tile from smaller tiles at a lower LOD. Produces a canvas even if no such tiles are available, and fills with
  // alternate-LOD proxy images where available.
  private tileFromSmaller(zoom: number, coord: google.maps.Point, lod: number, proxyBetterThan: number, ownerDocument: Document):
      [content: HTMLCanvasElement, complete: boolean] {
    const canvas = ownerDocument.createElement("canvas");
    canvas.width = canvas.height = this._tileSize;

    return [canvas, this.compositeFromSmaller(canvas.getContext("2d"), coord,
      {x: 0, y:0, w: canvas.width, h: canvas.height}, zoom + 1, lod - 1, proxyBetterThan)];
  }

  // Creates a new image tile, incorporating larger and smaller tiles as proxies in the meantime.
  private fetchTile(zoom: number, coord: google.maps.Point, lod: number, ownerDocument: Document) : HTMLImageElement {
    const img = ownerDocument.createElement("img");
    img.crossOrigin = "anonymous";
    img.height = this._tileSize;
    img.width = this._tileSize;
    img.src = this.getTileUrl(coord, zoom, lod);
    return img;
  }

  private createTileContent(coord: google.maps.Point, zoom: number, lod: number, ownerDocument: Document): TileContent {
    const [fromLarger, difference] = this.tileFromLarger(zoom, coord, lod, ownerDocument);
    if (difference == 0) return [fromLarger];

    const [fromSmaller, complete] = this.tileFromSmaller(zoom, coord, lod,
      difference || this.maxOversample + 1, // Cap default proxy assembly from smaller images to maxOversample.
      ownerDocument);
    if (complete) return [fromSmaller];

    const image = this.fetchTile(zoom, coord, lod, ownerDocument);
    
    const content: TileContent = [...(fromLarger? [fromLarger] : []), fromSmaller, image];
    content.forEach(e => e.style.position = "absolute");
    image.decode().then(() => (((this.imageCache[zoom] ??= [])[coord.y] ??= [])[coord.x] ??= [])[lod] = image);
    return content;
  }

  private getTileContent(coord: google.maps.Point, zoom: number, ownerDocument: Document): TileContent {
    const lod = Math.max(Math.min(this.levelOfDetail - zoom, this.maxOversample), 0);
    const cached = this.imageCache[zoom]?.[coord.y]?.[coord.x]?.[lod];
    return cached? [cached] : this.createTileContent(coord, zoom, lod, ownerDocument);
  }

  getTile(coord: google.maps.Point, zoom: number, ownerDocument: Document): Element {
    // Wrap the actual content in a div so we can swap it out if we need to refresh the LOD.
    const div = ownerDocument.createElement("div");
    div.append(...this.getTileContent(coord, zoom, ownerDocument));
    this.activeTiles.set(div, {coord, zoom});
    return div;
  }

  releaseTile(tile: HTMLDivElement): void {
    this.activeTiles.delete(tile);
  }

  refreshTiles(): void {
    for (const [div, params] of this.activeTiles) {
      div.replaceChildren(...this.getTileContent(params.coord, params.zoom, div.ownerDocument));
    }
  }
}

export {
  EPSG_3857_EXTENT,
  DEFAULT_WMS_PARAMS,
  xyzToBounds,
  WmsMapType,
  WmsMapTypeOptions,
};
